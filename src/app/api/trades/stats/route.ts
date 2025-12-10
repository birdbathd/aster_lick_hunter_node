import { NextRequest, NextResponse } from 'next/server';
import { tradeHistoryCache } from '@/lib/services/tradeHistoryCache';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    // Initialize if not already done
    await tradeHistoryCache.initialize();

    // Get cache statistics
    const stats = tradeHistoryCache.getStats();

    return NextResponse.json({
      success: true,
      stats: {
        totalDaysCached: stats.totalDaysCached,
        totalTradesCached: stats.totalTradesCached,
        oldestDate: stats.oldestDate,
        newestDate: stats.newestDate,
      },
    });
  } catch (error) {
    console.error('Error fetching trade stats:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch trade stats',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
