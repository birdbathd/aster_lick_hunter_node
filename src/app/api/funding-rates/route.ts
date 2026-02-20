import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'trade_history.db');

/**
 * GET /api/funding-rates?symbol=ETHUSDT&hours=24
 * 
 * Returns historical funding rate snapshots for chart overlay.
 * Each record maps to a candle time for the funding rate line series.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const hours = parseInt(searchParams.get('hours') || '168'); // Default 7 days
    const latest = searchParams.get('latest') === 'true';

    if (!symbol && !latest) {
      return NextResponse.json(
        { error: 'Symbol parameter is required (or use latest=true for all symbols)' },
        { status: 400 }
      );
    }

    let db: Database.Database;
    try {
      db = new Database(DB_PATH, { readonly: true });
    } catch {
      return NextResponse.json({ data: [], latest: {} }, { status: 200 });
    }

    // If requesting latest rates for all symbols
    if (latest) {
      const latestRates = db.prepare(`
        SELECT f1.symbol, f1.funding_rate, f1.mark_price, f1.snapshot_time
        FROM funding_rates f1
        INNER JOIN (
          SELECT symbol, MAX(snapshot_time) as max_time
          FROM funding_rates
          GROUP BY symbol
        ) f2 ON f1.symbol = f2.symbol AND f1.snapshot_time = f2.max_time
      `).all() as any[];

      const result: Record<string, any> = {};
      for (const rate of latestRates) {
        const r = parseFloat(rate.funding_rate);
        result[rate.symbol] = {
          rate: r,
          ratePercent: (r * 100).toFixed(4) + '%',
          direction: r > 0 ? 'longs_pay' : r < 0 ? 'shorts_pay' : 'neutral',
          markPrice: parseFloat(rate.mark_price),
          timestamp: rate.snapshot_time,
        };
      }

      db.close();
      return NextResponse.json({ latest: result });
    }

    // Historical funding rates for a specific symbol
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);

    const rates = db.prepare(`
      SELECT funding_rate, mark_price, snapshot_time, source
      FROM funding_rates
      WHERE symbol = ? AND snapshot_time > ?
      ORDER BY snapshot_time ASC
    `).all(symbol, cutoff) as any[];

    // Format for TradingView line series: { time: unix_seconds, value: rate_as_percent }
    const data = rates.map(r => ({
      time: Math.floor(r.snapshot_time / 1000),
      value: parseFloat(r.funding_rate) * 100, // Convert to percentage for readability
      raw: parseFloat(r.funding_rate),
      source: r.source,
    }));

    // Deduplicate by time (keep last value per second)
    const deduped = new Map<number, typeof data[0]>();
    for (const point of data) {
      deduped.set(point.time, point);
    }
    const dedupedData = Array.from(deduped.values()).sort((a, b) => a.time - b.time);

    db.close();
    return NextResponse.json({ 
      symbol,
      hours,
      count: dedupedData.length,
      data: dedupedData,
    });
  } catch (error: any) {
    console.error('Funding rates API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
