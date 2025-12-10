/**
 * Trade History Cache Service
 * 
 * Caches historical trade data from the exchange API locally.
 * The exchange API is the source of truth - we just cache old data
 * to avoid re-fetching it on every request.
 * 
 * Strategy:
 * - For completed days (before today), use cached data
 * - For today's data, always fetch fresh from API
 * - Automatically backfill cache when gaps are detected
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logWithTimestamp, logErrorWithTimestamp } from '../utils/timestamp';
import { getUserTrades } from '../api/market';
import { ApiCredentials } from '../types';

export interface CachedTrade {
  id: number;
  symbol: string;
  side: string;
  price: number;
  qty: number;
  quoteQty: number;
  realizedPnl: number;
  commission: number;
  commissionAsset: string;
  time: number;
  positionSide: string;
  maker: boolean;
  buyer: boolean;
}

export interface DailyTradeCache {
  date: string;
  symbol: string;
  totalPnl: number;
  tradeCount: number;
  commission: number;
  lastUpdated: number;
}

class TradeHistoryCache {
  private db: Database.Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    this.dbPath = path.join(dataDir, 'trade_cache.db');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      // Table to track which days we have cached for each symbol
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cached_days (
          symbol TEXT NOT NULL,
          date TEXT NOT NULL,
          total_pnl REAL DEFAULT 0,
          trade_count INTEGER DEFAULT 0,
          commission REAL DEFAULT 0,
          last_updated INTEGER NOT NULL,
          PRIMARY KEY (symbol, date)
        )
      `);

      // Table to store individual trades (for detailed queries)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          price REAL NOT NULL,
          qty REAL NOT NULL,
          quote_qty REAL NOT NULL,
          realized_pnl REAL DEFAULT 0,
          commission REAL DEFAULT 0,
          commission_asset TEXT,
          time INTEGER NOT NULL,
          position_side TEXT,
          is_maker INTEGER DEFAULT 0,
          is_buyer INTEGER DEFAULT 0,
          date TEXT NOT NULL,
          UNIQUE(id, symbol)
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_trades_symbol_date ON trades(symbol, date);
        CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(time);
        CREATE INDEX IF NOT EXISTS idx_cached_days_date ON cached_days(date);
      `);

      this.initialized = true;
      logWithTimestamp('📊 Trade Cache: Initialized');
    } catch (error) {
      logErrorWithTimestamp('Trade Cache: Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get today's date string in UTC
   */
  private getTodayUTC(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }

  /**
   * Convert timestamp to UTC date string
   */
  private timestampToDate(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  /**
   * Check if we have cached data for a specific symbol and date
   */
  hasCachedDay(symbol: string, date: string): boolean {
    if (!this.db) return false;
    
    const row = this.db.prepare(
      'SELECT 1 FROM cached_days WHERE symbol = ? AND date = ?'
    ).get(symbol, date);
    
    return !!row;
  }

  /**
   * Get cached daily summary for a date range
   */
  getCachedDailySummary(
    symbols: string[],
    startDate: string,
    endDate: string
  ): Map<string, { symbol: string; pnl: number; tradeCount: number; commission: number }[]> {
    if (!this.db) return new Map();

    const result = new Map<string, { symbol: string; pnl: number; tradeCount: number; commission: number }[]>();

    const stmt = this.db.prepare(`
      SELECT date, symbol, total_pnl, trade_count, commission
      FROM cached_days
      WHERE symbol IN (${symbols.map(() => '?').join(',')})
        AND date >= ? AND date <= ?
      ORDER BY date
    `);

    const rows = stmt.all(...symbols, startDate, endDate) as any[];

    for (const row of rows) {
      if (!result.has(row.date)) {
        result.set(row.date, []);
      }
      result.get(row.date)!.push({
        symbol: row.symbol,
        pnl: row.total_pnl,
        tradeCount: row.trade_count,
        commission: row.commission,
      });
    }

    return result;
  }

  /**
   * Get dates that need to be fetched from API for a symbol
   */
  getMissingDates(symbol: string, startDate: string, endDate: string): string[] {
    if (!this.db) return [];

    const today = this.getTodayUTC();
    const missing: string[] = [];

    // Generate all dates in range
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = this.timestampToDate(d.getTime());
      
      // Always consider today as "missing" since it's still in progress
      if (dateStr === today) {
        missing.push(dateStr);
        continue;
      }

      if (!this.hasCachedDay(symbol, dateStr)) {
        missing.push(dateStr);
      }
    }

    return missing;
  }

  /**
   * Cache trades and daily summary for a symbol
   */
  cacheTrades(symbol: string, trades: CachedTrade[]): void {
    if (!this.db || trades.length === 0) return;

    const today = this.getTodayUTC();

    // Group trades by date
    const tradesByDate = new Map<string, CachedTrade[]>();
    for (const trade of trades) {
      const date = this.timestampToDate(trade.time);
      if (!tradesByDate.has(date)) {
        tradesByDate.set(date, []);
      }
      tradesByDate.get(date)!.push(trade);
    }

    // Insert trades and update daily summaries
    const insertTrade = this.db.prepare(`
      INSERT OR REPLACE INTO trades (
        id, symbol, side, price, qty, quote_qty, realized_pnl,
        commission, commission_asset, time, position_side, is_maker, is_buyer, date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertDaily = this.db.prepare(`
      INSERT INTO cached_days (symbol, date, total_pnl, trade_count, commission, last_updated)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, date) DO UPDATE SET
        total_pnl = excluded.total_pnl,
        trade_count = excluded.trade_count,
        commission = excluded.commission,
        last_updated = excluded.last_updated
    `);

    const transaction = this.db.transaction(() => {
      for (const [date, dateTrades] of tradesByDate) {
        // Don't cache today's incomplete data in the daily summary
        // (but still store individual trades for reference)
        let totalPnl = 0;
        let totalCommission = 0;
        const tradeIds = new Set<number>();

        for (const trade of dateTrades) {
          // Insert individual trade
          insertTrade.run(
            trade.id,
            trade.symbol,
            trade.side,
            trade.price,
            trade.qty,
            trade.quoteQty,
            trade.realizedPnl,
            trade.commission,
            trade.commissionAsset,
            trade.time,
            trade.positionSide,
            trade.maker ? 1 : 0,
            trade.buyer ? 1 : 0,
            date
          );

          // Aggregate for daily summary (avoid duplicate trade IDs)
          if (!tradeIds.has(trade.id)) {
            totalPnl += trade.realizedPnl;
            totalCommission += trade.commission;
            tradeIds.add(trade.id);
          }
        }

        // Only cache daily summary for completed days
        if (date !== today) {
          upsertDaily.run(
            symbol,
            date,
            totalPnl,
            tradeIds.size,
            totalCommission,
            Date.now()
          );
        }
      }
    });

    transaction();
  }

  /**
   * Fetch trades from API for missing dates and cache them
   */
  async fetchAndCacheMissingTrades(
    credentials: ApiCredentials,
    symbol: string,
    startTime: number,
    endTime: number
  ): Promise<CachedTrade[]> {
    const startDate = this.timestampToDate(startTime);
    const endDate = this.timestampToDate(endTime);
    
    const missingDates = this.getMissingDates(symbol, startDate, endDate);
    
    if (missingDates.length === 0) {
      return [];
    }

    // Calculate the actual time range needed for API call
    const today = this.getTodayUTC();
    const needsApiCall = missingDates.some(d => d !== today) || missingDates.includes(today);
    
    if (!needsApiCall) {
      return [];
    }

    // Find the earliest missing date
    const firstMissing = missingDates.sort()[0];
    const fetchStart = new Date(firstMissing + 'T00:00:00Z').getTime();
    
    const allTrades: CachedTrade[] = [];

    // Fetch in 7-day chunks (API limit)
    const CHUNK_MS = 7 * 24 * 60 * 60 * 1000;
    
    for (let chunkStart = fetchStart; chunkStart < endTime; chunkStart += CHUNK_MS) {
      const chunkEnd = Math.min(chunkStart + CHUNK_MS, endTime);
      
      try {
        const trades = await getUserTrades(symbol, credentials, {
          startTime: chunkStart,
          endTime: chunkEnd,
          limit: 1000,
        });

        const cachedTrades: CachedTrade[] = trades.map(t => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          price: parseFloat(t.price),
          qty: parseFloat(t.qty),
          quoteQty: parseFloat(t.quoteQty),
          realizedPnl: parseFloat(t.realizedPnl),
          commission: parseFloat(t.commission),
          commissionAsset: t.commissionAsset,
          time: t.time,
          positionSide: t.positionSide,
          maker: t.maker,
          buyer: t.buyer,
        }));

        allTrades.push(...cachedTrades);

        // Small delay between chunks
        if (trades.length > 0) {
          await new Promise(r => setTimeout(r, 100));
        }
      } catch (error) {
        logErrorWithTimestamp(`Trade Cache: Error fetching ${symbol} trades:`, error);
      }
    }

    // Cache the trades
    if (allTrades.length > 0) {
      this.cacheTrades(symbol, allTrades);
      logWithTimestamp(`📊 Trade Cache: Cached ${allTrades.length} trades for ${symbol}`);
    }

    return allTrades;
  }

  /**
   * Get realized PnL by date, using cache for historical data
   * and fresh API calls for today/missing data
   */
  async getRealizedPnLByDate(
    credentials: ApiCredentials,
    symbols: string[],
    startTime: number,
    endTime: number
  ): Promise<Map<string, { date: string; realizedPnl: number; tradeCount: number }[]>> {
    await this.initialize();

    const startDate = this.timestampToDate(startTime);
    const endDate = this.timestampToDate(endTime);
    const today = this.getTodayUTC();

    const result = new Map<string, { date: string; realizedPnl: number; tradeCount: number }[]>();

    // First, get cached data for completed days
    const cachedData = this.getCachedDailySummary(symbols, startDate, endDate);
    
    // Copy cached data to result
    for (const [date, dayData] of cachedData) {
      if (date !== today) {
        const aggregated: { date: string; realizedPnl: number; tradeCount: number }[] = [];
        for (const d of dayData) {
          aggregated.push({
            date,
            realizedPnl: d.pnl,
            tradeCount: d.tradeCount,
          });
        }
        result.set(date, aggregated);
      }
    }

    // Fetch missing data for each symbol
    for (const symbol of symbols) {
      try {
        const freshTrades = await this.fetchAndCacheMissingTrades(
          credentials,
          symbol,
          startTime,
          endTime
        );

        // Add fresh trades to result (they may include today's data)
        for (const trade of freshTrades) {
          const date = this.timestampToDate(trade.time);
          
          if (!result.has(date)) {
            result.set(date, []);
          }
          
          // Check if we already have this symbol for this date
          const dayData = result.get(date)!;
          let symbolEntry = dayData.find(d => d.date === date);
          
          if (!symbolEntry) {
            symbolEntry = { date, realizedPnl: 0, tradeCount: 0 };
            dayData.push(symbolEntry);
          }
          
          // For today, aggregate from fresh trades
          if (date === today) {
            symbolEntry.realizedPnl += trade.realizedPnl;
            symbolEntry.tradeCount++;
          }
        }
      } catch (error) {
        logErrorWithTimestamp(`Trade Cache: Error processing ${symbol}:`, error);
      }
    }

    return result;
  }

  /**
   * Get cache statistics
   */
  getStats(): { totalDaysCached: number; totalTradesCached: number; oldestDate: string | null; newestDate: string | null } {
    if (!this.db) {
      return { totalDaysCached: 0, totalTradesCached: 0, oldestDate: null, newestDate: null };
    }

    const daysCount = this.db.prepare('SELECT COUNT(*) as count FROM cached_days').get() as any;
    const tradesCount = this.db.prepare('SELECT COUNT(*) as count FROM trades').get() as any;
    const dates = this.db.prepare('SELECT MIN(date) as oldest, MAX(date) as newest FROM cached_days').get() as any;

    return {
      totalDaysCached: daysCount?.count || 0,
      totalTradesCached: tradesCount?.count || 0,
      oldestDate: dates?.oldest || null,
      newestDate: dates?.newest || null,
    };
  }

  /**
   * Clear all cached data (for debugging/reset)
   */
  clearCache(): void {
    if (!this.db) return;
    
    this.db.exec('DELETE FROM cached_days');
    this.db.exec('DELETE FROM trades');
    logWithTimestamp('📊 Trade Cache: Cleared all cached data');
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}

export const tradeHistoryCache = new TradeHistoryCache();
