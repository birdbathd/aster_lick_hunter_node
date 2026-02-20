/**
 * FundingRateCollector — polls funding rates for configured symbols
 * and stores them in the trade history DB for correlation analysis.
 * 
 * Runs every 15 minutes (funding rates typically update every 8h,
 * but we want granular snapshots to correlate with trade entries).
 * 
 * Also provides a getCurrentRate() method for instant snapshots at trade entry time.
 */

import { getAllFundingRates, getFundingRateHistory } from '../api/market';
import { tradeHistoryDb } from '../db/tradeHistoryDb';
import { logWithTimestamp, logErrorWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';
import { Config } from '../types';

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const BACKFILL_DAYS = 30; // Backfill 30 days of history on first run

export class FundingRateCollector {
  private config: Config;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private rateCache: Map<string, { rate: number; markPrice: number; timestamp: number }> = new Map();
  private isRunning = false;

  constructor(config: Config) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logWithTimestamp('FundingRateCollector: Starting...');

    // Check if we need to backfill historical data
    await this.backfillIfNeeded();

    // Do an immediate poll
    await this.pollFundingRates();

    // Poll every 15 minutes
    this.pollInterval = setInterval(() => this.pollFundingRates(), POLL_INTERVAL_MS);

    logWithTimestamp('FundingRateCollector: Started — polling every 15 minutes');
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logWithTimestamp('FundingRateCollector: Stopped');
  }

  updateConfig(config: Config): void {
    this.config = config;
  }

  /**
   * Get the cached current funding rate for a symbol.
   * Falls back to DB if not in cache, or fetches live if needed.
   */
  getCurrentRate(symbol: string): { rate: number; markPrice: number; timestamp: number } | null {
    const cached = this.rateCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < POLL_INTERVAL_MS * 2) {
      return cached;
    }
    // Fallback to DB
    const dbRate = tradeHistoryDb.getLatestFundingRate(symbol);
    if (dbRate) {
      return {
        rate: parseFloat(dbRate.funding_rate),
        markPrice: parseFloat(dbRate.mark_price),
        timestamp: dbRate.snapshot_time,
      };
    }
    return null;
  }

  /**
   * Snapshot funding rate at trade entry — called by Hunter when entering a trade.
   * Returns the rate string for storage in trade_history.
   */
  async snapshotAtEntry(symbol: string, orderId: number): Promise<string | null> {
    try {
      // Use cached rate if recent (< 2 min old)
      const cached = this.rateCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < 2 * 60 * 1000) {
        const rateStr = cached.rate.toString();
        tradeHistoryDb.updateTradeFundingRate(symbol, orderId, rateStr);

        // Also store as an entry-specific snapshot
        tradeHistoryDb.insertFundingRate({
          symbol,
          fundingRate: rateStr,
          markPrice: cached.markPrice.toString(),
          snapshotTime: Date.now(),
          source: 'entry',
        });

        return rateStr;
      }

      // Fetch live
      const rates = await getAllFundingRates();
      const symbolRate = rates.find(r => r.symbol === symbol);
      if (symbolRate) {
        const rateStr = symbolRate.lastFundingRate;
        tradeHistoryDb.updateTradeFundingRate(symbol, orderId, rateStr);

        tradeHistoryDb.insertFundingRate({
          symbol,
          fundingRate: rateStr,
          markPrice: symbolRate.markPrice,
          snapshotTime: Date.now(),
          source: 'entry',
        });

        // Update cache
        this.rateCache.set(symbol, {
          rate: parseFloat(rateStr),
          markPrice: parseFloat(symbolRate.markPrice),
          timestamp: Date.now(),
        });

        return rateStr;
      }
    } catch (error: any) {
      logErrorWithTimestamp(`FundingRateCollector: Failed to snapshot rate for ${symbol}:`, error?.message);
    }
    return null;
  }

  /**
   * Poll all funding rates and store snapshots
   */
  private async pollFundingRates(): Promise<void> {
    try {
      const configuredSymbols = new Set(Object.keys(this.config.symbols));
      const rates = await getAllFundingRates();
      const now = Date.now();
      const records: Array<{ symbol: string; fundingRate: string; markPrice: string; snapshotTime: number; source: string }> = [];

      for (const rate of rates) {
        if (!configuredSymbols.has(rate.symbol)) continue;

        const fundingRate = parseFloat(rate.lastFundingRate);

        // Update in-memory cache
        this.rateCache.set(rate.symbol, {
          rate: fundingRate,
          markPrice: parseFloat(rate.markPrice),
          timestamp: now,
        });

        records.push({
          symbol: rate.symbol,
          fundingRate: rate.lastFundingRate,
          markPrice: rate.markPrice,
          snapshotTime: now,
          source: 'poll',
        });

        // Log extreme funding rates (> 0.1% or < -0.1%)
        if (Math.abs(fundingRate) > 0.001) {
          const direction = fundingRate > 0 ? 'positive (longs pay)' : 'negative (shorts pay)';
          logWarnWithTimestamp(`FundingRateCollector: ${rate.symbol} extreme funding: ${(fundingRate * 100).toFixed(4)}% — ${direction}`);
        }
      }

      if (records.length > 0) {
        tradeHistoryDb.batchInsertFundingRates(records);
      }
    } catch (error: any) {
      logErrorWithTimestamp('FundingRateCollector: Poll failed:', error?.message);
    }
  }

  /**
   * Backfill historical funding rates on first start
   */
  private async backfillIfNeeded(): Promise<void> {
    try {
      const meta = tradeHistoryDb.getSyncMeta('funding_rates_backfilled');
      if (meta) return; // Already backfilled

      logWithTimestamp('FundingRateCollector: Backfilling historical funding rates...');

      const symbols = Object.keys(this.config.symbols);
      let totalRecords = 0;

      for (const symbol of symbols) {
        try {
          const history = await getFundingRateHistory(symbol, {
            startTime: Date.now() - (BACKFILL_DAYS * 24 * 60 * 60 * 1000),
            limit: 1000,
          });

          if (history.length > 0) {
            const records = history.map(h => ({
              symbol: h.symbol,
              fundingRate: h.fundingRate,
              snapshotTime: h.fundingTime,
              source: 'backfill',
            }));
            tradeHistoryDb.batchInsertFundingRates(records);
            totalRecords += records.length;
          }
        } catch (error: any) {
          logWarnWithTimestamp(`FundingRateCollector: Backfill failed for ${symbol}: ${error?.message}`);
        }
      }

      tradeHistoryDb.setSyncMeta('funding_rates_backfilled', new Date().toISOString());
      logWithTimestamp(`FundingRateCollector: Backfilled ${totalRecords} historical funding rate records`);
    } catch (error: any) {
      logErrorWithTimestamp('FundingRateCollector: Backfill error:', error?.message);
    }
  }

  /**
   * Get summary for WebSocket broadcast / UI display
   */
  getSummary(): Record<string, { rate: number; ratePercent: string; direction: string; markPrice: number; age: string }> {
    const summary: Record<string, any> = {};
    const now = Date.now();

    for (const [symbol, data] of this.rateCache) {
      const ageMs = now - data.timestamp;
      const ageMins = Math.floor(ageMs / 60000);
      summary[symbol] = {
        rate: data.rate,
        ratePercent: (data.rate * 100).toFixed(4) + '%',
        direction: data.rate > 0 ? 'longs_pay' : data.rate < 0 ? 'shorts_pay' : 'neutral',
        markPrice: data.markPrice,
        age: ageMins < 60 ? `${ageMins}m` : `${Math.floor(ageMins / 60)}h${ageMins % 60}m`,
      };
    }
    return summary;
  }
}
