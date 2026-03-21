'use client';

import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';
import dataStore from '@/lib/services/dataStore';

interface DailyPnL {
  date: string;
  realizedPnl: number;
  commission: number;
  fundingFee: number;
  insuranceClear: number;
  marketMerchantReward: number;
  apolloxRebate: number;
  usdfReward: number;
  netPnl: number;
  tradeCount: number;
}

interface PnLMetrics {
  totalPnl: number;
  totalRealizedPnl: number;
  totalCommission: number;
  totalFundingFee: number;
  totalInsuranceClear: number;
  totalMarketMerchantReward: number;
  totalApolloxRebate: number;
  totalUsdfReward: number;
  winRate: number;
  profitableDays: number;
  lossDays: number;
  bestDay: DailyPnL | null;
  worstDay: DailyPnL | null;
  avgDailyPnl: number;
  maxDrawdown: number;
  profitFactor: number;
  sharpeRatio: number;
}

export default function PerformanceCardInline() {
  const [pnlData, setPnlData] = useState<{ dailyPnL: DailyPnL[], metrics: PnLMetrics } | null>(null);
  const [totalBalance, setTotalBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const pnlResponse = await fetch('/api/income?range=24h');
        if (pnlResponse.ok) {
          const pnlData = await pnlResponse.json();
          setPnlData(pnlData);
        }
        const balanceData = await dataStore.fetchBalance();
        setTotalBalance(balanceData.totalBalance);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Refresh data when tab becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const handleBalanceUpdate = (data: any) => {
      setTotalBalance(data.totalBalance);
    };

    dataStore.on('balance:update', handleBalanceUpdate);

    const handleMessage = (message: any) => {
      if (message.type === 'pnl_update' || message.type === 'trade_update') {
        fetch('/api/income?range=24h')
          .then(async r => {
            const contentType = r.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              return r.json();
            }
            throw new Error('Non-JSON response');
          })
          .then(pnlData => setPnlData(pnlData))
          .catch(error => console.error('Failed to refresh PnL data:', error));
      }
    };

    const cleanup = websocketService.addMessageHandler(handleMessage);

    return () => {
      dataStore.off('balance:update', handleBalanceUpdate);
      cleanup();
    };
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    const formatted = Math.abs(value).toFixed(2);
    return `${value >= 0 ? '+' : '-'}${formatted}%`;
  };

  if (isLoading || !pnlData) {
    return (
      <div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
          <DollarSign className="h-2.5 w-2.5" />
          <span>24H Profit</span>
        </div>
        <Skeleton className="h-5 w-24" />
      </div>
    );
  }

  const totalPnL = pnlData.metrics.totalPnl;
  const totalTrades = pnlData.dailyPnL.reduce((sum, day) => sum + day.tradeCount, 0);
  const isProfit = totalPnL >= 0;
  const returnPercent = totalBalance > 0 ? (totalPnL / totalBalance) * 100 : 0;

  // Daily target: 1% return. Bar fills from 0→1% goal; overflows shown at 100%.
  const DAILY_TARGET_PCT = 1;
  const barPct = Math.min(Math.abs(returnPercent) / DAILY_TARGET_PCT * 100, 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wide">
        <DollarSign className="h-2.5 w-2.5" />
        <span>24H Profit</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex items-center gap-1">
          {isProfit ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-red-600" />
          )}
          <span className={`text-base font-semibold tabular-nums ${
            isProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {formatCurrency(totalPnL)}
          </span>
        </div>
        <Badge
          variant={isProfit ? "outline" : "destructive"}
          className={`h-4 text-[10px] px-1 ${
            isProfit
              ? 'border-green-600 text-green-600 dark:border-green-400 dark:text-green-400'
              : ''
          }`}
        >
          {formatPercentage(returnPercent)}
        </Badge>
        {totalTrades > 0 && (
          <>
            <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
            <span className="text-[10px] text-muted-foreground tabular-nums">{totalTrades} trades</span>
          </>
        )}
      </div>

      <div className="relative h-1 w-full max-w-[180px] bg-muted rounded-full overflow-hidden" title={`Daily target: ${DAILY_TARGET_PCT}% return`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isProfit
              ? barPct >= 100 ? 'bg-green-500' : 'bg-green-400/80'
              : 'bg-red-500/80'
          }`}
          style={{ width: `${barPct}%` }}
        />
        <div className="absolute right-0 top-0 h-full w-px bg-muted-foreground/40" />
      </div>
    </div>
  );
}
