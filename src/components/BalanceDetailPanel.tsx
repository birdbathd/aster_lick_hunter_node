'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Trophy, AlertTriangle, Minus, Flame } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface DayData {
  date: string;
  realizedPnl: number;
  commission: number;
  funding: number;
  rebates: number;
  net: number;
  tradeCount: number;
}

interface Props {
  walletBalance: number;
}

type Range = 7 | 14 | 30 | 60;

function fmt$(n: number, decimals = 2): string {
  const abs = Math.abs(n).toFixed(decimals);
  return `${n < 0 ? '-' : n > 0 ? '+' : ''}$${abs}`;
}
function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function BalanceDetailPanel({ walletBalance }: Props) {
  const [allData, setAllData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>(30);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/balance/trend?days=60')
      .then(r => r.json())
      .then(d => { if (!cancelled) { setAllData(d.dailyData ?? []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const days = useMemo(() => {
    if (!allData.length) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - range);
    const ymd = cutoff.toISOString().slice(0, 10);
    return allData.filter(d => d.date >= ymd);
  }, [allData, range]);

  // Stats
  const stats = useMemo(() => {
    if (!days.length) return null;
    const nets = days.map(d => d.net);
    const winDays = nets.filter(n => n > 0.001).length;
    const lossDays = nets.filter(n => n < -0.001).length;
    const totalDays = days.length;
    const totalNet = nets.reduce((a, b) => a + b, 0);
    const avgDaily = totalNet / totalDays;
    const best = days.reduce((a, b) => b.net > a.net ? b : a);
    const worst = days.reduce((a, b) => b.net < a.net ? b : a);

    // Streak (consecutive green or red days from today backwards, skip today if no data yet)
    let streak = 0;
    let streakDir: 'green' | 'red' | 'none' = 'none';
    const reversed = [...days].reverse();
    for (const d of reversed) {
      if (Math.abs(d.net) < 0.001) continue; // skip zero days
      if (streakDir === 'none') {
        streakDir = d.net > 0 ? 'green' : 'red';
        streak = 1;
      } else if ((d.net > 0 && streakDir === 'green') || (d.net < 0 && streakDir === 'red')) {
        streak++;
      } else {
        break;
      }
    }

    // Compound return: (current - start) / start
    const startBal = walletBalance - totalNet;
    const compoundPct = startBal > 0 ? (totalNet / startBal) * 100 : 0;

    return { winDays, lossDays, totalDays, totalNet, avgDaily, best, worst, streak, streakDir, compoundPct };
  }, [days, walletBalance]);

  // Today's P&L (last entry in allData matching today's date)
  const today = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return allData.find(d => d.date === todayStr) ?? null;
  }, [allData]);

  // Sorted days for table: most recent first
  const tableRows = useMemo(() => [...days].reverse(), [days]);

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      </div>
    );
  }

  if (!days.length || !stats) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        No income data available for this period.
      </div>
    );
  }

  const todayPct = walletBalance > 0 && today ? (today.net / (walletBalance - (today?.net ?? 0))) * 100 : 0;

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Header row + range selector */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <div>
            <span className="text-xs text-muted-foreground">Today</span>
            <div className={`text-base font-semibold leading-tight ${today && today.net >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {today ? fmt$(today.net) : '—'}
              <span className="text-xs font-normal ml-1 text-muted-foreground">
                {today ? fmtPct(todayPct) : ''}
              </span>
            </div>
          </div>
          <div className="w-px h-8 bg-border" />
          <div>
            <span className="text-xs text-muted-foreground">{range}d return</span>
            <div className={`text-base font-semibold leading-tight ${stats.totalNet >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {fmt$(stats.totalNet)}
              <span className="text-xs font-normal ml-1 text-muted-foreground">{fmtPct(stats.compoundPct)}</span>
            </div>
          </div>
          <div className="w-px h-8 bg-border" />
          {/* Streak */}
          <div className="flex items-center gap-1">
            {stats.streakDir === 'green' ? (
              <Flame className="h-4 w-4 text-amber-400" />
            ) : stats.streakDir === 'red' ? (
              <AlertTriangle className="h-4 w-4 text-red-400" />
            ) : (
              <Minus className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <span className="text-xs text-muted-foreground">Streak</span>
              <div className={`text-base font-semibold leading-tight ${stats.streakDir === 'green' ? 'text-amber-400' : stats.streakDir === 'red' ? 'text-red-400' : 'text-muted-foreground'}`}>
                {stats.streak} {stats.streakDir === 'green' ? '🔥' : stats.streakDir === 'red' ? '❄️' : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Range buttons */}
        <div className="flex rounded-md border overflow-hidden">
          {([7, 14, 30, 60] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-[10px] font-medium border-r last:border-r-0 transition-colors cursor-pointer ${
                range === r ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
              }`}
            >
              {r}D
            </button>
          ))}
        </div>
      </div>

      {/* Daily table */}
      <div className="border-t max-h-56 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b">
              <th className="text-left px-4 py-1.5 text-muted-foreground font-medium">Date</th>
              <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Net P&L</th>
              <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Realized</th>
              <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Fees</th>
              <th className="text-right px-4 py-1.5 text-muted-foreground font-medium">Trades</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((d, i) => {
              const isToday = d.date === new Date().toISOString().slice(0, 10);
              const fees = d.commission + d.funding;
              return (
                <tr key={d.date} className={`border-b border-border/40 ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <td className="px-4 py-1.5 text-muted-foreground font-mono">
                    {isToday ? <span className="text-primary font-semibold">Today</span> : d.date.slice(5)}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-semibold font-mono tabular-nums ${
                    d.net > 0.001 ? 'text-green-500' : d.net < -0.001 ? 'text-red-500' : 'text-muted-foreground'
                  }`}>
                    {fmt$(d.net)}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                    d.realizedPnl > 0.001 ? 'text-green-400' : d.realizedPnl < -0.001 ? 'text-red-400' : 'text-muted-foreground'
                  }`}>
                    {fmt$(d.realizedPnl)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {fees !== 0 ? fmt$(fees) : '—'}
                  </td>
                  <td className="px-4 py-1.5 text-right text-muted-foreground">
                    {d.tradeCount > 0 ? d.tradeCount : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px border-t bg-border">
        {[
          { label: 'Avg / Day', value: fmt$(stats.avgDaily), color: stats.avgDaily >= 0 ? 'text-green-500' : 'text-red-500' },
          { label: 'Best Day', value: fmt$(stats.best.net), sub: stats.best.date.slice(5), color: 'text-green-500', icon: <Trophy className="h-3 w-3 text-amber-400 shrink-0" /> },
          { label: 'Worst Day', value: fmt$(stats.worst.net), sub: stats.worst.date.slice(5), color: 'text-red-500', icon: <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" /> },
          {
            label: 'Win Days',
            value: `${stats.winDays}/${stats.totalDays}`,
            sub: `${((stats.winDays / stats.totalDays) * 100).toFixed(0)}%`,
            color: stats.winDays / stats.totalDays >= 0.6 ? 'text-green-500' : 'text-amber-400',
          },
        ].map(s => (
          <div key={s.label} className="bg-card px-3 py-2">
            <div className="flex items-center gap-1 mb-0.5">
              {s.icon}
              <span className="text-[10px] text-muted-foreground">{s.label}</span>
            </div>
            <span className={`text-sm font-semibold ${s.color}`}>{s.value}</span>
            {s.sub && <span className="text-[10px] text-muted-foreground ml-1">{s.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
