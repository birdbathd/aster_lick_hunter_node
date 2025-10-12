'use client';

import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';

interface SessionPnL {
  startTime: number;
  startBalance: number;
  currentBalance: number;
  startingAccumulatedPnl: number;
  currentAccumulatedPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  commission: number;
  fundingFee: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  maxDrawdown: number;
  peak: number;
}

export default function SessionPerformanceCard() {
  const [sessionPnL, setSessionPnL] = useState<SessionPnL | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSessionData = async () => {
      try {
        const response = await fetch('/api/pnl/session');
        if (response.ok) {
          const data = await response.json();
          setSessionPnL(data.session);
        }
      } catch (error) {
        console.error('Failed to fetch session PnL:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSessionData();
  }, []);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'pnl_update' && message.data?.session) {
        setSessionPnL(message.data.session);
        setIsLoading(false);
      }
    };

    const cleanup = websocketService.addMessageHandler(handleMessage);
    return cleanup;
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDuration = (startTime: number) => {
    const duration = Date.now() - startTime;
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  if (isLoading || !sessionPnL) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Session</span>
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    );
  }

  const isProfit = sessionPnL.realizedPnl >= 0;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Activity className="h-4 w-4 text-muted-foreground" />
      <div className="flex flex-col">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Session</span>
          <Badge variant="secondary" className="h-3 text-[9px] px-0.5">
            {formatDuration(sessionPnL.startTime)}
          </Badge>
        </div>
        <span className={`text-sm font-semibold whitespace-nowrap ${
          isProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
        }`}>
          {formatCurrency(sessionPnL.realizedPnl)}
        </span>
      </div>
    </div>
  );
}
