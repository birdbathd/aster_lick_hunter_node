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
  const { isConnected } = useBotStatus();
  const [health, setHealth] = useState<HealthState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Track previous connection state to reset dismissed flag on reconnect
  const [wasConnected, setWasConnected] = useState(false);

  useEffect(() => {
    if (isConnected && !wasConnected) {
      setWasConnected(true);
      setDismissed(false); // re-show any banner when reconnected
    } else if (!isConnected) {
      setWasConnected(false);
    }
  }, [isConnected, wasConnected]);

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
  if (isConnected && (!health || !health.isPaused)) return null;

  // WS disconnected
  if (!isConnected) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-red-950/80 border-b border-red-800 text-red-200 text-xs">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">Bot disconnected</span>
        <span className="text-red-400">— real-time prices and position updates are unavailable. Check the bot service.</span>
        <button onClick={() => setDismissed(true)} className="ml-auto text-red-400 hover:text-red-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

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
        <span className="text-orange-500 italic ml-1">Close losing positions or raise the threshold in Config → Global Settings to resume.</span>
        <button onClick={() => setDismissed(true)} className="ml-auto text-orange-500 hover:text-orange-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return null;
}