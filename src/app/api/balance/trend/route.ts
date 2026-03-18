import { NextRequest, NextResponse } from 'next/server';
import { tradeHistoryDb } from '@/lib/db/tradeHistoryDb';
import { withAuth } from '@/lib/auth/with-auth';

/**
 * GET /api/balance/trend
 * Returns daily net P&L from local income_history DB for the past N days.
 * Query params:
 *   days  - Number of days to look back (default: 30, max: 90)
 */
export const GET = withAuth(async (request: NextRequest, _user) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(request.nextUrl.searchParams.get('days') || '30', 10)));

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const dailyData = tradeHistoryDb.getDailyTrend(cutoff);

    return NextResponse.json({ days, dailyData });
  } catch (err) {
    console.error('[Balance Trend API]', err);
    return NextResponse.json({ error: 'Failed to load trend data' }, { status: 500 });
  }
});
