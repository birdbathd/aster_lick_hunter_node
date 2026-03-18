'use client';

import React, { useState, useEffect, useMemo } from 'react';
import logger from '@/lib/utils/logger';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  Target,
  ShieldAlert,
  Heart,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import MinimalBotStatus from '@/components/MinimalBotStatus';
import LiquidationSidebar from '@/components/LiquidationSidebar';
import PositionTable from '@/components/PositionTable';
import TradingViewChart from '@/components/TradingViewChart';
import PnLChart from '@/components/PnLChart';
import PerformanceCardInline from '@/components/PerformanceCardInline';
import SessionPerformanceCard from '@/components/SessionPerformanceCard';
import TradeQualityPanel from '@/components/TradeQualityPanel';
import RecentOrdersTable from '@/components/RecentOrdersTable';
import RiskModeSelector from '@/components/RiskModeSelector';
import BalanceDetailPanel from '@/components/BalanceDetailPanel';
import { TradeSizeWarningModal } from '@/components/TradeSizeWarningModal';
import { PullToRefresh } from '@/components/PullToRefresh';
import { PaperTradingDashboard } from '@/components/PaperTradingDashboard';
import { useConfig } from '@/components/ConfigProvider';
import websocketService from '@/lib/services/websocketService';
import { useOrderNotifications } from '@/hooks/useOrderNotifications';
import { useErrorToasts } from '@/hooks/useErrorToasts';
import { useWebSocketUrl } from '@/hooks/useWebSocketUrl';
import { RateLimitToastListener } from '@/hooks/useRateLimitToasts';
import dataStore, { AccountInfo, Position } from '@/lib/services/dataStore';

interface BalanceStatus {
  source?: string;
  timestamp?: number;
  error?: string;
}

