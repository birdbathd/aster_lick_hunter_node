'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import orderStore from '@/lib/services/orderStore';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCachedKlines, setCachedKlines, updateCachedKlines, getCandlesFor7Days } from '@/lib/klineCache';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';

// Types
interface LiquidationData {
  time: number;
  event_time: number;
  volume: number;
  volume_usdt: number;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
}

interface GroupedLiquidation {
  timestamp: number;
  side: number; // 1 = long liquidation (red), 0 = short liquidation (blue)
  totalVolume: number;
  count: number;
  price: number;
}

interface TradingViewChartProps {
  symbol: string;
  liquidations?: LiquidationData[];
  positions?: any[];
  className?: string;
}

const TIMEFRAMES = [
  { value: '1m', label: '1 Min' },
  { value: '5m', label: '5 Min' },
  { value: '15m', label: '15 Min' },
  { value: '30m', label: '30 Min' },
  { value: '1h', label: '1 Hour' },
  { value: '4h', label: '4 Hours' },
  { value: '1d', label: '1 Day' },
];

const LIQUIDATION_GROUPINGS = [
  { value: '1m', label: '1 Min' },
  { value: '5m', label: '5 Min' },
  { value: '15m', label: '15 Min' },
  { value: '30m', label: '30 Min' },
  { value: '1h', label: '1 Hour' },
  { value: '2h', label: '2 Hours' },
  { value: '4h', label: '4 Hours' },
  { value: '6h', label: '6 Hours' },
  { value: '12h', label: '12 Hours' },
  { value: '1d', label: '1 Day' },
];

// Debounce utility
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Convert timeframe to seconds for liquidation grouping
function timeframeToSeconds(timeframe: string): number {
  const timeframes: Record<string, number> = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '6h': 21600,
    '8h': 28800,
    '12h': 43200,
    '1d': 86400,
    '3d': 259200,
    '1w': 604800,
    '1M': 2592000
  };
  return timeframes[timeframe] || 300; // Default to 5 minutes
}

