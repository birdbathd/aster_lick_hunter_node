import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/database';
import { tradeHistoryDb } from '@/lib/db/tradeHistoryDb';
import { loadConfig } from '@/lib/bot/config';
import { ensureDbInitialized } from '@/lib/db/initDb';

interface SymbolThresholdAnalysis {
  symbol: string;
  currentThreshold: { long: number; short: number };
  // Volume distribution
  totalLiqs: number;
  avgVolume: number;
  percentiles: { p50: number; p75: number; p90: number; p95: number; p99: number };
  // Signal pass rates at threshold
  passedThreshold: number;
  passRate: number;
  signalsPerDay: number;
  // Near misses
  nearMiss50to100: number;  // Volume was 50-100% of threshold
  nearMiss25to50: number;   // Volume was 25-50% of threshold
  // By direction
  byDirection: {
    longLiqs: { total: number; passed: number; totalVolume: number };
    shortLiqs: { total: number; passed: number; totalVolume: number };
  };
  // What-if scenarios
  scenarios: Array<{
    thresholdMultiplier: number;
    threshold: number;
    signalsPerDay: number;
    passed: number;
    label: string;
  }>;
  // Trade performance (if we traded this symbol)
  tradePerformance?: {
    wins: number;
    losses: number;
    netPnl: number;
    avgWin: number;
    avgLoss: number;
  };
}

interface WeeklyPerformance {
  week: string;
  wins: number;
  losses: number;
  netPnl: number;
  avgWin: number;
  avgLoss: number | null;
}

interface UntradedCandidate {
  symbol: string;
  totalLiqs: number;
  avgVolume: number;
  above5k: number;
  above10k: number;
  above15k: number;
  maxVolume: number;
  signalsPerDay5k: number;
}