export default function DashboardPage() {
  const { config } = useConfig();
  const wsUrl = useWebSocketUrl();
  const [accountInfo, setAccountInfo] = useState<AccountInfo>({
    totalBalance: 0,
    availableBalance: 0,
    totalPositionValue: 0,
    totalPnL: 0,
  });
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>({});
  const [showBalanceDetail, setShowBalanceDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [positions, setPositions] = useState<Position[]>([]);
  const [markPrices, setMarkPrices] = useState<Record<string, number>>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [availableChartSymbols, setAvailableChartSymbols] = useState<string[]>([]);
  const [cascadeActive, setCascadeActive] = useState(false);
  const [cascadeCooldown, setCascadeCooldown] = useState<number | null>(null);
  const [healthPaused, setHealthPaused] = useState(false);
  const [healthDrawdown, setHealthDrawdown] = useState(0);
  const [healthBlockReason, setHealthBlockReason] = useState<string | null>(null);
  const [healthUnrealizedLoss, setHealthUnrealizedLoss] = useState(0);

  // Initialize toast notifications
  useOrderNotifications();
  useErrorToasts();

  useEffect(() => {
    // Update websocketService URL when wsUrl is available
    if (wsUrl) {
      websocketService.setUrl(wsUrl);
    }
  }, [wsUrl]);

  useEffect(() => {
    // Load initial data from data store
    const loadInitialData = async () => {
      try {
        const [balanceData, positionsData] = await Promise.all([
          dataStore.fetchBalance(),
          dataStore.fetchPositions()
        ]);
        setAccountInfo(balanceData);
        setPositions(positionsData);
        setBalanceStatus({ source: 'api', timestamp: Date.now() });
        
        // Fetch available symbols from liquidation database
        try {
          const liquidationSymbolsResp = await fetch('/api/liquidations/symbols');
          const liquidationSymbolsData = await liquidationSymbolsResp.json();
          if (liquidationSymbolsData.success && liquidationSymbolsData.symbols) {
            // Combine configured symbols with symbols that have liquidation data
            const configuredSymbols = config?.symbols ? Object.keys(config.symbols) : [];
            const allSymbols = Array.from(new Set([...configuredSymbols, ...liquidationSymbolsData.symbols]));
            setAvailableChartSymbols(allSymbols);
          }
        } catch (error) {
          logger.error('[Dashboard] Failed to fetch liquidation symbols:', error);
          // Fallback to configured symbols only
          if (config?.symbols) {
            setAvailableChartSymbols(Object.keys(config.symbols));
          }
        }

        // Fetch cascade protection state
        try {
          const cascadeResp = await fetch('/api/cascade');
          const cascadeData = await cascadeResp.json();
          if (cascadeData.success) {
            setCascadeActive(cascadeData.isActive || false);
            if (cascadeData.isActive && cascadeData.resumesAt) {
              setCascadeCooldown(cascadeData.resumesAt);
            }
          }
        } catch (error) {
          // Non-critical, cascade state will update via WebSocket
          logger.error('[Dashboard] Failed to fetch cascade state:', error);
        }
      } catch (error) {
        logger.error('[Dashboard] Failed to load initial data:', error);
        setBalanceStatus({ error: error instanceof Error ? error.message : 'Unknown error' });
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();

    // Listen to data store updates
    const handleBalanceUpdate = (data: AccountInfo & { source: string }) => {
      logger.debug('[Dashboard] Balance updated from data store:', data.source);
      setAccountInfo(data);
      setBalanceStatus({ source: data.source, timestamp: Date.now() });
      setIsLoading(false);
    };

    const handlePositionsUpdate = (data: Position[]) => {
      logger.debug('[Dashboard] Positions updated from data store');
      setPositions(data);
    };

    const handleMarkPricesUpdate = (prices: Record<string, number>) => {
      setMarkPrices(prices);
    };

    // Subscribe to data store events
    dataStore.on('balance:update', handleBalanceUpdate);
    dataStore.on('positions:update', handlePositionsUpdate);
    dataStore.on('markPrices:update', handleMarkPricesUpdate);

    // Set up WebSocket listener for real-time updates
    const handleWebSocketMessage = (message: any) => {
      // Handle cascade protection events
      if (message.type === 'cascade_detected') {
        setCascadeActive(true);
        if (message.data?.resumesAt) {
          setCascadeCooldown(message.data.resumesAt);
        }
      } else if (message.type === 'cascade_cleared') {
        setCascadeActive(false);
        setCascadeCooldown(null);
      } else if (message.type === 'account_health_update') {
        if (message.data) {
          setHealthPaused(message.data.isPaused || false);
          setHealthDrawdown(message.data.currentDrawdownPercent || 0);
          setHealthBlockReason(message.data.blockReason || null);
          setHealthUnrealizedLoss(message.data.unrealizedLossPercent || 0);
        }
      }
      // Forward all messages to data store for centralized handling
      // (including paper_balance_update, paper_position_opened, etc.)
      dataStore.handleWebSocketMessage(message);
    };

    const cleanupMessageHandler = websocketService.addMessageHandler(handleWebSocketMessage);

    // Cleanup on unmount
    return () => {
      dataStore.off('balance:update', handleBalanceUpdate);
      dataStore.off('positions:update', handlePositionsUpdate);
      dataStore.off('markPrices:update', handleMarkPricesUpdate);
      cleanupMessageHandler();
    };
  }, []); // No dependencies - only run once on mount

  // Refresh data manually if needed
  const handleRefresh = async () => {
    try {
      const [balanceData, positionsData] = await Promise.all([
        dataStore.fetchBalance(true), // Force refresh
        dataStore.fetchPositions(true)
      ]);
      setAccountInfo(balanceData);
      setPositions(positionsData);
      setBalanceStatus({ source: 'manual', timestamp: Date.now() });
    } catch (error) {
      logger.error('[Dashboard] Failed to refresh data:', error);
      setBalanceStatus({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    const formatted = Math.abs(value).toFixed(2);
    return `${value >= 0 ? '+' : '-'}${formatted}%`;
  };

  // Memoize volumeThresholds to prevent unnecessary re-fetching
  const volumeThresholds = useMemo(() => {
    if (!config?.symbols) return {};
    return Object.entries(config.symbols).reduce((acc, [symbol, cfg]) => ({
      ...acc,
      [symbol]: cfg.volumeThresholdUSDT
    }), {});
  }, [config?.symbols]);

  // Set default symbol when config loads
  useEffect(() => {
    if (config?.symbols && Object.keys(config.symbols).length > 0 && !selectedSymbol) {
      // First try to find a symbol with open positions
      const positionSymbols = positions.map(pos => pos.symbol);
      const symbolsWithPositions = Object.keys(config.symbols).filter(symbol => 
        positionSymbols.includes(symbol)
      );
      
      const defaultSymbol = symbolsWithPositions.length > 0 
        ? symbolsWithPositions[0]  // Use symbol with position
        : Object.keys(config.symbols)[0];  // Fallback to first configured symbol
        
      console.log(`[Dashboard] Setting default symbol: ${defaultSymbol}`, {
        availableSymbols: Object.keys(config.symbols),
        positionSymbols,
        symbolsWithPositions
      });
      setSelectedSymbol(defaultSymbol);
    }
  }, [config?.symbols, selectedSymbol, positions]);

  // Calculate live account info with real-time mark prices
  // This supplements the official balance data with live price updates
  const liveAccountInfo = useMemo(() => {
    if (positions.length === 0) {
      return accountInfo;
    }

    // Calculate live PnL based on current mark prices
    let liveTotalPnL = 0;
    let hasLivePrices = false;

    positions.forEach(position => {
      const liveMarkPrice = markPrices[position.symbol];
      if (liveMarkPrice && liveMarkPrice !== position.markPrice) {
        hasLivePrices = true;
        const entryPrice = position.entryPrice;
        const quantity = position.quantity;
        const isLong = position.side === 'LONG';

        // Calculate live PnL for this position
        const priceDiff = liveMarkPrice - entryPrice;
        const positionPnL = isLong ? priceDiff * quantity : -priceDiff * quantity;
        liveTotalPnL += positionPnL;
      } else {
        // Use the position's current PnL if no live price available
        liveTotalPnL += position.pnl || 0;
      }
    });

    // If we have live prices, update the PnL only
    // Total balance should remain consistent (available + margin)
    if (hasLivePrices) {
      return {
        ...accountInfo,
        totalPnL: liveTotalPnL,
        // Don't recalculate total balance - it's already correct
        totalBalance: accountInfo.totalBalance
      };
    }

    // Otherwise return official balance data
    return accountInfo;
  }, [accountInfo, positions, markPrices]);

  const handleClosePosition = async (_symbol: string, _side: 'LONG' | 'SHORT') => {
    try {
      // TODO: Implement position closing API call
      // For now, just log the action
    } catch (_error) {
    }
  };

  const _handleUpdateSL = async (_symbol: string, _side: 'LONG' | 'SHORT', _price: number) => {
    try {
      // TODO: Implement stop loss update API call
      // For now, just log the action
    } catch (_error) {
    }
  };

  const _handleUpdateTP = async (_symbol: string, _side: 'LONG' | 'SHORT', _price: number) => {
    try {
      // TODO: Implement take profit update API call
      // For now, just log the action
    } catch (_error) {
    }
  };

  return (
    <DashboardLayout>
      {/* Trade Size Warning Modal */}
      <TradeSizeWarningModal />

      {/* Rate Limit Toast Listener */}
      <RateLimitToastListener />

      {/* Minimal Bot Status Bar */}
      <MinimalBotStatus />

      <div className="flex h-full overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <PullToRefresh onRefresh={handleRefresh}>
            <div className="p-3 space-y-3">
              {/* Paper Trading Dashboard - Show only in paper mode */}
              {config?.global?.paperMode && (
                <PaperTradingDashboard />
              )}

              {/* Account Summary — unified terminal-style strip */}
              <div className="border rounded-lg bg-card overflow-hidden grid grid-cols-2 lg:grid-cols-4 divide-border/50 divide-x divide-y lg:divide-y-0">

                {/* Wallet */}
                <div
                  className="px-3 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
                  onClick={() => setShowBalanceDetail(v => !v)}
                  title="Click to expand balance history"
                >
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
                    <Wallet className="h-2.5 w-2.5" />
                    <span>Wallet</span>
                    {showBalanceDetail ? <ChevronUp className="h-2.5 w-2.5 ml-auto" /> : <ChevronDown className="h-2.5 w-2.5 ml-auto" />}
                  </div>
                  {isLoading ? <Skeleton className="h-5 w-24" /> : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-base font-semibold tabular-nums">{formatCurrency(liveAccountInfo.totalBalance)}</span>
                      {balanceStatus.error ? (
                        <Badge variant="destructive" className="h-3.5 text-[9px] px-1">ERR</Badge>
                      ) : balanceStatus.source === 'websocket' ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" title="Live" />
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Available */}
                <div className="px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
                    <DollarSign className="h-2.5 w-2.5" />
                    <span>Available</span>
                  </div>
                  {isLoading ? <Skeleton className="h-5 w-24" /> : (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-base font-semibold tabular-nums">{formatCurrency(liveAccountInfo.availableBalance)}</span>
                      {liveAccountInfo.totalBalance > 0 && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {((liveAccountInfo.availableBalance / liveAccountInfo.totalBalance) * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* In Position */}
                <div className="px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
                    <Activity className="h-2.5 w-2.5" />
                    <span>In Position</span>
                  </div>
                  {isLoading ? <Skeleton className="h-5 w-24" /> : (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-base font-semibold tabular-nums">{formatCurrency(liveAccountInfo.totalPositionValue)}</span>
                        {liveAccountInfo.totalBalance > 0 && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {((liveAccountInfo.totalPositionValue / liveAccountInfo.totalBalance) * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {liveAccountInfo.totalBalance > 0 && (
                        <div className="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary/50 transition-all duration-500"
                            style={{ width: `${Math.min((liveAccountInfo.totalPositionValue / liveAccountInfo.totalBalance) * 100, 100)}%` }} />
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Unrealized PnL */}
                <div className={`px-3 py-2.5 transition-colors ${
                  !isLoading && liveAccountInfo.totalPnL < 0 ? 'bg-red-500/5' :
                  !isLoading && liveAccountInfo.totalPnL > 0 ? 'bg-green-500/5' : ''
                }`}>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
                    {liveAccountInfo.totalPnL >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    <span>Unrealized PnL</span>
                  </div>
                  {isLoading ? <Skeleton className="h-5 w-24" /> : (
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-base font-semibold tabular-nums ${
                        liveAccountInfo.totalPnL >= 0 ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400'
                      }`}>{formatCurrency(liveAccountInfo.totalPnL)}</span>
                      {liveAccountInfo.totalBalance > 0 && (
                        <span className={`text-[10px] tabular-nums font-medium ${
                          liveAccountInfo.totalPnL >= 0 ? 'text-green-500/80 dark:text-green-400/80' : 'text-red-500/80 dark:text-red-400/80'
                        }`}>
                          {formatPercentage(liveAccountInfo.totalPnL / liveAccountInfo.totalBalance * 100)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

              </div>

              {/* Row 2: Performance & status strip */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5">

                <PerformanceCardInline />

                <span className="hidden sm:block text-border">·</span>

                <SessionPerformanceCard />

                <span className="hidden sm:block text-border">·</span>

                {/* Active symbols as inline chips */}
                {config?.symbols && Object.keys(config.symbols).length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Target className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{Object.keys(config.symbols).length}</span>
                    <div className="flex gap-1">
                      {Object.keys(config.symbols).slice(0, 4).map((symbol) => (
                        <Badge key={symbol} variant="outline" className="h-4 text-[10px] px-1 font-normal">
                          {symbol.replace('USDT', '')}
                        </Badge>
                      ))}
                      {Object.keys(config.symbols).length > 4 && (
                        <Badge variant="outline" className="h-4 text-[10px] px-1 font-normal text-muted-foreground">
                          +{Object.keys(config.symbols).length - 4}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                <span className="hidden sm:block text-border">·</span>

                <RiskModeSelector />

                {/* Cascade alert — inline */}
                {config?.global?.cascadeProtection?.enabled !== false && cascadeActive && (
                  <div className="flex items-center gap-1">
                    <ShieldAlert className="h-3 w-3 text-red-400 animate-pulse" />
                    <Badge variant="destructive" className="h-4 text-[9px] px-1.5 animate-pulse">
                      {config?.global?.cascadeProtection?.mode === 'BLOCK' ? 'PAUSED' : config?.global?.cascadeProtection?.mode === 'REDUCE' ? 'REDUCED' : 'DETECTED'}
                      {cascadeCooldown && ` ${Math.max(0, Math.ceil((cascadeCooldown - Date.now()) / 60000))}m`}
                    </Badge>
                  </div>
                )}

                {/* Health alert — inline */}
                {healthPaused && (
                  <div className="flex items-center gap-1">
                    <Heart className="h-3 w-3 text-orange-400 animate-pulse" />
                    <Badge variant="destructive" className="h-4 text-[9px] px-1.5 animate-pulse bg-orange-600" title={healthBlockReason || undefined}>
                      PAUSED
                      {healthUnrealizedLoss > 0 && ` · ${healthUnrealizedLoss.toFixed(1)}%`}
                      {healthDrawdown > 0 && ` DD ${healthDrawdown.toFixed(1)}%`}
                    </Badge>
                  </div>
                )}

              </div>

              {/* Balance Detail Panel — expands when Wallet is clicked */}
              {showBalanceDetail && (
                <BalanceDetailPanel walletBalance={liveAccountInfo.totalBalance} />
              )}

              {/* Positions Table — most actionable first */}
              <PositionTable
                onClosePosition={handleClosePosition}
                onViewChart={setSelectedSymbol}
              />

              {/* PnL Chart */}
              <PnLChart />

              {/* Signal Feed */}
              <TradeQualityPanel isPassiveMode={config?.global?.useTradeQualityScoring === false} />

              {/* Trading Chart */}
              {config?.symbols && Object.keys(config.symbols).length > 0 && selectedSymbol && (
                <TradingViewChart
                  symbol={selectedSymbol}
                  positions={positions}
                  availableSymbols={availableChartSymbols.length > 0 ? availableChartSymbols : Object.keys(config.symbols)}
                  onSymbolChange={setSelectedSymbol}
                />
              )}

              {/* Recent Orders */}
              <RecentOrdersTable maxRows={100} />

            </div>
          </PullToRefresh>
        </div>

        {/* Liquidation Sidebar */}
        <LiquidationSidebar
          volumeThresholds={volumeThresholds}
          maxEvents={50}
        />
      </div>
    </DashboardLayout>
  );
}