'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Activity,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  BarChart3,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────
interface SymbolAnalysis {
  symbol: string;
  currentThreshold: { long: number; short: number };
  totalLiqs: number;
  avgVolume: number;
  percentiles: { p50: number; p75: number; p90: number; p95: number; p99: number };
  passedThreshold: number;
  passRate: number;
  signalsPerDay: number;
  nearMiss50to100: number;
  nearMiss25to50: number;
  byDirection: {
    longLiqs: { total: number; passed: number; totalVolume: number };
    shortLiqs: { total: number; passed: number; totalVolume: number };
  };
  scenarios: Array<{
    thresholdMultiplier: number;
    threshold: number;
    signalsPerDay: number;
    passed: number;
    label: string;
  }>;
  tradePerformance?: {
    wins: number;
    losses: number;
    netPnl: number;
    avgWin: number;
    avgLoss: number;
  };
}

interface WeeklyPerf {
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

interface AnalysisData {
  analysisWindow: { days: number; cutoffMs: number; generatedAt: number };
  symbols: SymbolAnalysis[];
  weeklyPerformance: WeeklyPerf[];
  untradedCandidates: UntradedCandidate[];
}

// ─── Helpers ─────────────────────────────────────────────────────
function formatUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function signalRating(perDay: number): { label: string; color: string } {
  if (perDay >= 10) return { label: 'Very Active', color: 'text-green-400' };
  if (perDay >= 5) return { label: 'Active', color: 'text-green-400' };
  if (perDay >= 2) return { label: 'Moderate', color: 'text-yellow-400' };
  if (perDay >= 0.5) return { label: 'Low', color: 'text-orange-400' };
  return { label: 'Dead', color: 'text-red-400' };
}

function thresholdAssessment(sym: SymbolAnalysis): { verdict: string; icon: React.ReactNode; color: string; detail: string } {
  const pd = sym.signalsPerDay;
  const nearMissRatio = sym.totalLiqs > 0 ? sym.nearMiss50to100 / sym.totalLiqs : 0;

  // Too few signals — threshold too high
  if (pd < 0.5) {
    return {
      verdict: 'Too High',
      icon: <TrendingDown className="w-4 h-4" />,
      color: 'text-red-400',
      detail: `Only ${pd}/day signals. ${sym.nearMiss50to100} near-misses at 50-100% of threshold.`,
    };
  }

  // Many near-misses — leaving money on table
  if (nearMissRatio > 0.15 && pd < 5) {
    return {
      verdict: 'Could Lower',
      icon: <AlertTriangle className="w-4 h-4" />,
      color: 'text-yellow-400',
      detail: `${sym.nearMiss50to100} near-misses (${(nearMissRatio * 100).toFixed(0)}% of all liqs). Lowering threshold could capture more.`,
    };
  }

  // Very high frequency — threshold might be too low
  if (pd > 20) {
    return {
      verdict: 'Consider Raising',
      icon: <TrendingUp className="w-4 h-4" />,
      color: 'text-blue-400',
      detail: `${pd}/day signals is very active. Higher threshold = higher quality but fewer trades.`,
    };
  }

  // Good range
  return {
    verdict: 'Good',
    icon: <CheckCircle2 className="w-4 h-4" />,
    color: 'text-green-400',
    detail: `${pd}/day signals is a healthy rate. Pass rate: ${sym.passRate}%.`,
  };
}

// ─── Volume Bar Component ────────────────────────────────────────
function VolumeBar({ value, max, label, color = 'bg-blue-500' }: { value: number; max: number; label: string; color?: string }) {
  const pct = max > 0 ? Math.min(value / max * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 text-right text-muted-foreground">{label}</span>
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right font-mono">{value}</span>
    </div>
  );
}

// ─── Symbol Detail Card ──────────────────────────────────────────
function SymbolCard({ sym, maxSignals }: { sym: SymbolAnalysis; maxSignals: number }) {
  const [expanded, setExpanded] = useState(false);
  const assessment = thresholdAssessment(sym);
  const rating = signalRating(sym.signalsPerDay);
  const perf = sym.tradePerformance;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            <CardTitle className="text-base font-mono">{sym.symbol}</CardTitle>
            <Badge variant="outline" className="text-xs font-mono">
              {formatUSD(sym.currentThreshold.long)}
            </Badge>
            <span className={`text-xs font-medium ${assessment.color} flex items-center gap-1`}>
              {assessment.icon} {assessment.verdict}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className={`font-medium ${rating.color}`}>
              {sym.signalsPerDay}/day
            </span>
            {perf && (
              <span className={`font-mono ${perf.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {perf.netPnl >= 0 ? '+' : ''}{perf.netPnl.toFixed(2)}
                <span className="text-muted-foreground text-xs ml-1">
                  ({perf.wins}W/{perf.losses}L)
                </span>
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Assessment detail */}
          <p className="text-sm text-muted-foreground">{assessment.detail}</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Volume Distribution */}
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Volume Percentiles</h4>
              <div className="space-y-1">
                {(['p50', 'p75', 'p90', 'p95', 'p99'] as const).map(p => (
                  <VolumeBar
                    key={p}
                    value={sym.percentiles[p]}
                    max={sym.percentiles.p99}
                    label={p.toUpperCase()}
                    color={sym.percentiles[p] >= sym.currentThreshold.long ? 'bg-green-500' : 'bg-zinc-600'}
                  />
                ))}
                <div className="mt-1 text-xs text-muted-foreground">
                  Threshold: {formatUSD(sym.currentThreshold.long)} — 
                  sits at ~P{sym.passRate < 5 ? '95+' : sym.passRate < 10 ? '90' : sym.passRate < 25 ? '75' : '50'}
                </div>
              </div>
            </div>

            {/* Direction Split */}
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Direction Split</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-green-400 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Long signals</span>
                  <span className="font-mono">{sym.byDirection.longLiqs.passed} / {sym.byDirection.longLiqs.total}</span>
                </div>
                <Progress value={sym.byDirection.longLiqs.total > 0 ? sym.byDirection.longLiqs.passed / sym.byDirection.longLiqs.total * 100 : 0} className="h-2" />
                <div className="flex justify-between text-sm">
                  <span className="text-red-400 flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Short signals</span>
                  <span className="font-mono">{sym.byDirection.shortLiqs.passed} / {sym.byDirection.shortLiqs.total}</span>
                </div>
                <Progress value={sym.byDirection.shortLiqs.total > 0 ? sym.byDirection.shortLiqs.passed / sym.byDirection.shortLiqs.total * 100 : 0} className="h-2" />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Near-misses: {sym.nearMiss50to100} at 50-100%, {sym.nearMiss25to50} at 25-50%
              </div>
            </div>

            {/* What-If Scenarios */}
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Threshold Scenarios</h4>
              <div className="space-y-1">
                {sym.scenarios.map(s => (
                  <div
                    key={s.label}
                    className={`flex justify-between text-xs py-0.5 px-1 rounded ${
                      s.thresholdMultiplier === 1 ? 'bg-muted font-medium' : ''
                    }`}
                  >
                    <span className="text-muted-foreground">
                      {s.label === 'Current' ? '→' : ''} {formatUSD(s.threshold)}
                    </span>
                    <span className="font-mono">
                      {s.signalsPerDay}/day
                      <span className="text-muted-foreground ml-1">({s.passed} total)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState('7');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/liquidations/threshold-analysis?days=${days}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Failed to load');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const maxSignalsPerDay = data ? Math.max(...data.symbols.map(s => s.signalsPerDay), 1) : 1;
  const totalNetPnl = data ? data.symbols.reduce((s, sym) => s + (sym.tradePerformance?.netPnl || 0), 0) : 0;
  const totalWins = data ? data.symbols.reduce((s, sym) => s + (sym.tradePerformance?.wins || 0), 0) : 0;
  const totalLosses = data ? data.symbols.reduce((s, sym) => s + (sym.tradePerformance?.losses || 0), 0) : 0;
  const totalSignalsPerDay = data ? data.symbols.reduce((s, sym) => s + sym.signalsPerDay, 0) : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6" /> Threshold Analytics
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Are your thresholds optimal? Compare liquidation volumes against current settings.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 day</SelectItem>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-red-500/50 bg-red-500/5">
            <CardContent className="p-4 text-red-400 text-sm">{error}</CardContent>
          </Card>
        )}

        {data && (
          <>
            {/* Summary Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Signals/Day</div>
                  <div className="text-2xl font-bold mt-1">{totalSignalsPerDay.toFixed(1)}</div>
                  <div className="text-xs text-muted-foreground">{data.symbols.length} symbols configured</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Win Rate</div>
                  <div className="text-2xl font-bold mt-1 text-green-400">
                    {totalWins + totalLosses > 0 ? ((totalWins / (totalWins + totalLosses)) * 100).toFixed(0) : 0}%
                  </div>
                  <div className="text-xs text-muted-foreground">{totalWins}W / {totalLosses}L ({days}d)</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Net P&L ({days}d)</div>
                  <div className={`text-2xl font-bold mt-1 ${totalNetPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {totalNetPnl >= 0 ? '+' : ''}${totalNetPnl.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">From closed positions</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Status</div>
                  <div className="text-2xl font-bold mt-1 flex items-center gap-2">
                    {data.symbols.filter(s => thresholdAssessment(s).verdict === 'Good').length}
                    <span className="text-sm font-normal text-green-400">/ {data.symbols.length} optimal</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {data.symbols.filter(s => thresholdAssessment(s).verdict === 'Too High').length} too high,{' '}
                    {data.symbols.filter(s => thresholdAssessment(s).verdict === 'Could Lower').length} could lower
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Per-Symbol Cards */}
            <div className="space-y-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="w-5 h-5" /> Per-Symbol Threshold Analysis
              </h2>
              {data.symbols
                .sort((a, b) => b.signalsPerDay - a.signalsPerDay)
                .map(sym => (
                  <SymbolCard key={sym.symbol} sym={sym} maxSignals={maxSignalsPerDay} />
                ))}
            </div>

            {/* Weekly Performance Trend */}
            {data.weeklyPerformance.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Weekly Performance Trend
                  </CardTitle>
                  <CardDescription>Last 30 days of trading — are things improving?</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Week</TableHead>
                        <TableHead className="text-right">Wins</TableHead>
                        <TableHead className="text-right">Losses</TableHead>
                        <TableHead className="text-right">Net P&L</TableHead>
                        <TableHead className="text-right">Avg Win</TableHead>
                        <TableHead className="text-right">Avg Loss</TableHead>
                        <TableHead>Trend</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.weeklyPerformance.map((w, i) => {
                        const prevWeek = data.weeklyPerformance[i + 1];
                        const trend = prevWeek ? w.netPnl - prevWeek.netPnl : 0;
                        return (
                          <TableRow key={w.week}>
                            <TableCell className="font-mono">{w.week}</TableCell>
                            <TableCell className="text-right text-green-400">{w.wins}</TableCell>
                            <TableCell className="text-right text-red-400">{w.losses}</TableCell>
                            <TableCell className={`text-right font-mono font-medium ${w.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {w.netPnl >= 0 ? '+' : ''}${w.netPnl.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono">${w.avgWin.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono">{w.avgLoss !== null ? `$${w.avgLoss.toFixed(2)}` : '—'}</TableCell>
                            <TableCell>
                              {trend > 0 ? (
                                <TrendingUp className="w-4 h-4 text-green-400" />
                              ) : trend < 0 ? (
                                <TrendingDown className="w-4 h-4 text-red-400" />
                              ) : (
                                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Untraded Candidates */}
            {data.untradedCandidates.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="w-4 h-4" /> Untraded Symbols with Activity
                  </CardTitle>
                  <CardDescription>
                    Symbols you&apos;re NOT trading that have meaningful liquidation volume
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="text-right">Total Liqs</TableHead>
                        <TableHead className="text-right">Avg Vol</TableHead>
                        <TableHead className="text-right">&gt;$5k</TableHead>
                        <TableHead className="text-right">&gt;$10k</TableHead>
                        <TableHead className="text-right">&gt;$15k</TableHead>
                        <TableHead className="text-right">Max Vol</TableHead>
                        <TableHead className="text-right">Signals/Day @5k</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.untradedCandidates.map(c => (
                        <TableRow key={c.symbol}>
                          <TableCell className="font-mono font-medium">{c.symbol}</TableCell>
                          <TableCell className="text-right">{c.totalLiqs}</TableCell>
                          <TableCell className="text-right font-mono">{formatUSD(c.avgVolume)}</TableCell>
                          <TableCell className="text-right">{c.above5k}</TableCell>
                          <TableCell className="text-right">{c.above10k}</TableCell>
                          <TableCell className="text-right">{c.above15k}</TableCell>
                          <TableCell className="text-right font-mono">{formatUSD(c.maxVolume)}</TableCell>
                          <TableCell className="text-right font-medium">{c.signalsPerDay5k}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Computing threshold analysis...</span>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
