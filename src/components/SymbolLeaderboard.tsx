'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Trophy } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';

interface SymbolRow {
  symbol: string;
  realizedPnl: number;
  commission: number;
  funding: number;
  netProfit: number;
  tradeCount: number;
}

function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function SymbolLeaderboard() {
  const [rows, setRows] = useState<SymbolRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trades/stats?leaderboard=1&startTime=${todayStartMs()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.leaderboard)) {
          setRows(data.leaderboard.filter((r: SymbolRow) => r.tradeCount > 0 || Math.abs(r.netProfit) > 0.001));
        }
      }
    } catch {
      // silently ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const handleMessage = (msg: any) => {
      if (msg.type === 'pnl_update' || msg.type === 'trade_update') load();
    };
    const cleanup = websocketService.addMessageHandler(handleMessage);
    return cleanup;
  }, [load]);

  if (isLoading || rows.length === 0) return null;

  const totalNet = rows.reduce((s, r) => s + r.netProfit, 0);

  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Today&apos;s Symbol Breakdown</span>
        <Badge
          variant="outline"
          className={`ml-auto h-4 text-[10px] px-1.5 ${totalNet >= 0 ? 'border-green-600 text-green-600' : 'border-red-500 text-red-500'}`}
        >
          {totalNet >= 0 ? '+' : ''}{totalNet.toFixed(2)} total
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => {
          const isPos = r.netProfit >= 0;
          const absStr = Math.abs(r.netProfit).toFixed(2);
          return (
            <div
              key={r.symbol}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] border ${
                isPos
                  ? 'border-green-600/40 bg-green-600/5 text-green-400'
                  : 'border-red-500/40 bg-red-500/5 text-red-400'
              }`}
              title={`Realized: $${r.realizedPnl.toFixed(2)} | Fees+Funding: $${(r.commission + r.funding).toFixed(2)}`}
            >
              {isPos
                ? <TrendingUp className="h-2.5 w-2.5 shrink-0" />
                : <TrendingDown className="h-2.5 w-2.5 shrink-0" />}
              <span className="font-medium">{r.symbol.replace('USDT', '')}</span>
              <span className="font-mono">{isPos ? '+' : '-'}${absStr}</span>
              {r.tradeCount > 0 && (
                <span className="text-muted-foreground">×{r.tradeCount}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