export async function GET(request: NextRequest) {
  try {
    await ensureDbInitialized();

    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '7');
    const cutoffMs = Date.now() - days * 86400 * 1000;

    // Load current config to get thresholds
    const config = await loadConfig();
    const symbolConfigs = config.symbols || {};
    const configuredSymbols = Object.keys(symbolConfigs);

    // === Per-symbol threshold analysis ===
    const symbolAnalyses: SymbolThresholdAnalysis[] = [];

    for (const symbol of configuredSymbols) {
      const sc = symbolConfigs[symbol];
      const longThresh = sc.longVolumeThresholdUSDT || 10000;
      const shortThresh = sc.shortVolumeThresholdUSDT || 10000;
      // Use the average of long/short for general analysis
      const avgThresh = (longThresh + shortThresh) / 2;

      // Total liquidation stats
      const stats = await db.get<{
        total: number; avg_vol: number; min_vol: number; max_vol: number;
        passed: number; near_50_100: number; near_25_50: number;
      }>(`
        SELECT 
          COUNT(*) as total,
          ROUND(AVG(volume_usdt), 2) as avg_vol,
          MIN(volume_usdt) as min_vol,
          MAX(volume_usdt) as max_vol,
          SUM(CASE WHEN volume_usdt >= ? THEN 1 ELSE 0 END) as passed,
          SUM(CASE WHEN volume_usdt >= ? * 0.5 AND volume_usdt < ? THEN 1 ELSE 0 END) as near_50_100,
          SUM(CASE WHEN volume_usdt >= ? * 0.25 AND volume_usdt < ? * 0.5 THEN 1 ELSE 0 END) as near_25_50
        FROM liquidations
        WHERE symbol = ? AND event_time >= ?
      `, [avgThresh, avgThresh, avgThresh, avgThresh, avgThresh, symbol, cutoffMs]);

      if (!stats || stats.total === 0) continue;

      // Percentiles
      const pRows = await db.all<{ volume_usdt: number }>(`
        SELECT volume_usdt FROM liquidations
        WHERE symbol = ? AND event_time >= ?
        ORDER BY volume_usdt
      `, [symbol, cutoffMs]);

      const getPercentile = (sorted: { volume_usdt: number }[], pct: number) => {
        const idx = Math.floor(sorted.length * pct / 100);
        return sorted[Math.min(idx, sorted.length - 1)]?.volume_usdt || 0;
      };

      const percentiles = {
        p50: Math.round(getPercentile(pRows, 50)),
        p75: Math.round(getPercentile(pRows, 75)),
        p90: Math.round(getPercentile(pRows, 90)),
        p95: Math.round(getPercentile(pRows, 95)),
        p99: Math.round(getPercentile(pRows, 99)),
      };

      // By direction
      const byDir = await db.all<{
        side: string; total: number; passed: number; total_vol: number;
      }>(`
        SELECT 
          side,
          COUNT(*) as total,
          SUM(CASE WHEN volume_usdt >= ? THEN 1 ELSE 0 END) as passed,
          ROUND(SUM(CASE WHEN volume_usdt >= ? THEN volume_usdt ELSE 0 END), 0) as total_vol
        FROM liquidations
        WHERE symbol = ? AND event_time >= ?
        GROUP BY side
      `, [avgThresh, avgThresh, symbol, cutoffMs]);

      const longLiqRow = byDir.find(r => r.side === 'SELL') || { total: 0, passed: 0, total_vol: 0 };
      const shortLiqRow = byDir.find(r => r.side === 'BUY') || { total: 0, passed: 0, total_vol: 0 };

      // What-if scenarios
      const multipliers = [
        { mult: 0.33, label: '33%' },
        { mult: 0.5, label: '50%' },
        { mult: 0.75, label: '75%' },
        { mult: 1.0, label: 'Current' },
        { mult: 1.5, label: '150%' },
        { mult: 2.0, label: '200%' },
      ];

      const scenarios: SymbolThresholdAnalysis['scenarios'] = [];
      for (const { mult, label } of multipliers) {
        const testThresh = avgThresh * mult;
        const row = await db.get<{ cnt: number }>(`
          SELECT COUNT(*) as cnt FROM liquidations
          WHERE symbol = ? AND event_time >= ? AND volume_usdt >= ?
        `, [symbol, cutoffMs, testThresh]);

        scenarios.push({
          thresholdMultiplier: mult,
          threshold: Math.round(testThresh),
          signalsPerDay: Math.round((row?.cnt || 0) / days * 10) / 10,
          passed: row?.cnt || 0,
          label,
        });
      }

      // Trade performance from trade_history DB
      let tradePerformance: SymbolThresholdAnalysis['tradePerformance'] | undefined;
      try {
        const trades = tradeHistoryDb.queryTrades({
          symbol,
          startTime: cutoffMs,
          status: 'FILLED',
        });
        
        const closingTrades = trades.filter(t => parseFloat(t.realizedPnl || '0') !== 0);
        if (closingTrades.length > 0) {
          const wins = closingTrades.filter(t => parseFloat(t.realizedPnl || '0') > 0);
          const losses = closingTrades.filter(t => parseFloat(t.realizedPnl || '0') < 0);
          tradePerformance = {
            wins: wins.length,
            losses: losses.length,
            netPnl: Math.round(closingTrades.reduce((s, t) => s + parseFloat(t.realizedPnl || '0'), 0) * 100) / 100,
            avgWin: wins.length > 0
              ? Math.round(wins.reduce((s, t) => s + parseFloat(t.realizedPnl || '0'), 0) / wins.length * 100) / 100
              : 0,
            avgLoss: losses.length > 0
              ? Math.round(losses.reduce((s, t) => s + parseFloat(t.realizedPnl || '0'), 0) / losses.length * 100) / 100
              : 0,
          };
        }
      } catch {
        // trade_history DB may not be available
      }

      symbolAnalyses.push({
        symbol,
        currentThreshold: { long: longThresh, short: shortThresh },
        totalLiqs: stats.total,
        avgVolume: stats.avg_vol,
        percentiles,
        passedThreshold: stats.passed,
        passRate: Math.round(stats.passed / stats.total * 1000) / 10,
        signalsPerDay: Math.round(stats.passed / days * 10) / 10,
        nearMiss50to100: stats.near_50_100,
        nearMiss25to50: stats.near_25_50,
        byDirection: {
          longLiqs: { total: longLiqRow.total, passed: longLiqRow.passed, totalVolume: longLiqRow.total_vol },
          shortLiqs: { total: shortLiqRow.total, passed: shortLiqRow.passed, totalVolume: shortLiqRow.total_vol },
        },
        scenarios,
        tradePerformance,
      });
    }

    // === Weekly P&L trend ===
    const weeklyPerformance: WeeklyPerformance[] = [];
    try {
      const weekCutoff = Date.now() - 30 * 86400 * 1000;
      const allTrades = tradeHistoryDb.queryTrades({ startTime: weekCutoff, status: 'FILLED' });
      const closingTrades = allTrades.filter(t => parseFloat(t.realizedPnl || '0') !== 0);
      
      // Group by week
      const byWeek = new Map<string, { wins: number; losses: number; pnls: number[]; winPnls: number[]; lossPnls: number[] }>();
      for (const t of closingTrades) {
        const d = new Date(t.updateTime);
        // ISO week
        const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000);
        const weekNum = Math.ceil((dayOfYear + 1) / 7);
        const weekKey = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
        
        if (!byWeek.has(weekKey)) {
          byWeek.set(weekKey, { wins: 0, losses: 0, pnls: [], winPnls: [], lossPnls: [] });
        }
        const w = byWeek.get(weekKey)!;
        const pnl = parseFloat(t.realizedPnl || '0');
        w.pnls.push(pnl);
        if (pnl > 0) { w.wins++; w.winPnls.push(pnl); }
        if (pnl < 0) { w.losses++; w.lossPnls.push(pnl); }
      }

      for (const [week, data] of Array.from(byWeek.entries()).sort((a, b) => b[0].localeCompare(a[0]))) {
        weeklyPerformance.push({
          week,
          wins: data.wins,
          losses: data.losses,
          netPnl: Math.round(data.pnls.reduce((s, p) => s + p, 0) * 100) / 100,
          avgWin: data.winPnls.length > 0
            ? Math.round(data.winPnls.reduce((s, p) => s + p, 0) / data.winPnls.length * 100) / 100
            : 0,
          avgLoss: data.lossPnls.length > 0
            ? Math.round(data.lossPnls.reduce((s, p) => s + p, 0) / data.lossPnls.length * 100) / 100
            : null,
        });
      }
    } catch {
      // trade_history DB may not exist
    }

    // === Untraded candidates ===
    const candidates = await db.all<{
      symbol: string; total_liqs: number; avg_vol: number;
      above_5k: number; above_10k: number; above_15k: number;
      max_vol: number;
    }>(`
      SELECT 
        symbol,
        COUNT(*) as total_liqs,
        ROUND(AVG(volume_usdt), 0) as avg_vol,
        COUNT(CASE WHEN volume_usdt >= 5000 THEN 1 END) as above_5k,
        COUNT(CASE WHEN volume_usdt >= 10000 THEN 1 END) as above_10k,
        COUNT(CASE WHEN volume_usdt >= 15000 THEN 1 END) as above_15k,
        ROUND(MAX(volume_usdt), 0) as max_vol
      FROM liquidations
      WHERE event_time >= ?
        AND symbol NOT IN (${configuredSymbols.map(() => '?').join(',')})
      GROUP BY symbol
      HAVING above_5k >= 3
      ORDER BY above_5k DESC
      LIMIT 10
    `, [cutoffMs, ...configuredSymbols]);

    const untradedCandidates: UntradedCandidate[] = candidates.map(c => ({
      symbol: c.symbol,
      totalLiqs: c.total_liqs,
      avgVolume: c.avg_vol,
      above5k: c.above_5k,
      above10k: c.above_10k,
      above15k: c.above_15k,
      maxVolume: c.max_vol,
      signalsPerDay5k: Math.round(c.above_5k / days * 10) / 10,
    }));

    return NextResponse.json({
      success: true,
      data: {
        analysisWindow: { days, cutoffMs, generatedAt: Date.now() },
        symbols: symbolAnalyses,
        weeklyPerformance,
        untradedCandidates,
      },
    });
  } catch (error) {
    console.error('API error - threshold analysis:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to compute threshold analysis' },
      { status: 500 }
    );
  }
}
