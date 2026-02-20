#!/usr/bin/env npx tsx
/**
 * Funding Rate Correlation Analysis
 * 
 * Analyzes the relationship between funding rates at the time of trade entry
 * and trade outcomes (PnL, win rate, hold time) to find actionable patterns.
 * 
 * Usage:
 *   npx tsx scripts/funding-correlation.ts [--days 30] [--symbol ETHUSDT]
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'trade_history.db');

// Parse CLI args
const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const symbolIdx = args.indexOf('--symbol');
const lookbackDays = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) : 30;
const filterSymbol = symbolIdx >= 0 ? args[symbolIdx + 1] : null;

interface TradeWithFunding {
  symbol: string;
  side: string;
  position_side: string;
  avg_price: string;
  executed_qty: string;
  realized_pnl: string;
  order_type: string;
  update_time: number;
  funding_rate_at_entry: string | null;
}

interface FundingSnapshot {
  symbol: string;
  funding_rate: string;
  mark_price: string;
  snapshot_time: number;
  source: string;
}

interface CorrelationBucket {
  label: string;
  rangeMin: number;
  rangeMax: number;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  avgPnl: number;
  winRate: number;
  avgHoldTimeMs: number;
  symbols: Set<string>;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           FUNDING RATE CORRELATION ANALYSIS                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  const cutoff = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);
  console.log(`📅 Period: Last ${lookbackDays} days`);
  if (filterSymbol) console.log(`🎯 Symbol: ${filterSymbol}`);
  console.log();

  // ════════════════════════════════════════════════════════════
  // 1. FUNDING RATE OVERVIEW
  // ════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📊 FUNDING RATE OVERVIEW');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const fundingStats = db.prepare(`
    SELECT 
      symbol,
      COUNT(*) as records,
      AVG(CAST(funding_rate AS REAL)) as avg_rate,
      MIN(CAST(funding_rate AS REAL)) as min_rate,
      MAX(CAST(funding_rate AS REAL)) as max_rate,
      SUM(CASE WHEN CAST(funding_rate AS REAL) > 0 THEN 1 ELSE 0 END) as positive_count,
      SUM(CASE WHEN CAST(funding_rate AS REAL) < 0 THEN 1 ELSE 0 END) as negative_count
    FROM funding_rates
    WHERE snapshot_time > ?
    ${filterSymbol ? 'AND symbol = ?' : ''}
    GROUP BY symbol
    ORDER BY avg_rate DESC
  `).all(...(filterSymbol ? [cutoff, filterSymbol] : [cutoff])) as any[];

  if (fundingStats.length === 0) {
    console.log('  No funding rate data found for this period.');
    console.log('  The funding rate collector needs time to gather data.');
    db.close();
    return;
  }

  console.log();
  console.log('  Symbol       | Avg Rate    | Min         | Max         | +/- Split');
  console.log('  -------------|-------------|-------------|-------------|----------');
  for (const stat of fundingStats) {
    const avgPct = (stat.avg_rate * 100).toFixed(4);
    const minPct = (stat.min_rate * 100).toFixed(4);
    const maxPct = (stat.max_rate * 100).toFixed(4);
    const split = `${stat.positive_count}+ / ${stat.negative_count}-`;
    console.log(`  ${stat.symbol.padEnd(13)}| ${avgPct.padStart(9)}% | ${minPct.padStart(9)}% | ${maxPct.padStart(9)}% | ${split}`);
  }
  console.log();

  // ════════════════════════════════════════════════════════════
  // 2. TRADE ENTRY FUNDING RATE CORRELATION
  // ════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🔗 TRADE ENTRY vs FUNDING RATE CORRELATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();

  // Get all closing trades (reduce-only fills) that have realized PnL
  const closingTrades = db.prepare(`
    SELECT symbol, side, position_side, avg_price, executed_qty, 
           realized_pnl, order_type, update_time
    FROM trade_history
    WHERE status = 'FILLED'
    AND CAST(realized_pnl AS REAL) != 0
    AND update_time > ?
    ${filterSymbol ? 'AND symbol = ?' : ''}
    AND source = 'websocket'
    ORDER BY update_time DESC
  `).all(...(filterSymbol ? [cutoff, filterSymbol] : [cutoff])) as TradeWithFunding[];

  if (closingTrades.length === 0) {
    console.log('  No closing trades with PnL found in this period.');
    console.log();
  } else {
    // For each closing trade, find the nearest funding rate snapshot at entry time
    // We approximate: look for the MARKET/LIMIT fill that opened the position prior to this close
    const openingTrades = db.prepare(`
      SELECT symbol, side, position_side, avg_price, executed_qty,
             order_type, update_time, funding_rate_at_entry
      FROM trade_history
      WHERE status = 'FILLED'
      AND CAST(realized_pnl AS REAL) = 0
      AND order_type IN ('MARKET', 'LIMIT')
      AND update_time > ?
      ${filterSymbol ? 'AND symbol = ?' : ''}
      AND source = 'websocket'
      ORDER BY update_time ASC
    `).all(...(filterSymbol ? [cutoff, filterSymbol] : [cutoff])) as TradeWithFunding[];

    // Match opening trades to their nearest funding rate
    interface MatchedTrade {
      symbol: string;
      side: string;
      entryPrice: number;
      exitPnl: number;
      entryTime: number;
      exitTime: number;
      holdTimeMs: number;
      fundingRateAtEntry: number | null;
      approximatedRate: number | null;
    }

    const matchedTrades: MatchedTrade[] = [];

    // Build a map of opening trades by symbol+positionSide
    const openMap = new Map<string, TradeWithFunding[]>();
    for (const open of openingTrades) {
      const key = `${open.symbol}_${open.position_side}`;
      if (!openMap.has(key)) openMap.set(key, []);
      openMap.get(key)!.push(open);
    }

    for (const close of closingTrades) {
      const pnl = parseFloat(close.realized_pnl);
      if (pnl === 0) continue;

      // Find matching opening trade
      const key = `${close.symbol}_${close.position_side}`;
      const opens = openMap.get(key) || [];

      // Find the most recent opening trade before this close
      let matchedOpen: TradeWithFunding | null = null;
      for (let i = opens.length - 1; i >= 0; i--) {
        if (opens[i].update_time < close.update_time) {
          matchedOpen = opens[i];
          break;
        }
      }

      // Get funding rate: from entry record, or approximate from snapshots
      let fundingRate: number | null = null;
      if (matchedOpen?.funding_rate_at_entry) {
        fundingRate = parseFloat(matchedOpen.funding_rate_at_entry);
      } else if (matchedOpen) {
        // Approximate: find nearest funding rate snapshot to entry time
        const nearest = db.prepare(`
          SELECT funding_rate FROM funding_rates
          WHERE symbol = ? AND ABS(snapshot_time - ?) < 3600000
          ORDER BY ABS(snapshot_time - ?) ASC
          LIMIT 1
        `).get(close.symbol, matchedOpen.update_time, matchedOpen.update_time) as any;
        if (nearest) {
          fundingRate = parseFloat(nearest.funding_rate);
        }
      }

      matchedTrades.push({
        symbol: close.symbol,
        side: close.side,
        entryPrice: matchedOpen ? parseFloat(matchedOpen.avg_price) : 0,
        exitPnl: pnl,
        entryTime: matchedOpen?.update_time || 0,
        exitTime: close.update_time,
        holdTimeMs: matchedOpen ? close.update_time - matchedOpen.update_time : 0,
        fundingRateAtEntry: fundingRate,
        approximatedRate: fundingRate,
      });
    }

    // Filter trades that have funding rate data
    const tradesWithRate = matchedTrades.filter(t => t.fundingRateAtEntry !== null);
    const tradesWithoutRate = matchedTrades.filter(t => t.fundingRateAtEntry === null);

    console.log(`  Total closing trades: ${closingTrades.length}`);
    console.log(`  Matched with funding rate: ${tradesWithRate.length}`);
    console.log(`  Without funding data: ${tradesWithoutRate.length}`);
    console.log();

    if (tradesWithRate.length > 0) {
      // ════════════════════════════════════════════════════════════
      // 3. BUCKETED ANALYSIS
      // ════════════════════════════════════════════════════════════
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  📈 PERFORMANCE BY FUNDING RATE BUCKET');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log();

      const buckets: CorrelationBucket[] = [
        { label: 'Very Negative (<-0.05%)', rangeMin: -Infinity, rangeMax: -0.0005, trades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, winRate: 0, avgHoldTimeMs: 0, symbols: new Set() },
        { label: 'Negative (-0.05% to -0.01%)', rangeMin: -0.0005, rangeMax: -0.0001, trades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, winRate: 0, avgHoldTimeMs: 0, symbols: new Set() },
        { label: 'Neutral (-0.01% to +0.01%)', rangeMin: -0.0001, rangeMax: 0.0001, trades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, winRate: 0, avgHoldTimeMs: 0, symbols: new Set() },
        { label: 'Positive (+0.01% to +0.05%)', rangeMin: 0.0001, rangeMax: 0.0005, trades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, winRate: 0, avgHoldTimeMs: 0, symbols: new Set() },
        { label: 'Very Positive (>+0.05%)', rangeMin: 0.0005, rangeMax: Infinity, trades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, winRate: 0, avgHoldTimeMs: 0, symbols: new Set() },
      ];

      for (const trade of tradesWithRate) {
        const rate = trade.fundingRateAtEntry!;
        for (const bucket of buckets) {
          if (rate >= bucket.rangeMin && rate < bucket.rangeMax) {
            bucket.trades++;
            bucket.totalPnl += trade.exitPnl;
            bucket.avgHoldTimeMs += trade.holdTimeMs;
            bucket.symbols.add(trade.symbol);
            if (trade.exitPnl > 0) bucket.wins++;
            else bucket.losses++;
            break;
          }
        }
      }

      // Calculate averages
      for (const bucket of buckets) {
        if (bucket.trades > 0) {
          bucket.avgPnl = bucket.totalPnl / bucket.trades;
          bucket.winRate = (bucket.wins / bucket.trades) * 100;
          bucket.avgHoldTimeMs = bucket.avgHoldTimeMs / bucket.trades;
        }
      }

      console.log('  Funding Rate Bucket           | Trades | Win Rate | Avg PnL    | Total PnL');
      console.log('  ------------------------------|--------|----------|------------|----------');
      for (const bucket of buckets) {
        if (bucket.trades === 0) {
          console.log(`  ${bucket.label.padEnd(30)}|   0    |    -     |     -      |    -`);
        } else {
          const holdMins = Math.round(bucket.avgHoldTimeMs / 60000);
          const holdStr = holdMins > 60 ? `${Math.floor(holdMins / 60)}h${holdMins % 60}m` : `${holdMins}m`;
          console.log(`  ${bucket.label.padEnd(30)}| ${String(bucket.trades).padStart(5)}  | ${bucket.winRate.toFixed(0).padStart(6)}%  | $${bucket.avgPnl.toFixed(3).padStart(8)} | $${bucket.totalPnl.toFixed(2).padStart(7)}`);
        }
      }
      console.log();

      // ════════════════════════════════════════════════════════════
      // 4. DIRECTIONAL ANALYSIS: Does funding predict our entries?
      // ════════════════════════════════════════════════════════════
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  🧭 DIRECTIONAL ANALYSIS (Funding vs Position Side)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log();
      console.log('  Our bot is mean-reversion: we enter opposite to liquidation cascades.');
      console.log('  Key question: Is funding rate aligned or opposed to our entries?');
      console.log();

      // Categorize: funding positive + we go long = aligned, funding positive + we go short = contrarian, etc.
      let alignedTrades = { count: 0, wins: 0, totalPnl: 0 };
      let contrarianTrades = { count: 0, wins: 0, totalPnl: 0 };
      let neutralTrades = { count: 0, wins: 0, totalPnl: 0 };

      for (const trade of tradesWithRate) {
        const rate = trade.fundingRateAtEntry!;
        const isLong = trade.side === 'BUY' || trade.side === 'SELL'; // close side = sell for longs
        // Position side tells us: if position_side=LONG and we're closing (SELL), original was LONG
        // For opening: side=BUY + position_side=LONG = going long

        // Simplify: if position_side is LONG, we were long
        const wasLong = trade.side === 'SELL'; // closing a long = SELL side

        if (Math.abs(rate) < 0.0001) {
          neutralTrades.count++;
          neutralTrades.totalPnl += trade.exitPnl;
          if (trade.exitPnl > 0) neutralTrades.wins++;
        } else if ((rate > 0 && wasLong) || (rate < 0 && !wasLong)) {
          // Funding positive (longs pay) + we're long = aligned with majority
          // Funding negative (shorts pay) + we're short = aligned with majority
          alignedTrades.count++;
          alignedTrades.totalPnl += trade.exitPnl;
          if (trade.exitPnl > 0) alignedTrades.wins++;
        } else {
          // Contrarian: going against the funding direction
          contrarianTrades.count++;
          contrarianTrades.totalPnl += trade.exitPnl;
          if (trade.exitPnl > 0) contrarianTrades.wins++;
        }
      }

      console.log('  Type          | Trades | Win Rate | Total PnL | Avg PnL');
      console.log('  --------------|--------|----------|-----------|--------');
      for (const [label, data] of [['Aligned', alignedTrades], ['Contrarian', contrarianTrades], ['Neutral', neutralTrades]] as [string, typeof alignedTrades][]) {
        if (data.count === 0) {
          console.log(`  ${label.padEnd(14)}|   0    |    -     |     -     |    -`);
        } else {
          const wr = ((data.wins / data.count) * 100).toFixed(0);
          const avg = (data.totalPnl / data.count).toFixed(3);
          console.log(`  ${label.padEnd(14)}| ${String(data.count).padStart(5)}  | ${wr.padStart(6)}%  | $${data.totalPnl.toFixed(2).padStart(7)} | $${avg.padStart(6)}`);
        }
      }
      console.log();
    }
  }

  // ════════════════════════════════════════════════════════════
  // 5. PER-SYMBOL FUNDING RATE TRENDS
  // ════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📉 CURRENT FUNDING RATE SNAPSHOT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();

  const currentRates = db.prepare(`
    SELECT f1.symbol, f1.funding_rate, f1.mark_price, f1.snapshot_time
    FROM funding_rates f1
    INNER JOIN (
      SELECT symbol, MAX(snapshot_time) as max_time
      FROM funding_rates
      GROUP BY symbol
    ) f2 ON f1.symbol = f2.symbol AND f1.snapshot_time = f2.max_time
    ORDER BY CAST(f1.funding_rate AS REAL) DESC
  `).all() as FundingSnapshot[];

  console.log('  Symbol       | Rate        | Direction       | Mark Price      | Age');
  console.log('  -------------|-------------|-----------------|-----------------|-----');
  for (const rate of currentRates) {
    const r = parseFloat(rate.funding_rate);
    const pct = (r * 100).toFixed(4);
    const dir = r > 0.0001 ? '🔴 Longs pay' : r < -0.0001 ? '🟢 Shorts pay' : '⚪ Neutral';
    const ageMs = Date.now() - rate.snapshot_time;
    const ageMins = Math.floor(ageMs / 60000);
    const ageStr = ageMins < 60 ? `${ageMins}m` : `${Math.floor(ageMins / 60)}h${ageMins % 60}m`;
    console.log(`  ${rate.symbol.padEnd(13)}| ${pct.padStart(9)}% | ${dir.padEnd(15)} | $${parseFloat(rate.mark_price).toFixed(4).padStart(13)} | ${ageStr}`);
  }
  console.log();

  // ════════════════════════════════════════════════════════════
  // 6. FUNDING RATE EXTREMES (opportunities)
  // ════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ⚡ EXTREME FUNDING RATE EVENTS (past period)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();

  const extremes = db.prepare(`
    SELECT symbol, funding_rate, mark_price, snapshot_time, source
    FROM funding_rates
    WHERE snapshot_time > ?
    AND ABS(CAST(funding_rate AS REAL)) > 0.001
    ${filterSymbol ? 'AND symbol = ?' : ''}
    ORDER BY ABS(CAST(funding_rate AS REAL)) DESC
    LIMIT 20
  `).all(...(filterSymbol ? [cutoff, filterSymbol] : [cutoff])) as FundingSnapshot[];

  if (extremes.length === 0) {
    console.log('  No extreme funding rate events (>0.1%) found in this period.');
  } else {
    console.log('  Symbol       | Rate        | Mark Price      | Time');
    console.log('  -------------|-------------|-----------------|----');
    for (const ex of extremes) {
      const pct = (parseFloat(ex.funding_rate) * 100).toFixed(4);
      const time = new Date(ex.snapshot_time).toISOString().slice(0, 19).replace('T', ' ');
      console.log(`  ${ex.symbol.padEnd(13)}| ${pct.padStart(9)}% | $${parseFloat(ex.mark_price).toFixed(4).padStart(13)} | ${time}`);
    }
  }
  console.log();

  // ════════════════════════════════════════════════════════════
  // 7. RECOMMENDATIONS
  // ════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  💡 RECOMMENDATIONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();

  // Check for consistently negative funding (reversal signals for our mean reversion bot)
  for (const stat of fundingStats) {
    const avgRate = stat.avg_rate;
    if (avgRate < -0.0003) {
      console.log(`  ⚠️  ${stat.symbol}: Consistently negative funding (avg ${(avgRate * 100).toFixed(4)}%)`);
      console.log(`     → Shorts are dominant/paying. Mean-reversion LONG entries may be higher quality.`);
      console.log();
    } else if (avgRate > 0.0005) {
      console.log(`  ⚠️  ${stat.symbol}: Consistently positive funding (avg ${(avgRate * 100).toFixed(4)}%)`);
      console.log(`     → Longs are dominant/paying. Mean-reversion SHORT entries may be higher quality.`);
      console.log();
    }
  }

  console.log('  📊 Note: Funding rate correlation improves with more data.');
  console.log('     The collector stores snapshots every 15 minutes.');
  console.log('     Trade-entry snapshots are recorded for all new trades.');
  console.log('     Re-run this analysis after accumulating more trades with funding data.');
  console.log();

  db.close();
}

main();
