'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Gauge,
  ArrowUpDown,
} from 'lucide-react';
import websocketService from '@/lib/services/websocketService';
import { cn } from '@/lib/utils';

interface TradeQualityScore {
  symbol: string;
  side: 'BUY' | 'SELL';
  totalScore: number;
  spikeScore: number;
  volumeTrendScore: number;
  regimeScore: number;
  metrics: {
    priceChangePercent: number;
    spikeTimeSeconds: number;
    spikeVelocity: number;
    recentVolumeRatio: number;
    vwapCrossCount: number;
    vwapCrossesPerHour: number;
    isChoppyRegime: boolean;
    isTrendingRegime: boolean;
    vwapDistance: number;
    isAboveVwap: boolean;
  };
  recommendation: 'STRONG' | 'NORMAL' | 'WEAK' | 'SKIP';
  positionSizeMultiplier: number;
  targetMultiplier: number;
  reasons: string[];
}

interface TradeOpportunity {
  symbol: string;
  side: 'BUY' | 'SELL';
  reason: string;
  liquidationVolume: number;
  priceImpact: number;
  confidence: number;
  qualityScore?: TradeQualityScore;
  qualityRecommendation?: string;
  blockType?: 'QUALITY_FILTER' | 'VWAP_FILTER' | 'CASCADE_PROTECTION';
  timestamp: number;
  signalPrice?: number;
}

interface FTAExitSignal {
  symbol: string;
  side: 'BUY' | 'SELL';
  exitType: 'FTA_PRICE' | 'TIME_INVALIDATION' | 'ABNORMAL_MAE';
  reason: string;
  confidence: number;
  timestamp: number;
}

type SignalFilter = 'ALL' | 'TAKEN' | 'SKIPPED';

