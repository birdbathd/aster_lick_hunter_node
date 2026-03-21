'use client';

import { useState, useEffect } from 'react';
import { useBotStatus } from '@/hooks/useBotStatus';
import websocketService from '@/lib/services/websocketService';
import { WifiOff, ShieldOff, X } from 'lucide-react';

interface HealthState {
  isPaused: boolean;
  blockReason: string | null;
  unrealizedLossPercent: number;
  currentDrawdownPercent: number;
}

export default function MinimalBotStatus() {
  const { connectionState } = useBotStatus();
  const [health, setHealth] = useState<HealthState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Track previous connection state to reset dismissed flag on reconnect
  const [wasLive, setWasLive] = useState(false);

  useEffect(() => {
    if (connectionState === 'live' && !wasLive) {
      setWasLive(true);
      setDismissed(false); // re-show any banner when reconnected
    } else if (connectionState !== 'live') {
      setWasLive(false);
    }
  }, [connectionState, wasLive]);

  useEffect(() => {
    const cleanup = websocketService.addMessageHandler((msg) => {
      if (msg.type === 'account_health_update') {
        setHealth(msg.data);
        if (msg.data?.isPaused) setDismissed(false); // re-surface blocked banner
      }
    });
    return cleanup;
  }, []);

  // Nothing to show — everything is fine
  if (dismissed) return null;

  // Bot blocked / trading paused
  if (health?.isPaused) {
    const reason = health.blockReason || (
      health.unrealizedLossPercent > 0
        ? `Unrealized loss ${health.unrealizedLossPercent.toFixed(1)}% exceeds limit`
        : `Drawdown ${health.currentDrawdownPercent.toFixed(1)}% exceeds limit`
    );
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-orange-950/80 border-b border-orange-700 text-orange-200 text-xs">
        <ShieldOff className="h-3.5 w-3.5 shrink-0 text-orange-400" />
        <span className="font-medium text-orange-300">Trading paused</span>
        <span className="text-orange-400">— {reason}</span>
        <span className="text-orange-500 italic ml-1">Adjust risk settings or close the losing position to resume.</span>
        <button onClick={() => setDismissed(true)} className="ml-auto text-orange-500 hover:text-orange-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (connectionState === 'live') return null;

  // Last known status is still available, but live updates are interrupted
  if (connectionState === 'degraded') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/70 border-b border-amber-800 text-amber-100 text-xs">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">Live connection interrupted</span>
        <span className="text-amber-300">— showing the last known bot state while live updates reconnect.</span>
        <button onClick={() => setDismissed(true)} className="ml-auto text-amber-300 hover:text-amber-100">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // No live connection and no bot snapshot yet
  if (connectionState === 'offline') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-950/70 border-b border-slate-800 text-slate-200 text-xs">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">Waiting for bot connection</span>
        <span className="text-slate-400">— the dashboard is still loading snapshot data.</span>
        <button onClick={() => setDismissed(true)} className="ml-auto text-slate-400 hover:text-slate-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return null;
}