export default function TradingViewChart({ symbol, liquidations = [], positions = [], className }: TradingViewChartProps) {
  // Chart refs
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const positionLinesRef = useRef<any[]>([]);
  const vwapLineRef = useRef<any>(null);
  const orderMarkersRef = useRef<any[]>([]);

  // State
  const [timeframe, setTimeframe] = useState('5m');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [klineData, setKlineData] = useState<CandlestickData[]>([]);
  const [dbLiquidations, setDbLiquidations] = useState<LiquidationData[]>([]);
  const [showLiquidations, setShowLiquidations] = useState(true);
  const [liquidationGrouping, setLiquidationGrouping] = useState('5m');
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [showVWAP, setShowVWAP] = useState(false);
  const [showRecentOrders, setShowRecentOrders] = useState(false);

  // Combine props liquidations with database liquidations
  const allLiquidations = useMemo(() => 
    [...liquidations, ...dbLiquidations], 
    [liquidations, dbLiquidations]
  );

  // Group liquidations by time for marker display
  const groupLiquidationsByTime = useCallback((liquidations: LiquidationData[], timeframeStr: string): GroupedLiquidation[] => {
    const groups: Record<string, GroupedLiquidation> = {};
    const periodSeconds = timeframeToSeconds(timeframeStr);

    // Sort liquidations by time first (don't modify original array)
    const sortedLiquidations = [...liquidations].sort((a, b) => a.event_time - b.event_time);

    sortedLiquidations.forEach(liq => {
      const timestamp = liq.event_time; // Already in milliseconds
      const timestampSeconds = Math.floor(timestamp / 1000); // Convert to seconds
      const periodStart = Math.floor(timestampSeconds / periodSeconds) * periodSeconds;
      
      // SHOW ON LAST CANDLE: Add period duration to show at END of period
      const periodEnd = periodStart + periodSeconds;
      
      // Map database sides: 'SELL' = long liquidation (red), 'BUY' = short liquidation (blue)
      const side = liq.side === 'SELL' ? 1 : 0;
      const key = `${periodStart}_${side}`;

      if (!groups[key]) {
        groups[key] = {
          timestamp: periodEnd * 1000, // Use END of period (last candle)
          side,
          totalVolume: 0,
          count: 0,
          price: 0
        };
      }

      groups[key].totalVolume += liq.volume_usdt;
      groups[key].count += 1;
      groups[key].price = (groups[key].price * (groups[key].count - 1) + liq.price) / groups[key].count;
    });

    // Sort the grouped results by timestamp to ensure proper ordering
    return Object.values(groups).sort((a, b) => a.timestamp - b.timestamp);
  }, []);

  // Get color by volume and side
  const getColorByVolume = useCallback((volume: number, side: number): string => {
    if (side === 1) { // Long liquidations (red spectrum)
      return volume > 1000000 ? '#ff1744' :    // >$1M: Bright red
             volume > 100000  ? '#ff5722' :    // >$100K: Orange-red  
             '#ff9800';                        // <$100K: Orange
    } else { // Short liquidations (blue spectrum)
      return volume > 1000000 ? '#1976d2' :    // >$1M: Dark blue
             volume > 100000  ? '#2196f3' :    // >$100K: Medium blue
             '#64b5f6';                        // <$100K: Light blue
    }
  }, []);

  // Get size by volume
  const getSizeByVolume = useCallback((volume: number): number => {
    return volume > 1000000 ? 2 :    // >$1M: Large
           volume > 100000  ? 1 :    // >$100K: Medium
           0;                        // <$100K: Small
  }, []);

  // Update liquidation markers
  const updateLiquidationMarkers = useCallback((liquidations: LiquidationData[]) => {
    if (!candlestickSeriesRef.current || liquidations.length === 0 || !showLiquidations) {
      // Clear markers if liquidations are hidden
      if (!showLiquidations && candlestickSeriesRef.current) {
        candlestickSeriesRef.current.setMarkers([]);
      }
      return;
    }

    try {
      const groupedLiquidations = groupLiquidationsByTime(liquidations, liquidationGrouping); // Use separate grouping setting
      
      const markers = groupedLiquidations.map(group => ({
        time: Math.floor(group.timestamp / 1000) as Time, // TradingView needs seconds
        position: 'belowBar' as const,
        color: getColorByVolume(group.totalVolume, group.side),
        shape: 'circle' as const,
        size: getSizeByVolume(group.totalVolume),
        text: `${group.count}${group.side === 1 ? 'L' : 'S'} $${(group.totalVolume/1000).toFixed(0)}K`,
        id: `liq_${group.timestamp}_${group.side}`
      }));

      // Sort markers by time to ensure proper ordering (extra safety)
      markers.sort((a, b) => (a.time as number) - (b.time as number));

      candlestickSeriesRef.current.setMarkers(markers);
    } catch (error) {
      console.warn('Error updating liquidation markers:', error);
    }
  }, [groupLiquidationsByTime, getColorByVolume, getSizeByVolume, showLiquidations, liquidationGrouping]);

  // Update position indicators
  const updatePositionIndicators = useCallback((positions: any[], orders: any[]) => {
    console.log('[TradingViewChart] updatePositionIndicators called with:', {
      positionsCount: positions.length,
      ordersCount: orders.length,
      symbol,
      hasSeriesRef: !!candlestickSeriesRef.current
    });

    if (!candlestickSeriesRef.current) {
      console.log('[TradingViewChart] No candlestick series ref for position indicators');
      return;
    }

    // Clear existing position lines
    console.log(`[TradingViewChart] Clearing ${positionLinesRef.current.length} existing lines`);
    positionLinesRef.current.forEach(line => {
      try {
        candlestickSeriesRef.current?.removePriceLine(line);
      } catch (_e) {
        // Ignore errors from already removed lines
      }
    });
    positionLinesRef.current = [];

    // Filter positions for current symbol
    const symbolPositions = positions.filter(pos => pos.symbol === symbol);
    console.log(`[TradingViewChart] Processing ${symbolPositions.length} positions for ${symbol}:`, symbolPositions);

    symbolPositions.forEach(position => {
      try {
        const entryPrice = parseFloat(position.entryPrice || position.markPrice || position.avgPrice || '0');
        const quantity = parseFloat(position.quantity || position.positionAmt || position.size || '0');
        const side = position.side; // "LONG" or "SHORT"
        const positionAmt = side === 'SHORT' ? -quantity : quantity; // Convert to signed amount
        const unrealizedPnl = parseFloat(position.unrealizedProfit || position.pnl || '0');
        const liquidationPrice = parseFloat(position.liquidationPrice || '0');
        
        console.log(`[TradingViewChart] Position data:`, {
          entryPrice,
          quantity,
          side,
          positionAmt,
          unrealizedPnl,
          liquidationPrice,
          symbol: position.symbol
        });
        
        if (entryPrice > 0 && Math.abs(positionAmt) > 0) {
          const isLong = positionAmt > 0;
          
          // Entry price line - using different approach
          console.log(`[TradingViewChart] Creating entry price line at ${entryPrice}`);
          const entryLine = candlestickSeriesRef.current!.createPriceLine({
            price: entryPrice,
            color: isLong ? '#26a69a' : '#ef5350',
            lineWidth: 2,
            lineStyle: 0, // Solid line
            axisLabelVisible: true,
            title: `${isLong ? 'LONG' : 'SHORT'} Entry: ${entryPrice}`,
          });
          positionLinesRef.current.push(entryLine);
          console.log(`[TradingViewChart] Entry line created:`, entryLine);

          // Liquidation price line (if available)
          if (liquidationPrice > 0) {
            console.log(`[TradingViewChart] Creating liquidation price line at ${liquidationPrice}`);
            const liqLine = candlestickSeriesRef.current!.createPriceLine({
              price: liquidationPrice,
              color: '#ff1744', // Bright red for liquidation
              lineWidth: 1,
              lineStyle: 1, // Dashed line
              axisLabelVisible: true,
              title: `Liquidation: ${liquidationPrice}`,
            });
            positionLinesRef.current.push(liqLine);
            console.log(`[TradingViewChart] Liquidation line created:`, liqLine);
          }
        } else {
          console.log(`[TradingViewChart] Skipping position - invalid entry price or zero amount`, {
            entryPrice,
            positionAmt,
            condition1: entryPrice > 0,
            condition2: Math.abs(positionAmt) > 0,
            rawPosition: position
          });
        }
      } catch (error) {
        console.error('[TradingViewChart] Error adding position line:', error);
      }
    });

    // Find and process open orders for current symbol
    const symbolOrders = orders.filter(order => order.symbol === symbol);
    console.log(`[TradingViewChart] Processing ${symbolOrders.length} orders for ${symbol}:`, symbolOrders);

    symbolOrders.forEach(order => {
      try {
        const orderPrice = parseFloat(order.stopPrice || order.price || '0');
        console.log(`[TradingViewChart] Order data:`, {
          type: order.type,
          price: order.price,
          stopPrice: order.stopPrice,
          calculatedPrice: orderPrice,
          symbol: order.symbol
        });
        
        if (orderPrice > 0) {
          const isTP = order.type.includes('TAKE_PROFIT');
          const isSL = order.type.includes('STOP') && !isTP;
          
          let color = '#ffa726'; // Default orange
          let title = `Order: ${orderPrice}`;
          
          if (isTP) {
            color = '#4caf50'; // Green for TP
            title = `TP: ${orderPrice}`;
          } else if (isSL) {
            color = '#f44336'; // Red for SL
            title = `SL: ${orderPrice}`;
          }

          console.log(`[TradingViewChart] Creating order line:`, { type: order.type, price: orderPrice, color, title });
          const orderLine = candlestickSeriesRef.current!.createPriceLine({
            price: orderPrice,
            color,
            lineWidth: 1,
            lineStyle: 2, // Dotted line
            axisLabelVisible: true,
            title,
          });
          positionLinesRef.current.push(orderLine);
          console.log(`[TradingViewChart] Order line created:`, orderLine);
        } else {
          console.log(`[TradingViewChart] Skipping order - invalid price`);
        }
      } catch (error) {
        console.error('[TradingViewChart] Error adding order line:', error);
      }
    });

    console.log(`[TradingViewChart] Total lines created: ${positionLinesRef.current.length}`);
  }, [symbol]);

  // Debounced position updates
  const debouncedUpdatePositions = useCallback(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    debounce((positions: any[], orders: any[]) => {
      updatePositionIndicators(positions, orders);
    }, 250),
    [updatePositionIndicators]
  );

  // Debounced marker updates
  const debouncedUpdateMarkers = useCallback(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    debounce((liquidations: LiquidationData[]) => {
      updateLiquidationMarkers(liquidations);
    }, 250),
    [updateLiquidationMarkers]
  );

  // Fetch liquidation data from database
  const fetchLiquidationData = useCallback(async () => {
    if (!symbol) return;

    try {
      const response = await fetch(`/api/liquidations?symbol=${symbol}&limit=500`);
      const result = await response.json();

      if (result.success && result.data) {
        const transformedLiquidations: LiquidationData[] = result.data.map((liq: any) => ({
          time: liq.event_time,
          event_time: liq.event_time,
          volume: liq.volume_usdt,
          volume_usdt: liq.volume_usdt,
          side: liq.side,
          price: liq.price,
          quantity: liq.quantity
        }));
        setDbLiquidations(transformedLiquidations);
      }
    } catch (error) {
      console.error('Error fetching liquidation data:', error);
    }
  }, [symbol]);

  // Fetch open orders for TP/SL display
  const fetchOpenOrders = useCallback(async () => {
    if (!symbol) return;

    try {
      const response = await fetch('/api/orders');
      const result = await response.json();

      if (Array.isArray(result)) {
        // Filter orders for current symbol
        const symbolOrders = result.filter((order: any) => order.symbol === symbol);
        setOpenOrders(symbolOrders);
      }
    } catch (error) {
      console.error('Error fetching open orders:', error);
    }
  }, [symbol]);

  // Fetch kline data with caching
  const fetchKlineData = useCallback(async () => {
    if (!symbol || !timeframe) return;

    setLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = getCachedKlines(symbol, timeframe);
      
      if (cached) {
        console.log(`[TradingViewChart] Using cached data for ${symbol} ${timeframe}, ${cached.data.length} candles`);
        
        // Use cached data immediately
        const transformedData: CandlestickData[] = cached.data.map((kline: any[]) => {
          const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
          return {
            time: timestamp as Time,
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4])
          };
        });

        // Sort data by time (TradingView requires chronological order)
        transformedData.sort((a, b) => (a.time as number) - (b.time as number));
        setKlineData(transformedData);
        
        // Check if we need to fetch recent updates (cache older than 2 minutes)
        const cacheAge = Date.now() - cached.lastUpdate;
        const needsUpdate = cacheAge > 2 * 60 * 1000; // 2 minutes
        
        if (!needsUpdate) {
          setLoading(false);
          console.log(`[TradingViewChart] Cache is fresh, no update needed`);
          return;
        }
        
        // Fetch only recent candles since last cache update
        console.log(`[TradingViewChart] Cache is stale, fetching updates since ${new Date(cached.lastCandleTime)}`);
        
        try {
          const updateResponse = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&since=${cached.lastCandleTime}&limit=100`);
          const updateResult = await updateResponse.json();
          
          if (updateResult.success && updateResult.data.length > 0) {
            console.log(`[TradingViewChart] Fetched ${updateResult.data.length} new candles`);
            
            // Update cache with new data
            const updated = updateCachedKlines(symbol, timeframe, updateResult.data);
            
            if (updated) {
              // Update chart with merged data
              const updatedTransformed: CandlestickData[] = updated.data.map((kline: any[]) => {
                const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
                return {
                  time: timestamp as Time,
                  open: parseFloat(kline[1]),
                  high: parseFloat(kline[2]),
                  low: parseFloat(kline[3]),
                  close: parseFloat(kline[4])
                };
              });
              
              updatedTransformed.sort((a, b) => (a.time as number) - (b.time as number));
              setKlineData(updatedTransformed);
            }
          }
        } catch (updateError) {
          console.warn('[TradingViewChart] Failed to fetch updates, using cached data:', updateError);
        }
        
        setLoading(false);
        return;
      }

      // No cache available, fetch full 7-day history
      const sevenDayLimit = getCandlesFor7Days(timeframe);
      console.log(`[TradingViewChart] No cache, fetching ${sevenDayLimit} candles for ${symbol} ${timeframe} (7-day history)`);
      
      const response = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&limit=${sevenDayLimit}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch kline data');
      }

      console.log(`[TradingViewChart] Fetched ${result.data.length} candles from API`);

      // Transform API response to lightweight-charts format
      const transformedData: CandlestickData[] = result.data.map((kline: any[]) => {
        const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
        return {
          time: timestamp as Time,
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4])
        };
      });
      
      // Sort data by time (TradingView requires chronological order)
      transformedData.sort((a, b) => (a.time as number) - (b.time as number));

      // Cache the data
      setCachedKlines(symbol, timeframe, result.data);
      console.log(`[TradingViewChart] Cached ${result.data.length} candles for ${symbol} ${timeframe}`);
      
      setKlineData(transformedData);
    } catch (error) {
      console.error('[TradingViewChart] Error fetching kline data:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch chart data');
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  // Initialize chart
  useEffect(() => {
    // Don't initialize chart if still loading or there's an error
    if (loading || error) {
      return;
    }
    
    if (!chartContainerRef.current) {
      return;
    }

    const containerWidth = chartContainerRef.current.clientWidth;
    
    try {
      const chart = createChart(chartContainerRef.current, {
        width: containerWidth || 800,
        height: 400,
        layout: {
          textColor: 'white',
          background: { color: '#1a1a1a' },
        },
        grid: {
          vertLines: { color: 'rgba(197, 203, 206, 0.1)' },
          horzLines: { color: 'rgba(197, 203, 206, 0.1)' },
        },
        crosshair: {
          mode: 1,
        },
        rightPriceScale: {
          borderColor: 'rgba(197, 203, 206, 0.5)',
        },
        timeScale: {
          borderColor: 'rgba(197, 203, 206, 0.5)',
          timeVisible: true,
          secondsVisible: false,
        },
      });

      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;
    } catch (error) {
      console.error(`[TradingViewChart] Error creating chart:`, error);
    }

    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
      if (chartRef.current && chartContainerRef.current) {
        const { width } = entries[0].contentRect;
        try {
          chartRef.current.applyOptions({ width, height: 400 });
        } catch (_e) {
          console.warn('Chart disposed during resize');
        }
      }
    });

    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candlestickSeriesRef.current = null;
      }
    };
  }, [loading, error]); // Re-initialize when loading/error states change

  // Fetch data when symbol or timeframe changes
  useEffect(() => {
    if (symbol && timeframe) {
      fetchKlineData();
      fetchLiquidationData();
      fetchOpenOrders();
    }
  }, [symbol, timeframe, fetchKlineData, fetchLiquidationData, fetchOpenOrders]);

  // Update chart data when klineData changes
  useEffect(() => {
    if (candlestickSeriesRef.current && klineData.length > 0) {
      candlestickSeriesRef.current.setData(klineData);
      
      // Auto-fit the chart to the data
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    }
  }, [klineData]);

  // Update liquidation markers when data changes
  useEffect(() => {
    if (allLiquidations.length > 0) {
      debouncedUpdateMarkers(allLiquidations);
    }
  }, [allLiquidations, debouncedUpdateMarkers]);

  // Update position indicators when positions change
  useEffect(() => {
    if (positions.length > 0) {
      debouncedUpdatePositions(positions, openOrders);
    }
  }, [positions, openOrders, debouncedUpdatePositions]);

  if (!symbol) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center h-96">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground">Select a symbol to view chart</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Recent orders overlay logic ---
  // Use filled orders from orderStore (same as RecentOrdersTable)
  const [filledOrders, setFilledOrders] = React.useState<any[]>([]);
  useEffect(() => {
    console.log('[TradingViewChart] Loading filled orders for symbol:', symbol);
    
    const loadOrders = async () => {
      try {
        // Fetch orders from API
        await orderStore.fetchOrders();
        
        // Get only FILLED orders for the current symbol
        const allFilled = orderStore.getFilteredOrders().filter((order: any) => order.status === 'FILLED' && order.symbol === symbol);
        console.log('[TradingViewChart] Found filled orders:', allFilled);
        setFilledOrders(allFilled);
      } catch (err) {
        console.error('[TradingViewChart] Failed to load orders:', err);
      }
    };
    
    loadOrders();
    
    // Listen for updates
    const handleUpdate = () => {
      const updated = orderStore.getFilteredOrders().filter((order: any) => order.status === 'FILLED' && order.symbol === symbol);
      console.log('[TradingViewChart] Updated filled orders:', updated);
      setFilledOrders(updated);
    };
    orderStore.on('orders:updated', handleUpdate);
    orderStore.on('orders:filtered', handleUpdate);
    return () => {
      orderStore.off('orders:updated', handleUpdate);
      orderStore.off('orders:filtered', handleUpdate);
    };
  }, [symbol]);

  // Combine all overlays into one marker array
  React.useEffect(() => {
    console.log('[TradingViewChart] Overlay effect triggered:', {
      showLiquidations,
      showRecentOrders,
      showVWAP,
      hasSeriesRef: !!candlestickSeriesRef.current,
      filledOrdersCount: filledOrders.length,
      liquidationsCount: allLiquidations.length,
      klineDataCount: klineData.length
    });
    if (!candlestickSeriesRef.current) return;
    let markers: any[] = [];
    // Add liquidation markers if enabled
    if (showLiquidations && allLiquidations.length > 0) {
      const groupedLiquidations = groupLiquidationsByTime(allLiquidations, liquidationGrouping);
      const liqMarkers = groupedLiquidations.map(group => ({
        time: Math.floor(group.timestamp / 1000) as Time,
        position: 'belowBar',
        color: getColorByVolume(group.totalVolume, group.side),
        shape: 'circle',
        size: getSizeByVolume(group.totalVolume),
        text: `${group.count}${group.side === 1 ? 'L' : 'S'} $${(group.totalVolume/1000).toFixed(0)}K`,
        id: `liq_${group.timestamp}_${group.side}`
      }));
      markers = markers.concat(liqMarkers);
    }
    // Add recent order markers if enabled
    if (showRecentOrders) {
      console.log('[TradingViewChart] Processing recent orders overlay - filledOrders:', filledOrders);
      if (filledOrders.length === 0) {
        console.warn('[TradingViewChart] No filled orders found for recent orders overlay', { symbol, filledOrders });
      } else {
        console.log(`[TradingViewChart] Show Recent Orders enabled, found ${filledOrders.length} filled orders`, filledOrders);
      }
      const orderMarkers = filledOrders.map((order: any) => {
        const orderTime = Number(order.updateTime || order.time || order.transactTime);
        let candle = klineData.find(k => typeof k.time === 'number' && Math.abs((k.time * 1000) - orderTime) < 60 * 1000);
        if (!candle) {
          // fallback: use closest candle
          if (klineData.length > 0) {
            candle = klineData.reduce((closest, k) => {
              return Math.abs((k.time as number * 1000) - orderTime) < Math.abs((closest.time as number * 1000) - orderTime) ? k : closest;
            }, klineData[0]);
          }
          if (!candle) {
            console.warn('[TradingViewChart] No candle found for order', order, klineData);
            return null;
          }
        }
        const marker = {
          time: candle.time,
          position: 'aboveBar',
          color: order.type?.includes('TAKE_PROFIT') ? '#4caf50' : order.type?.includes('STOP') ? '#f44336' : '#ffa726',
          shape: 'arrowUp',
          size: 2,
          text: `${order.type}: ${order.price || order.stopPrice}`,
          id: `order_${order.orderId}`,
          type: 'order'
        };
        console.log('[TradingViewChart] Adding order marker:', marker);
        return marker;
      }).filter(Boolean);
      markers = markers.concat(orderMarkers);
      if (orderMarkers.length === 0) {
        console.warn('[TradingViewChart] No order markers generated from filledOrders', filledOrders, klineData);
      }
    }
    candlestickSeriesRef.current.setMarkers(markers);
    if (showRecentOrders && markers.filter(m => m.type === 'order').length > 0) {
      console.log('[TradingViewChart] Recent order markers drawn:', markers.filter(m => m.type === 'order'));
    }
    if (showVWAP) {
      console.log('[TradingViewChart] VWAP overlay should be visible (line drawn separately)');
    }
    if (markers.length === 0) {
      console.warn('[TradingViewChart] No markers drawn for overlays', { showLiquidations, showRecentOrders, filledOrders, allLiquidations, klineData });
    }
  }, [showLiquidations, allLiquidations, liquidationGrouping, showRecentOrders, filledOrders, klineData, showVWAP]);

  // --- VWAP overlay logic ---
  React.useEffect(() => {
    console.log('[TradingViewChart] VWAP overlay effect triggered:', {
      showVWAP,
      symbol,
      hasSeriesRef: !!candlestickSeriesRef.current,
      hasVwapLine: !!vwapLineRef.current
    });
    if (!showVWAP) {
      console.log('[TradingViewChart] Show VWAP disabled');
      if (candlestickSeriesRef.current && vwapLineRef.current) {
        candlestickSeriesRef.current.removePriceLine(vwapLineRef.current);
        vwapLineRef.current = null;
      }
      return;
    }
    if (!candlestickSeriesRef.current || !symbol) {
      console.warn('[TradingViewChart] Cannot show VWAP - missing series ref or symbol');
      return;
    }
    // Fetch VWAP from streamer API (or fallback to service)
    const fetchVWAP = async () => {
      try {
        console.log('[TradingViewChart] Fetching VWAP data for', symbol);
        const configResp = await fetch('/api/config');
        const configData = await configResp.json();
        console.log('[TradingViewChart] Config data:', configData);
        const symbolConfig = configData.symbols?.[symbol] || {};
        console.log('[TradingViewChart] Symbol config:', symbolConfig);
        const timeframe = symbolConfig.vwapTimeframe || '1m';
        const lookback = symbolConfig.vwapLookback || 100;
        const vwapResp = await fetch(`/api/vwap?symbol=${symbol}&timeframe=${timeframe}&lookback=${lookback}`);
        const vwapData = await vwapResp.json();
        console.log('[TradingViewChart] VWAP API response:', vwapData);
        if (vwapData && vwapData.vwap) {
          // Remove previous VWAP line if any
          if (vwapLineRef.current) {
            candlestickSeriesRef.current?.removePriceLine(vwapLineRef.current);
            vwapLineRef.current = null;
          }
          // Add VWAP line
          vwapLineRef.current = candlestickSeriesRef.current?.createPriceLine({
            price: vwapData.vwap,
            color: '#ffd600',
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: `VWAP (${timeframe})`
          });
          console.log('[TradingViewChart] VWAP line added:', vwapData.vwap);
        } else {
          console.warn('[TradingViewChart] No VWAP data returned for', symbol, timeframe, vwapData);
        }
      } catch (err) {
        console.warn('[TradingViewChart] VWAP fetch error', err);
      }
    };
    fetchVWAP();
    // Optionally, poll for updates every 10s
    const interval = setInterval(fetchVWAP, 10000);
    return () => {
      clearInterval(interval);
      if (candlestickSeriesRef.current && vwapLineRef.current) {
        candlestickSeriesRef.current.removePriceLine(vwapLineRef.current);
        vwapLineRef.current = null;
      }
    };
  }, [showVWAP, symbol]);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg font-semibold">
          {symbol} Chart
        </CardTitle>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="show-liquidations" 
              checked={showLiquidations}
              onCheckedChange={(checked) => setShowLiquidations(checked as boolean)}
            />
            <Label htmlFor="show-liquidations" className="text-sm">
              Show Liquidations
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-recent-orders"
              checked={showRecentOrders}
              onCheckedChange={(checked) => setShowRecentOrders(checked as boolean)}
            />
            <Label htmlFor="show-recent-orders" className="text-sm">
              Show Recent Orders
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-vwap"
              checked={showVWAP}
              onCheckedChange={(checked) => setShowVWAP(checked as boolean)}
            />
            <Label htmlFor="show-vwap" className="text-sm">
              Show VWAP
            </Label>
          </div>

          {showLiquidations && (
            <div className="flex items-center space-x-2">
              <Label className="text-sm text-muted-foreground">Group by:</Label>
              <Select value={liquidationGrouping} onValueChange={setLiquidationGrouping}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIQUIDATION_GROUPINGS.map(group => (
                    <SelectItem key={group.value} value={group.value}>
                      {group.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <Label className="text-sm text-muted-foreground">Timeframe:</Label>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map(tf => (
                  <SelectItem key={tf.value} value={tf.value}>
                    {tf.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
              <p className="text-muted-foreground">Loading chart data...</p>
            </div>
          </div>
        )}
        
        {error && (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-destructive" />
              <p className="text-destructive">{error}</p>
              <Button 
                variant="outline" 
                onClick={() => fetchKlineData()} 
                className="mt-2"
              >
                Retry
              </Button>
            </div>
          </div>
        )}
        
        {!loading && !error && (
          <div 
            ref={chartContainerRef} 
            className="w-full h-96 bg-background rounded-md border border-border"
            style={{ minHeight: '400px', minWidth: '300px' }}
          />
        )}
      </CardContent>
    </Card>
  );
}