import { NextRequest, NextResponse } from 'next/server';
import { tradeHistoryCache } from '@/lib/services/tradeHistoryCache';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const _symbol = searchParams.get('symbol');
    const _limit = parseInt(searchParams.get('limit') || '100', 10);
    const _offset = parseInt(searchParams.get('offset') || '0', 10);

    // Initialize if not already done
    await tradeHistoryCache.initialize();

    // Get cache statistics
    const stats = tradeHistoryCache.getStats();

    return NextResponse.json({
      success: true,
      cacheStats: stats,
      message: 'Trade history is cached automatically when fetching performance data. Use /api/income for full trade data.',
    });
  } catch (error) {
    console.error('Error fetching trade history:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch trade history',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