export default function TradeQualityPanel({ className, isPassiveMode = false }: { className?: string; isPassiveMode?: boolean }) {
  const [recentOpportunities, setRecentOpportunities] = useState<TradeOpportunity[]>([]);
  const [ftaAlerts, setFtaAlerts] = useState<FTAExitSignal[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  const [filter, setFilter] = useState<SignalFilter>('ALL');
  const [showScoreStats, setShowScoreStats] = useState(false);
  const [scoreBreakdown, setScoreBreakdown] = useState<{
    score: number; label: string; trades: number; winRate: number;
    avgPnlPct: number; avgMaePct: number; avgMfePct: number;
    mfeMaeRatio: number; signalCount: number; executedCount: number;
  }[]>([]);

  const handleMessage = useCallback((message: any) => {
    if (message.type === 'trade_opportunity') {
      const opportunity: TradeOpportunity = {
        ...message.data,
        timestamp: Date.now()
      };
      setRecentOpportunities(prev => [opportunity, ...prev].slice(0, 50));
    } else if (message.type === 'fta_exit_signal') {
      const alert: FTAExitSignal = {
        ...message.data,
        timestamp: Date.now()
      };
      setFtaAlerts(prev => [alert, ...prev].slice(0, 5));
      setTimeout(() => {
        setFtaAlerts(prev => prev.filter(a => a.timestamp !== alert.timestamp));
      }, 30000);
    } else if (message.type === 'trade_blocked') {
      const blockType = message.data?.blockType;
      if (blockType === 'QUALITY_FILTER' || blockType === 'VWAP_FILTER' || blockType === 'CASCADE_PROTECTION') {
        const blockedOpp: TradeOpportunity = {
          symbol: message.data.symbol,
          side: message.data.side,
          reason: message.data.reason,
          liquidationVolume: message.data.liquidationVolume || 0,
          priceImpact: 0,
          confidence: 0,
          qualityScore: message.data.qualityScore,
          qualityRecommendation: blockType === 'VWAP_FILTER' ? 'VWAP' : blockType === 'CASCADE_PROTECTION' ? 'CASCADE' : 'SKIP',
          blockType: blockType,
          timestamp: Date.now(),
          signalPrice: message.data.signalPrice
        };
        setRecentOpportunities(prev => [blockedOpp, ...prev].slice(0, 50));
      }
    }
  }, []);

  useEffect(() => {
    const cleanupMessageHandler = websocketService.addMessageHandler(handleMessage);
    const cleanupConnectionListener = websocketService.addConnectionListener(setIsConnected);
    return () => {
      cleanupMessageHandler();
      cleanupConnectionListener();
    };
  }, [handleMessage]);

  // Load persisted data from database on mount
  useEffect(() => {
    const loadPersistedData = async () => {
      try {
        const signalsRes = await fetch('/api/trade-quality?limit=50');
        if (signalsRes.ok) {
          const data = await signalsRes.json();
          if (data.success && data.signals?.length > 0) {
            const opportunities: TradeOpportunity[] = data.signals.map((s: any) => ({
              symbol: s.symbol,
              side: s.side,
              reason: s.reason,
              liquidationVolume: s.liquidationVolume,
              priceImpact: s.priceImpact,
              confidence: s.confidence,
              qualityScore: {
                symbol: s.symbol,
                side: s.side,
                totalScore: s.totalScore,
                spikeScore: s.spikeScore,
                volumeTrendScore: s.volumeTrendScore,
                regimeScore: s.regimeScore,
                positionSizeMultiplier: s.positionSizeMultiplier,
                targetMultiplier: 1,
                metrics: {
                  priceChangePercent: s.priceChangePercent,
                  spikeTimeSeconds: s.spikeTimeSeconds,
                  spikeVelocity: s.spikeVelocity,
                  recentVolumeRatio: s.recentVolumeRatio,
                  vwapCrossCount: s.vwapCrossCount,
                  vwapCrossesPerHour: s.vwapCrossesPerHour,
                  isChoppyRegime: s.isChoppyRegime,
                  isTrendingRegime: s.isTrendingRegime,
                  vwapDistance: s.vwapDistance,
                  isAboveVwap: s.isAboveVwap
                },
                recommendation: s.recommendation,
                reasons: s.reasons || []
              },
              qualityRecommendation: s.blockReason === 'VWAP_FILTER' ? 'VWAP' : s.blockReason === 'CASCADE_PROTECTION' ? 'CASCADE' : s.recommendation,
              blockType: s.blockReason === 'VWAP_FILTER' ? 'VWAP_FILTER' : s.blockReason === 'CASCADE_PROTECTION' ? 'CASCADE_PROTECTION' : (s.wasBlocked ? 'QUALITY_FILTER' : undefined),
              timestamp: s.timestamp,
              signalPrice: s.signalPrice
            }));
            setRecentOpportunities(opportunities);
          }
        }

        const ftaRes = await fetch('/api/trade-quality?type=fta&limit=5');
        if (ftaRes.ok) {
          const data = await ftaRes.json();
          if (data.success && data.signals?.length > 0) {
            const recentAlerts = data.signals.filter((s: any) =>
              Date.now() - s.timestamp < 30000
            ).map((s: any) => ({
              symbol: s.symbol,
              side: s.side,
              exitType: s.exitType,
              reason: s.reason,
              confidence: s.confidence,
              timestamp: s.timestamp
            }));
            setFtaAlerts(recentAlerts);
          }
        }

        // Load score performance breakdown
        const breakdownRes = await fetch('/api/trade-quality?type=score-breakdown');
        if (breakdownRes.ok) {
          const data = await breakdownRes.json();
          if (data.success && data.breakdown) {
            setScoreBreakdown(data.breakdown);
          }
        }
      } catch (error) {
        console.error('Failed to load persisted trade quality data:', error);
      }
    };
    loadPersistedData();
  }, []);

  const formatTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  const getOutcome = (opp: TradeOpportunity): { label: string; color: string; icon: React.ReactNode } => {
    if (opp.blockType === 'CASCADE_PROTECTION') {
      return { label: 'CASCADE', color: 'text-purple-400 bg-purple-500/15 border-purple-500/30', icon: <AlertTriangle className="h-3 w-3" /> };
    }
    if (opp.blockType === 'VWAP_FILTER') {
      return { label: 'VWAP', color: 'text-orange-400 bg-orange-500/15 border-orange-500/30', icon: <ArrowUpDown className="h-3 w-3" /> };
    }
    if (opp.blockType === 'QUALITY_FILTER') {
      return { label: 'SKIP', color: 'text-red-400 bg-red-500/15 border-red-500/30', icon: <XCircle className="h-3 w-3" /> };
    }
    // Taken trades — show quality recommendation
    if (opp.qualityRecommendation === 'STRONG') {
      return { label: 'STRONG', color: 'text-green-400 bg-green-500/15 border-green-500/30', icon: <CheckCircle2 className="h-3 w-3" /> };
    }
    if (opp.qualityRecommendation === 'WEAK') {
      return { label: 'WEAK', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30', icon: <AlertTriangle className="h-3 w-3" /> };
    }
    if (opp.qualityRecommendation === 'SKIP') {
      // In passive mode, SKIP recommendation still got taken — show as WEAK/TAKEN not SKIP
      return { label: 'LOW-Q', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30', icon: <AlertTriangle className="h-3 w-3" /> };
    }
    return { label: 'NORMAL', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30', icon: <CheckCircle2 className="h-3 w-3" /> };
  };

  // Only count as blocked if there's an actual blockType (not just a low quality recommendation)
  const isBlocked = (opp: TradeOpportunity) =>
    opp.blockType === 'VWAP_FILTER' || opp.blockType === 'QUALITY_FILTER' || opp.blockType === 'CASCADE_PROTECTION';

  // Compute stats
  const taken = recentOpportunities.filter(o => !isBlocked(o));
  const skipped = recentOpportunities.filter(o => isBlocked(o));
  const avgScore = recentOpportunities.length > 0
    ? (recentOpportunities.reduce((sum, o) => sum + (o.qualityScore?.totalScore || 0), 0) / recentOpportunities.length)
    : 0;

  // Filter the displayed list
  const filteredOpportunities = filter === 'ALL'
    ? recentOpportunities
    : filter === 'TAKEN'
    ? taken
    : skipped;

  const formatPrice = (price: number) => {
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    if (price < 100) return price.toFixed(2);
    return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  return (
    <div className={cn("rounded-lg border bg-card overflow-hidden", className)}>

      {/* Header row — click to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent/30 transition-colors border-b border-transparent data-[open=true]:border-border text-left"
        data-open={isExpanded}
      >
        <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium">Signal Feed</span>
        <span className="text-xs text-muted-foreground">{recentOpportunities.length}</span>

        <div className="flex items-center gap-2 ml-auto text-xs">
          <span className="text-green-400 tabular-nums">{taken.length}✓</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-red-400 tabular-nums">{skipped.length}✗</span>
          {avgScore > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className={cn("tabular-nums", avgScore >= 2 ? "text-green-400" : avgScore >= 1 ? "text-blue-400" : "text-yellow-400")}>
                Q{avgScore.toFixed(1)}
              </span>
            </>
          )}
          <span className={cn(
            "text-[9px] px-1.5 py-0.5 rounded font-medium",
            isConnected
              ? isPassiveMode ? "bg-yellow-500/15 text-yellow-400" : "bg-green-500/15 text-green-400"
              : "bg-muted text-muted-foreground"
          )}>
            {isConnected ? (isPassiveMode ? 'Passive' : 'Live') : 'Off'}
          </span>
          <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
        </div>
      </button>

      {isExpanded && (
        <div className="divide-y divide-border/30">

          {/* FTA alerts */}
          {ftaAlerts.length > 0 && (
            <div className="px-3 py-2 bg-yellow-500/5 border-b border-yellow-500/20">
              <div className="flex items-center gap-1.5 text-[10px] text-yellow-400 mb-1">
                <AlertTriangle className="h-3 w-3 animate-pulse" />
                <span className="font-medium uppercase tracking-wide">Early Exit</span>
              </div>
              {ftaAlerts.map((alert, idx) => (
                <div key={`fta-${alert.timestamp}-${idx}`} className="text-[10px] flex items-center justify-between text-muted-foreground">
                  <span><span className="text-foreground font-medium">{alert.symbol}</span> — {alert.reason}</span>
                  <span className="ml-3 tabular-nums">{formatTime(alert.timestamp)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Filter tabs + stats toggle */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/30">
            {(['ALL', 'TAKEN', 'SKIPPED'] as SignalFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded transition-colors",
                  filter === f
                    ? f === 'TAKEN' ? "bg-green-500/20 text-green-400"
                      : f === 'SKIPPED' ? "bg-red-500/20 text-red-400"
                      : "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f} {f === 'ALL' ? recentOpportunities.length : f === 'TAKEN' ? taken.length : skipped.length}
              </button>
            ))}
            {scoreBreakdown.length > 0 && (
              <button
                onClick={() => setShowScoreStats(v => !v)}
                className="ml-auto text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <ArrowUpDown className="h-2.5 w-2.5" />
                Stats
              </button>
            )}
          </div>

          {/* Score breakdown table */}
          {showScoreStats && scoreBreakdown.length > 0 && (() => {
            const maxPnl = Math.max(...scoreBreakdown.map(r => r.avgPnlPct));
            const scoreColors: Record<string, string> = {
              STRONG: 'text-green-400', NORMAL: 'text-blue-400', WEAK: 'text-yellow-400', SKIP: 'text-red-400',
            };
            const barColors: Record<string, string> = {
              STRONG: 'bg-green-500', NORMAL: 'bg-blue-500', WEAK: 'bg-yellow-500', SKIP: 'bg-red-500',
            };
            return (
              <div className="border-b border-border/30">
                <div className="grid grid-cols-[52px_1fr_40px_44px_40px] px-3 py-1 bg-muted/20 text-[9px] text-muted-foreground uppercase tracking-wide">
                  <span>Score</span><span>Avg PnL</span><span className="text-right">Win%</span><span className="text-right">MFE/MAE</span><span className="text-right">Sigs</span>
                </div>
                {scoreBreakdown.map((row) => (
                  <div key={row.score} className="grid grid-cols-[52px_1fr_40px_44px_40px] px-3 py-1.5 items-center border-t border-border/20 text-[10px]">
                    <span className={cn("font-mono font-medium", scoreColors[row.label])}>{row.score}/3</span>
                    <div className="flex items-center gap-1.5 pr-2">
                      <div className="flex-1 h-1 bg-muted/40 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", barColors[row.label])} style={{ width: maxPnl > 0 ? `${(row.avgPnlPct / maxPnl) * 100}%` : '0%' }} />
                      </div>
                      <span className={cn("font-mono tabular-nums", row.avgPnlPct >= 0 ? 'text-green-400' : 'text-red-400')}>+{row.avgPnlPct.toFixed(2)}%</span>
                    </div>
                    <span className={cn("text-right font-mono tabular-nums", row.winRate >= 95 ? 'text-green-400' : row.winRate >= 80 ? 'text-yellow-400' : 'text-red-400')}>{row.winRate.toFixed(0)}%</span>
                    <span className={cn("text-right font-mono tabular-nums", row.mfeMaeRatio >= 1.2 ? 'text-green-400' : row.mfeMaeRatio >= 0.8 ? 'text-yellow-400' : 'text-red-400')}>{row.mfeMaeRatio.toFixed(2)}</span>
                    <span className="text-right text-muted-foreground tabular-nums">{row.signalCount}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Signal rows — Aster-style flat table */}
          <div className="max-h-[300px] overflow-y-auto">
            {/* Column header */}
            <div className="grid grid-cols-[16px_90px_64px_1fr_60px_56px_32px] gap-0 px-3 py-1 bg-muted/20 text-[9px] text-muted-foreground uppercase tracking-wide sticky top-0">
              <span></span>
              <span>Symbol</span>
              <span>Score</span>
              <span>Reason</span>
              <span className="text-right">Liq $</span>
              <span className="text-right">Outcome</span>
              <span className="text-right">Age</span>
            </div>

            {filteredOpportunities.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {filter === 'ALL' ? 'Waiting for signals…' : `No ${filter.toLowerCase()} signals`}
              </div>
            ) : (
              filteredOpportunities.map((opp, idx) => {
                const outcome = getOutcome(opp);
                const blocked = isBlocked(opp);
                const isOpen = expandedSignal === idx;
                const qs = opp.qualityScore;

                return (
                  <div
                    key={`${opp.symbol}-${opp.timestamp}-${idx}`}
                    className={cn("border-t border-border/20 transition-colors cursor-pointer", isOpen ? "bg-accent/20" : "hover:bg-accent/10", blocked && "opacity-60")}
                    onClick={() => setExpandedSignal(isOpen ? null : idx)}
                  >
                    {/* Main row */}
                    <div className="grid grid-cols-[16px_90px_64px_1fr_60px_56px_32px] gap-0 px-3 py-1.5 items-center text-xs">

                      {/* Direction dot */}
                      <span className={opp.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>
                        {opp.side === 'BUY' ? '▲' : '▼'}
                      </span>

                      {/* Symbol */}
                      <span className="font-medium font-mono truncate">{opp.symbol.replace('USDT', '')}</span>

                      {/* S/V/R score */}
                      {qs ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={cn(
                              "font-mono text-[10px] cursor-help",
                              qs.totalScore >= 2 ? "text-green-400" : qs.totalScore === 1 ? "text-yellow-400" : "text-muted-foreground"
                            )}>
                              {qs.spikeScore}/{qs.volumeTrendScore}/{qs.regimeScore}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[240px] text-left text-xs leading-relaxed">
                            <p className="font-semibold mb-1">Quality {qs.totalScore}/3 (S/V/R)</p>
                            <p>Spike {qs.spikeScore === 1 ? '✅' : '❌'} · Vol {qs.volumeTrendScore === 1 ? '✅' : '❌'} · Regime {qs.regimeScore === 1 ? '✅' : '❌'}</p>
                            <p className="mt-1 opacity-70 text-[10px]">3=STRONG 1.5× · 2=NORMAL · 1=WEAK 0.5× · 0=SKIP</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-muted-foreground/30 text-[10px]">—</span>}

                      {/* Reason (truncated) */}
                      <span className="text-[10px] text-muted-foreground truncate px-1" title={opp.reason}>{opp.reason}</span>

                      {/* Liq volume */}
                      <span className="text-[10px] text-muted-foreground text-right font-mono tabular-nums">
                        {opp.liquidationVolume > 0 ? `$${opp.liquidationVolume >= 1000 ? `${(opp.liquidationVolume / 1000).toFixed(1)}k` : opp.liquidationVolume.toFixed(0)}` : '—'}
                      </span>

                      {/* Outcome */}
                      <span className={cn("text-right text-[9px] font-medium tabular-nums", outcome.color.split(' ')[0])}>
                        {outcome.label}
                      </span>

                      {/* Age */}
                      <span className="text-[10px] text-muted-foreground text-right tabular-nums">{formatTime(opp.timestamp)}</span>
                    </div>

                    {/* Expanded detail panel */}
                    {isOpen && (
                      <div className="px-3 pb-2.5 pt-0 space-y-2 border-t border-border/20 mt-0">
                        {blocked && opp.reason && (
                          <div className={cn("text-[10px] px-2 py-1 rounded flex items-start gap-1.5",
                            opp.blockType === 'CASCADE_PROTECTION' ? "bg-purple-500/10 text-purple-300"
                            : opp.blockType === 'VWAP_FILTER' ? "bg-orange-500/10 text-orange-300"
                            : "bg-red-500/10 text-red-300"
                          )}>
                            <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                            <span>{opp.reason}</span>
                          </div>
                        )}

                        {qs?.metrics && (
                          <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                            {[
                              { label: 'Move', value: `${qs.metrics.priceChangePercent.toFixed(2)}%`, good: Math.abs(qs.metrics.priceChangePercent) >= 0.5 },
                              { label: 'Spike', value: qs.metrics.spikeTimeSeconds === 0 ? 'none' : `${qs.metrics.spikeTimeSeconds.toFixed(1)}s`, good: qs.metrics.spikeTimeSeconds > 0 && qs.metrics.spikeTimeSeconds < 30 },
                              { label: 'Vol', value: `${qs.metrics.recentVolumeRatio.toFixed(2)}×`, good: qs.metrics.recentVolumeRatio <= 1.1 },
                              { label: 'VWAP', value: `${qs.metrics.vwapDistance.toFixed(2)}%`, good: qs.metrics.isChoppyRegime },
                            ].map(m => (
                              <div key={m.label} className="bg-muted/30 rounded px-1.5 py-1">
                                <span className="text-muted-foreground block text-[9px] uppercase tracking-wide">{m.label}</span>
                                <span className={m.good ? 'text-green-400' : 'text-muted-foreground'}>{m.value}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {qs?.reasons && qs.reasons.length > 0 && (
                          <div className="text-[10px] text-muted-foreground space-y-0.5 pl-0.5">
                            {qs.reasons.map((r, i) => <p key={i}>· {r}</p>)}
                          </div>
                        )}

                        {qs && qs.positionSizeMultiplier !== 1 && (
                          <p className="text-[10px]">
                            <span className="text-muted-foreground">Size: </span>
                            <span className={qs.positionSizeMultiplier > 1 ? 'text-green-400 font-medium' : 'text-yellow-400 font-medium'}>{qs.positionSizeMultiplier}×</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
