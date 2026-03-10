import { NextRequest, NextResponse } from 'next/server';
import { tradeHistoryDb } from '@/lib/db/tradeHistoryDb';

/**
 * GET /api/trades/stats
 * 
 * Aggregate statistics from local trade history DB.
 * 
 * Query params:
 *   startTime - Start timestamp (ms)
 *   endTime   - End timestamp (ms)
 *   symbol    - Filter by symbol
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol') || undefined;
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const leaderboard = searchParams.get('leaderboard');

    // Per-symbol leaderboard mode
    if (leaderboard) {
      const start = startTime ? parseInt(startTime) : (() => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return now.getTime();
      })();
      const end = endTime ? parseInt(endTime) : undefined;
      const rows = tradeHistoryDb.getSymbolLeaderboard(start, end);
      return NextResponse.json({ leaderboard: rows });
    }

    const totalTrades = tradeHistoryDb.getTradeCount({ status: 'FILLED' });
    const symbolTrades = symbol ? tradeHistoryDb.getTradeCount({ symbol, status: 'FILLED' }) : totalTrades;
    
    const income = tradeHistoryDb.getIncomeBreakdown({
      startTime: startTime ? parseInt(startTime) : undefined,
      endTime: endTime ? parseInt(endTime) : undefined,
      symbol,
    });

    const lastSync = tradeHistoryDb.getSyncMeta('last_trade_backfill_time');
    const backfillStatus = tradeHistoryDb.getSyncMeta('backfill_status');

    return NextResponse.json({
      totalFilledTrades: totalTrades,
      symbolFilledTrades: symbolTrades,
      income,
      sync: {
        lastBackfillTime: lastSync ? parseInt(lastSync) : null,
        status: backfillStatus || 'never_run',
      },
    });
  } catch (error) {
    console.error('[Trade Stats API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trade stats' },
      { status: 500 }
    );
  }
}
