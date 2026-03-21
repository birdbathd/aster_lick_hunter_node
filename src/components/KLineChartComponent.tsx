'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useConfig } from '@/components/ConfigProvider';
import orderStore from '@/lib/services/orderStore';
import {
  getCachedKlines, setCachedKlines, updateCachedKlines,
  getCandlesFor7Days, prependHistoricalKlines,
} from '@/lib/klineCache';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  ChevronDown, MousePointer2, Minus, TrendingUp,
  MoveUpRight, Square, Circle, Type, Trash2,
  GitCommitHorizontal, MoveVertical, SplitSquareVertical,
  BarChart3, Check, Hash, Spline, PenLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

type KCLib = typeof import('klinecharts');
type KLineData = import('klinecharts').KLineData;
type KCStyles = import('klinecharts').DeepPartial<import('klinecharts').Styles>;

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
  side: number;
  totalVolume: number;
  count: number;
  price: number;
}

interface KLineChartProps {
  symbol: string;
  liquidations?: LiquidationData[];
  positions?: any[];
  className?: string;
  availableSymbols?: string[];
  onSymbolChange?: (symbol: string) => void;
  scrollToTimestamp?: number | null;
  highlightTimestamp?: number | null;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const PRO_CHART_STYLES: KCStyles = {
  grid: {
    horizontal: { color: 'rgba(197,203,206,0.08)' },
    vertical: { color: 'rgba(197,203,206,0.08)' },
  },
  candle: {
    bar: {
      upColor: '#26a69a',
      downColor: '#ef5350',
      noChangeColor: '#888',
      upBorderColor: '#26a69a',
      downBorderColor: '#ef5350',
      noChangeBorderColor: '#888',
      upWickColor: '#26a69a',
      downWickColor: '#ef5350',
      noChangeWickColor: '#888',
    },
    priceMark: {
      show: true,
      high: { show: true, color: '#D9D9D9', textSize: 10 },
      low: { show: true, color: '#D9D9D9', textSize: 10 },
      last: {
        show: true,
        upColor: '#26a69a',
        downColor: '#ef5350',
        noChangeColor: '#888',
        line: { show: true, style: 'dashed' },
      },
    },
    tooltip: { showRule: 'follow_cross' },
  },
  yAxis: { tickText: { color: '#9b9b9b' } },
  xAxis: { tickText: { color: '#9b9b9b' } },
  crosshair: {
    horizontal: { line: { color: 'rgba(150,150,150,0.5)', style: 'dashed' } },
    vertical: { line: { color: 'rgba(150,150,150,0.5)', style: 'dashed' } },
  },
  separator: { color: 'rgba(197,203,206,0.15)' },
};

// ═══════════════════════════════════════════════════════════════════
// Drawing Tool Definitions
// ═══════════════════════════════════════════════════════════════════

interface DrawingTool {
  name: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const DRAWING_TOOLS: DrawingTool[] = [
  { name: 'segment', label: 'Segment', icon: PenLine },
  { name: 'line', label: 'Trend Line', icon: TrendingUp },
  { name: 'rayLine', label: 'Ray', icon: MoveUpRight },
  { name: 'horizontalStraightLine', label: 'Horizontal Line', icon: Minus },
  { name: 'verticalStraightLine', label: 'Vertical Line', icon: MoveVertical },
  { name: 'parallelStraightLine', label: 'Parallel Lines', icon: SplitSquareVertical },
  { name: 'priceChannelLine', label: 'Price Channel', icon: GitCommitHorizontal },
  { name: 'fibonacciLine', label: 'Fibonacci', icon: Hash },
  { name: 'rect', label: 'Rectangle', icon: Square },
  { name: 'circle', label: 'Circle', icon: Circle },
  { name: 'arc', label: 'Arc', icon: Spline },
  { name: 'text', label: 'Text', icon: Type },
];

// ═══════════════════════════════════════════════════════════════════
// Indicator Definitions
// ═══════════════════════════════════════════════════════════════════

interface IndicatorDef {
  name: string;
  label: string;
  isMain: boolean; // true = overlay on candle pane, false = sub-pane
}

const AVAILABLE_INDICATORS: IndicatorDef[] = [
  // Main pane overlays
  { name: 'MA', label: 'MA (Moving Average)', isMain: true },
  { name: 'EMA', label: 'EMA', isMain: true },
  { name: 'SMA', label: 'SMA', isMain: true },
  { name: 'BOLL', label: 'Bollinger Bands', isMain: true },
  { name: 'SAR', label: 'SAR', isMain: true },
  // Sub-pane indicators
  { name: 'VOL', label: 'Volume', isMain: false },
  { name: 'MACD', label: 'MACD', isMain: false },
  { name: 'RSI', label: 'RSI', isMain: false },
  { name: 'KDJ', label: 'KDJ', isMain: false },
  { name: 'CCI', label: 'CCI', isMain: false },
  { name: 'OBV', label: 'OBV', isMain: false },
  { name: 'DMI', label: 'DMI', isMain: false },
  { name: 'ROC', label: 'ROC', isMain: false },
  { name: 'MTM', label: 'MTM', isMain: false },
  { name: 'AO', label: 'AO', isMain: false },
  { name: 'WR', label: 'Williams %R', isMain: false },
];

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function smartPrice(price: number): string {
  const dec = price.toFixed(10).split('.')[1] || '';
  let keep = 2, foundSig = false, zeros = 0;
  for (let i = 0; i < dec.length; i++) {
    if (dec[i] !== '0') { foundSig = true; zeros = 0; keep = i + 1; }
    else { zeros++; if (foundSig && zeros >= 2) break; }
  }
  return price.toFixed(Math.max(2, keep));
}

function tfToSec(tf: string): number {
  const m: Record<string, number> = {
    '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600,
    '12h': 43200, '1d': 86400,
  };
  return m[tf] || 300;
}

function tfToMs(tf: string): number {
  const match = tf.match(/^(\d+)(m|h|d)$/);
  if (!match) return 60000;
  const n = parseInt(match[1], 10);
  return n * (match[2] === 'm' ? 60000 : match[2] === 'h' ? 3600000 : 86400000);
}

function tfToKcPeriod(tf: string): { type: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'; span: number } {
  const match = tf.match(/^(\d+)(m|h|d|w|M|y)$/);
  if (!match) return { type: 'minute', span: 5 };
  const span = parseInt(match[1], 10);
  const typeMap: Record<string, 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'> = {
    m: 'minute', h: 'hour', d: 'day', w: 'week', M: 'month', y: 'year',
  };
  return { type: typeMap[match[2]] || 'minute', span };
}

function kcPeriodToTf(period: { type: string; span: number }): string {
  const unitMap: Record<string, string> = {
    second: 's',
    minute: 'm',
    hour: 'h',
    day: 'd',
    week: 'w',
    month: 'M',
    year: 'y',
  };
  return `${period.span}${unitMap[period.type] || 'm'}`;
}

function rawToKLine(data: any[]): KLineData[] {
  const deduped = new Map<number, KLineData>();
  data.forEach((k: any[]) => {
    const rawTs = typeof k[0] === 'number' ? k[0] : parseInt(k[0], 10);
    const timestamp = rawTs < 1e12 ? rawTs * 1000 : rawTs;
    deduped.set(timestamp, {
      timestamp,
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: k[5] != null ? parseFloat(k[5]) : undefined,
    } as KLineData);
  });
  return Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function toChartTimestamp(timestamp: number): number {
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

// ═══════════════════════════════════════════════════════════════════
// Data Fetching
// ═══════════════════════════════════════════════════════════════════

async function fetchInitData(sym: string, tf: string): Promise<KLineData[]> {
  const cached = getCachedKlines(sym, tf);
  if (cached) {
    const data = rawToKLine(cached.data);
    if (Date.now() - cached.lastUpdate < 2 * 60 * 1000) return data;
    try {
      const r = await fetch(`/api/klines?symbol=${encodeURIComponent(sym)}&interval=${tf}&since=${cached.lastCandleTime}&limit=100`);
      const j = await r.json();
      if (j.success && j.data?.length > 0) {
        const u = updateCachedKlines(sym, tf, j.data);
        if (u) return rawToKLine(u.data);
      }
    } catch { /* use cached */ }
    return data;
  }
  const limit = getCandlesFor7Days(tf);
  const r = await fetch(`/api/klines?symbol=${encodeURIComponent(sym)}&interval=${tf}&limit=${limit}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to fetch klines');
  setCachedKlines(sym, tf, j.data);
  return rawToKLine(j.data);
}

async function fetchBackwardData(sym: string, tf: string, endTs: number): Promise<KLineData[]> {
  const apiEndTime = toChartTimestamp(endTs);
  const r = await fetch(`/api/klines?symbol=${encodeURIComponent(sym)}&interval=${tf}&endTime=${apiEndTime - 1}&limit=500`);
  const j = await r.json();
  if (j.success && j.data?.length > 0) {
    prependHistoricalKlines(sym, tf, j.data);
    return rawToKLine(j.data);
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════
// Global refs for custom indicator data
// ═══════════════════════════════════════════════════════════════════

const _vwapDataMap = { current: new Map<number, number>() };
const _frDataMap = { current: new Map<number, number>() };
const _vwapTfRef = { current: '5m' };
const _frTfRef = { current: '5m' };

function _registerIndicators(kc: KCLib) {
  try {
    kc.registerIndicator({
      name: 'VWAP_CUSTOM',
      shortName: 'VWAP',
      figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line' }],
      calc: (dataList: KLineData[]) => {
        const vm = _vwapDataMap.current;
        const tfMs = tfToMs(_vwapTfRef.current) * 2;
        return dataList.map(k => {
          const exact = vm.get(k.timestamp);
          if (exact !== undefined) return { vwap: exact };
          let closest: number | undefined, minD = Infinity;
          for (const [ts, v] of vm) {
            const d = Math.abs(ts - k.timestamp);
            if (d < minD) { minD = d; closest = v; }
          }
          return { vwap: (closest !== undefined && minD < tfMs) ? closest : NaN };
        });
      },
      styles: { lines: [{ color: '#ffa500' }] } as any,
    });
  } catch { /* already registered */ }

  try {
    kc.registerIndicator({
      name: 'FUNDING_RATE',
      shortName: 'FR',
      figures: [{ key: 'fr', title: 'FR: ', type: 'line' }],
      calc: (dataList: KLineData[]) => {
        const fm = _frDataMap.current;
        const bs = tfToSec(_frTfRef.current) * 1000;
        return dataList.map(k => {
          const bt = Math.floor(k.timestamp / bs) * bs;
          return { fr: fm.get(bt) ?? NaN };
        });
      },
      styles: { lines: [{ color: '#06b6d4' }] } as any,
    });
  } catch { /* already registered */ }
}

// ═══════════════════════════════════════════════════════════════════
// Overlay Registration (once globally)
// ═══════════════════════════════════════════════════════════════════

let _overlaysRegistered = false;

function registerOverlays(kc: KCLib) {
  if (_overlaysRegistered) return;
  _overlaysRegistered = true;

  // --- Horizontal price line ---
  kc.registerOverlay({
    name: 'priceLine',
    totalStep: 0,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ overlay, bounding, yAxis }: any) => {
      const ext = overlay.extendData;
      if (!ext?.price || !yAxis) return [];
      const y = yAxis.convertToNicePixel(ext.price);
      if (y < -20 || y > bounding.height + 20) return [];
      const solid = ext.lineStyle === 'solid';
      return [{
        type: 'line',
        attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] },
        styles: {
          style: solid ? 'solid' : 'dashed',
          color: ext.color || '#ffa726',
          size: solid ? 2 : 1,
          dashedValue: solid ? [0, 0] : ext.lineStyle === 'dotted' ? [2, 4] : [6, 4],
        },
      }, ...(ext.label ? [{
        type: 'text',
        attrs: { x: 8, y: y - 14, text: ext.label },
        styles: {
          color: '#fff', size: 10, family: 'inherit',
          backgroundColor: ext.color || '#ffa726',
          borderRadius: 2,
          paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2,
        },
      }] : [])];
    },
    createYAxisFigures: ({ overlay, yAxis }: any) => {
      const ext = overlay.extendData;
      if (!ext?.price || !yAxis) return [];
      const y = yAxis.convertToNicePixel(ext.price);
      return [{
        type: 'text',
        attrs: { x: 0, y, text: smartPrice(ext.price) },
        styles: {
          color: '#fff', size: 10, family: 'inherit',
          backgroundColor: ext.color || '#ffa726',
          borderRadius: 2,
          paddingLeft: 3, paddingRight: 3, paddingTop: 1, paddingBottom: 1,
        },
      }];
    },
  } as any);

  // --- Liquidation marker ---
  kc.registerOverlay({
    name: 'liqMarker',
    totalStep: 0,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, bounding, xAxis, yAxis }: any) => {
      const ext = overlay.extendData;
      if (!ext || !xAxis || !yAxis) return [];
      const x = xAxis.convertTimestampToPixel(toChartTimestamp(ext.timestamp));
      const y = yAxis.convertToNicePixel(ext.price);
      if (x < -20 || x > bounding.width + 20 || y < -20 || y > bounding.height + 20) return [];
      if (!isFinite(x) || !isFinite(y)) return [];
      const textY = y + (ext.textOffsetY ?? ((ext.r || 3) + 12));
      return [
        {
          type: 'circle',
          attrs: { x, y, r: ext.r || 3 },
          styles: {
            color: ext.color,
            style: 'fill',
            borderColor: ext.borderColor || 'rgba(255,255,255,0.55)',
            borderSize: 1,
          },
        },
        ...(ext.text ? [{
          type: 'text',
          attrs: { x, y: textY, text: ext.text },
          styles: {
            color: ext.textColor || '#fff',
            size: 9,
            family: 'inherit',
            weight: '600',
            backgroundColor: ext.color,
            borderRadius: 3,
            paddingLeft: 3,
            paddingRight: 3,
            paddingTop: 1,
            paddingBottom: 1,
          },
        }] : []),
      ];
    },
  } as any);

  // --- Order marker ---
  kc.registerOverlay({
    name: 'orderMarker',
    totalStep: 0,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, bounding, xAxis, yAxis }: any) => {
      const ext = overlay.extendData;
      if (!ext || !xAxis || !yAxis) return [];
      const x = xAxis.convertTimestampToPixel(toChartTimestamp(ext.timestamp));
      const y = yAxis.convertToNicePixel(ext.price);
      if (x < -20 || x > bounding.width + 20 || y < -20 || y > bounding.height + 20) return [];
      if (!isFinite(x) || !isFinite(y)) return [];
      const s = 6;
      const arrow = ext.isBuy
        ? { type: 'polygon', attrs: { coordinates: [{ x: x - s, y: y + s }, { x: x + s, y: y + s }, { x, y: y - s }] }, styles: { color: ext.color, style: 'fill' } }
        : { type: 'polygon', attrs: { coordinates: [{ x: x - s, y: y - s }, { x: x + s, y: y - s }, { x, y: y + s }] }, styles: { color: ext.color, style: 'fill' } };
      return [
        arrow,
        ...(ext.text ? [{ type: 'text', attrs: { x, y: ext.isBuy ? y - s - 12 : y + s + 12, text: ext.text }, styles: { color: '#fff', size: 8, family: 'inherit', backgroundColor: ext.color, borderRadius: 3, paddingLeft: 3, paddingRight: 3, paddingTop: 1, paddingBottom: 1 } }] : []),
      ];
    },
  } as any);

  // --- Signal highlight (vertical line) ---
  kc.registerOverlay({
    name: 'signalHighlight',
    totalStep: 0,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, bounding, xAxis }: any) => {
      const ext = overlay.extendData;
      if (!ext?.timestamp || !xAxis) return [];
      const x = xAxis.convertTimestampToPixel(toChartTimestamp(ext.timestamp));
      if (x < -20 || x > bounding.width + 20 || !isFinite(x)) return [];
      return [
        {
          type: 'line',
          attrs: { coordinates: [{ x, y: 0 }, { x, y: bounding.height }] },
          styles: { style: 'dashed', color: 'rgba(250, 204, 21, 0.5)', size: 1, dashedValue: [4, 4] },
        },
        {
          type: 'circle',
          attrs: { x, y: 6, r: 3 },
          styles: { color: 'rgba(250, 204, 21, 0.8)', style: 'fill' },
        },
      ];
    },
  } as any);

  _registerIndicators(kc);
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function KLineChartComponent({
  symbol,
  liquidations = [],
  positions = [],
  className,
  availableSymbols = [],
  onSymbolChange,
  scrollToTimestamp,
  highlightTimestamp,
}: KLineChartProps) {
  const { config } = useConfig();

  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const kcRef = useRef<KCLib | null>(null);
  const latestPriceRef = useRef(0);
  const symbolRef = useRef(symbol);
  const tfRef = useRef('5m');
  const datafeedIntervalsRef = useRef<{ refresh?: ReturnType<typeof setInterval> }>({});

  // ── State ──
  const [isVisible, setIsVisible] = useState(true);
  const [showPositions, setShowPositions] = useState(true);
  const [showLiquidations, setShowLiquidations] = useState(true);
  const [liqGrouping, setLiqGrouping] = useState('5m');
  const [showRecentOrders, setShowRecentOrders] = useState(false);
  const [showVWAP, setShowVWAP] = useState(false);
  const [showFundingRate, setShowFundingRate] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [selectedTf, setSelectedTf] = useState('5m');

  // ── Drawing tools state ──
  const [activeDrawTool, setActiveDrawTool] = useState<string | null>(null);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [activeMainIndicators, setActiveMainIndicators] = useState<string[]>([]);
  const [activeSubIndicators, setActiveSubIndicators] = useState<string[]>(['VOL']);
  const indicatorMenuRef = useRef<HTMLDivElement>(null);
  const indicatorDropdownRef = useRef<HTMLDivElement>(null);
  const [indicatorMenuPos, setIndicatorMenuPos] = useState({ top: 0, left: 0 });

  const timeframes = useMemo(() => ['1m', '5m', '15m', '30m', '1h', '4h', '1d'], []);
  const studyToggles = useMemo(() => ([
    { id: 'tpsl', label: 'TP/SL', val: showPositions, set: setShowPositions },
    { id: 'liqs', label: 'Liqs', val: showLiquidations, set: setShowLiquidations },
    { id: 'ords', label: 'Orders', val: showRecentOrders, set: setShowRecentOrders },
    { id: 'vwap', label: 'VWAP', val: showVWAP, set: setShowVWAP },
    { id: 'fr', label: 'FR', val: showFundingRate, set: setShowFundingRate },
  ]), [showPositions, showLiquidations, showRecentOrders, showVWAP, showFundingRate]);

  useEffect(() => { symbolRef.current = symbol; }, [symbol]);
  useEffect(() => { tfRef.current = selectedTf; }, [selectedTf]);

  // ── Close indicator menu on outside click ──
  useEffect(() => {
    if (!showIndicatorMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (indicatorMenuRef.current && !indicatorMenuRef.current.contains(e.target as Node) &&
          indicatorDropdownRef.current && !indicatorDropdownRef.current.contains(e.target as Node)) {
        setShowIndicatorMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showIndicatorMenu]);

  // ── Position the indicator dropdown relative to its trigger ──
  useEffect(() => {
    if (!showIndicatorMenu || !indicatorMenuRef.current) return;
    const rect = indicatorMenuRef.current.getBoundingClientRect();
    setIndicatorMenuPos({ top: rect.bottom + 4, left: rect.left });
  }, [showIndicatorMenu]);

  // ── Drawing tool handler ──
  const handleDrawingTool = useCallback((toolName: string) => {
    if (!chartRef.current) return;
    setActiveDrawTool(toolName);
    chartRef.current.createOverlay({
      name: toolName,
      groupId: 'userDrawings',
      mode: 'normal',
      onDrawEnd: () => { setActiveDrawTool(null); },
    } as any);
  }, []);

  const handleClearDrawings = useCallback(() => {
    if (!chartRef.current) return;
    chartRef.current.removeOverlay({ groupId: 'userDrawings' });
    setActiveDrawTool(null);
  }, []);

  const handleCursorMode = useCallback(() => {
    setActiveDrawTool(null);
  }, []);

  // ── Indicator toggle handler ──
  const handleToggleIndicator = useCallback((ind: IndicatorDef) => {
    if (!chartRef.current) return;
    const c = chartRef.current;

    if (ind.isMain) {
      const isActive = activeMainIndicators.includes(ind.name);
      if (isActive) {
        c.removeIndicator({ name: ind.name, paneId: 'candle_pane' });
        setActiveMainIndicators(prev => prev.filter(n => n !== ind.name));
      } else {
        c.createIndicator(ind.name, true, { id: 'candle_pane' });
        setActiveMainIndicators(prev => [...prev, ind.name]);
      }
    } else {
      const isActive = activeSubIndicators.includes(ind.name);
      if (isActive) {
        c.removeIndicator({ name: ind.name });
        setActiveSubIndicators(prev => prev.filter(n => n !== ind.name));
      } else {
        c.createIndicator(ind.name, false, { height: 80 });
        setActiveSubIndicators(prev => [...prev, ind.name]);
      }
    }
  }, [activeMainIndicators, activeSubIndicators]);

  // ── Overlay data state ──
  const [dbLiquidations, setDbLiquidations] = useState<LiquidationData[]>([]);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [filledOrders, setFilledOrders] = useState<any[]>([]);
  const allLiquidations = useMemo(() => [...liquidations, ...dbLiquidations], [liquidations, dbLiquidations]);

  // ══════════════════════════════════════════════════════════════════
  // KLineChart lifecycle (plain klinecharts)
  // ══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!isVisible || !containerRef.current) return;
    let disposed = false;
    const rootEl = containerRef.current;

    const boot = async () => {
      const el = rootEl;
      if (!el || el.clientWidth === 0) {
        await new Promise(r => requestAnimationFrame(r));
        if (disposed || !containerRef.current) return;
      }

      const kc = await import('klinecharts');
      if (disposed) return;
      kcRef.current = kc;
      registerOverlays(kc);
      const chart = kc.init(el, {
        styles: PRO_CHART_STYLES,
        locale: 'en-US',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (!chart || disposed) return;

      chartRef.current = chart;
      if (typeof window !== 'undefined') {
        (window as Window & { __asterKlineChart?: unknown }).__asterKlineChart = chart;
      }
      chart.setSymbol({
        ticker: symbolRef.current,
        pricePrecision: 2,
        volumePrecision: 2,
      });
      chart.setPeriod(tfToKcPeriod(tfRef.current));
      chart.setDataLoader({
        getBars: async ({ type, timestamp, symbol: sym, period, callback }) => {
          const tf = kcPeriodToTf(period);
          tfRef.current = tf;
          symbolRef.current = sym.ticker;
          try {
            // In klinecharts, "forward" prepends data older than the first bar.
            if (type === 'forward' && timestamp != null) {
              const data = await fetchBackwardData(sym.ticker, tf, timestamp);
              callback(data, { forward: data.length > 0, backward: false });
              setDataVersion(v => v + 1);
              return;
            }

            // "backward" appends data newer than the last bar; live updates are
            // handled by subscribeBar, so we should not append historical data here.
            if (type !== 'init') {
              callback([], { backward: false, forward: false });
              return;
            }

            const data = await fetchInitData(sym.ticker, tf);
            if (data.length > 0) latestPriceRef.current = data[data.length - 1].close;
            callback(data, { backward: false, forward: data.length > 0 });
            setDataVersion(v => v + 1);
          } catch {
            callback([], { backward: false, forward: false });
          }
        },
        subscribeBar: ({ symbol: sym, period, callback }) => {
          const tf = kcPeriodToTf(period);

          const doRefresh = async () => {
            try {
              const cached = getCachedKlines(sym.ticker, tf);
              if (!cached) return;
              const r = await fetch(`/api/klines?symbol=${encodeURIComponent(sym.ticker)}&interval=${tf}&since=${cached.lastCandleTime}&limit=2`);
              const j = await r.json();
              if (j.success && j.data?.length > 0) {
                updateCachedKlines(sym.ticker, tf, j.data);
                const bars = rawToKLine(j.data);
                bars.forEach(b => callback(b));
                if (bars.length > 0) latestPriceRef.current = bars[bars.length - 1].close;
                setDataVersion(v => v + 1);
              }
            } catch { /* keep polling */ }
          };

          if (datafeedIntervalsRef.current.refresh) clearInterval(datafeedIntervalsRef.current.refresh);
          datafeedIntervalsRef.current.refresh = setInterval(doRefresh, 15000);
        },
        unsubscribeBar: () => {
          if (datafeedIntervalsRef.current.refresh) {
            clearInterval(datafeedIntervalsRef.current.refresh);
            datafeedIntervalsRef.current.refresh = undefined;
          }
        },
      });

      chart.createIndicator('VOL', false, { height: 80 });
      chart.resetData();
    };

    boot();

    return () => {
      disposed = true;
      if (datafeedIntervalsRef.current.refresh) clearInterval(datafeedIntervalsRef.current.refresh);
      datafeedIntervalsRef.current = {};

      if (kcRef.current && rootEl) {
        try {
          kcRef.current.dispose(rootEl);
        } catch { /* ok */ }
      }
      if (rootEl) rootEl.innerHTML = '';
      chartRef.current = null;
      if (typeof window !== 'undefined') {
        delete (window as Window & { __asterKlineChart?: unknown }).__asterKlineChart;
      }
    };
  }, [isVisible]);

  // ── Parent-driven symbol/timeframe changes ──
  useEffect(() => {
    if (!chartRef.current) return;
    try {
      chartRef.current.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 2 });
      chartRef.current.resetData();
    } catch { /* ok */ }
  }, [symbol]);

  useEffect(() => {
    if (!chartRef.current) return;
    try {
      chartRef.current.setPeriod(tfToKcPeriod(selectedTf));
      chartRef.current.resetData();
    } catch { /* ok */ }
  }, [selectedTf]);

  // ── Scroll to timestamp when requested by parent ──
  useEffect(() => {
    if (!scrollToTimestamp || !chartRef.current) return;
    // Small delay to let symbol/data load settle if symbol also changed
    const timer = setTimeout(() => {
      try {
        chartRef.current?.scrollToTimestamp(scrollToTimestamp, 300);
      } catch { /* ok */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [scrollToTimestamp]);

  // ── Signal highlight overlay (hover from signal feed) ──
  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartRef.current;
    c.removeOverlay({ groupId: 'signalHL' });
    if (!highlightTimestamp) return;
    c.createOverlay({
      name: 'signalHighlight', groupId: 'signalHL', lock: true, visible: true,
      points: [{ timestamp: toChartTimestamp(highlightTimestamp) }] as any,
      extendData: { timestamp: highlightTimestamp },
    } as any);
  }, [highlightTimestamp]);

  // ══════════════════════════════════════════════════════════════════
  // Overlay data fetching
  // ══════════════════════════════════════════════════════════════════

  const fetchLiqData = useCallback(async () => {
    const sym = symbolRef.current;
    if (!sym) return;
    try {
      const r = await fetch(`/api/liquidations?symbol=${encodeURIComponent(sym)}&limit=2000`);
      const j = await r.json();
      if (j.success && j.data) {
        setDbLiquidations(j.data.map((l: any) => ({
          time: l.event_time, event_time: l.event_time,
          volume: l.volume_usdt, volume_usdt: l.volume_usdt,
          side: l.side, price: l.price, quantity: l.quantity,
        })));
      }
    } catch { /* ok */ }
  }, []);

  const fetchOrders = useCallback(async () => {
    const sym = symbolRef.current;
    if (!sym) return;
    try {
      const r = await fetch('/api/orders');
      const j = await r.json();
      if (Array.isArray(j)) setOpenOrders(j.filter((o: any) => o.symbol === sym));
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    if (symbol && isVisible) { fetchLiqData(); fetchOrders(); }
  }, [symbol, isVisible, fetchLiqData, fetchOrders]);

  useEffect(() => {
    if (!isVisible) return;
    const iv = setInterval(() => { fetchLiqData(); fetchOrders(); }, 30000);
    return () => clearInterval(iv);
  }, [isVisible, fetchLiqData, fetchOrders]);

  // ══════════════════════════════════════════════════════════════════
  // Position / TP / SL overlays
  // ══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartRef.current;
    c.removeOverlay({ groupId: 'positions' });
    if (!showPositions) return;

    const livePrice = latestPriceRef.current > 0 ? latestPriceRef.current : undefined;
    const symPositions = positions.filter(p => p.symbol === symbol);

    symPositions.forEach((pos: any) => {
      const entry = parseFloat(pos.entryPrice || pos.markPrice || pos.avgPrice || '0');
      const qty = parseFloat(pos.quantity || pos.positionAmt || pos.size || '0');
      const side = pos.side;
      const amt = side === 'SHORT' ? -qty : qty;
      const liqPrice = parseFloat(pos.liquidationPrice || '0');
      if (entry <= 0 || Math.abs(amt) <= 0) return;
      const isLong = amt > 0;

      c.createOverlay({
        name: 'priceLine', groupId: 'positions', lock: true, visible: true,
        points: [{ value: entry }] as any,
        extendData: { price: entry, label: `${isLong ? 'LONG' : 'SHORT'} Entry: ${smartPrice(entry)}`, color: isLong ? '#26a69a' : '#ef5350', lineStyle: 'solid' },
      } as any);

      if (liqPrice > 0) {
        c.createOverlay({
          name: 'priceLine', groupId: 'positions', lock: true, visible: true,
          points: [{ value: liqPrice }] as any,
          extendData: { price: liqPrice, label: `Liquidation: ${smartPrice(liqPrice)}`, color: '#ff1744', lineStyle: 'dashed' },
        } as any);
      }
    });

    openOrders.filter(o => o.symbol === symbol).forEach((order: any) => {
      const isTrail = order.type === 'TRAILING_STOP_MARKET';
      if (isTrail) {
        const actPrice = parseFloat(order.activatePrice || '0');
        const stopPrice = parseFloat(order.stopPrice || '0');
        const cbRate = parseFloat(order.priceRate || '0');
        const posSide = order.positionSide || (order.side === 'SELL' ? 'LONG' : 'SHORT');
        const matchPos = symPositions.find((p: any) => (p.side || p.positionSide || '').toUpperCase() === posSide.toUpperCase());
        const mp = (livePrice && livePrice > 0) ? livePrice : (matchPos ? parseFloat(matchPos.markPrice || matchPos.avgPrice || '0') : 0);
        const isLng = posSide === 'LONG';
        const activated = actPrice > 0 && mp > 0 && (isLng ? mp >= actPrice : mp <= actPrice);

        if (actPrice > 0) {
          c.createOverlay({
            name: 'priceLine', groupId: 'positions', lock: true, visible: true,
            points: [{ value: actPrice }] as any,
            extendData: { price: actPrice, label: activated ? 'Trail Armed ✓' : `Trail Arm: ${smartPrice(actPrice)}`, color: activated ? '#22c55e' : '#a855f7', lineStyle: 'dashed' },
          } as any);
        }
        if (activated) {
          let live = stopPrice;
          if (cbRate > 0 && mp > 0) {
            const est = isLng ? mp * (1 - cbRate / 100) : mp * (1 + cbRate / 100);
            live = isLng ? Math.max(stopPrice, est) : Math.min(stopPrice, est);
          }
          if (live > 0) {
            c.createOverlay({
              name: 'priceLine', groupId: 'positions', lock: true, visible: true,
              points: [{ value: live }] as any,
              extendData: { price: live, label: `Trail Stop: ${smartPrice(live)} (-${cbRate}%)`, color: '#22c55e', lineStyle: 'solid' },
            } as any);
          }
        }
        return;
      }
      const p = parseFloat(order.stopPrice || order.price || '0');
      if (p <= 0) return;
      const isTP = order.type?.includes('TAKE_PROFIT');
      const isSL = order.type?.includes('STOP') && !isTP;
      const color = isTP ? '#4caf50' : isSL ? '#f44336' : '#ffa726';
      const label = isTP ? `TP: ${smartPrice(p)}` : isSL ? `SL: ${smartPrice(p)}` : `Order: ${smartPrice(p)}`;
      c.createOverlay({
        name: 'priceLine', groupId: 'positions', lock: true, visible: true,
        points: [{ value: p }] as any,
        extendData: { price: p, label, color, lineStyle: 'dashed' },
      } as any);
    });
  }, [positions, openOrders, showPositions, symbol, dataVersion]);

  // ══════════════════════════════════════════════════════════════════
  // Liquidation markers
  // ══════════════════════════════════════════════════════════════════

  const groupLiqs = useCallback((liqs: LiquidationData[], gTf: string): GroupedLiquidation[] => {
    const groups: Record<string, GroupedLiquidation> = {};
    const ps = tfToSec(gTf);
    [...liqs].sort((a, b) => a.event_time - b.event_time).forEach(l => {
      const sec = Math.floor(l.event_time / 1000);
      const pe = (Math.floor(sec / ps) + 1) * ps;
      const side = l.side === 'SELL' ? 1 : 0;
      const k = `${pe}_${side}`;
      if (!groups[k]) groups[k] = { timestamp: pe * 1000, side, totalVolume: 0, count: 0, price: 0 };
      groups[k].totalVolume += l.volume_usdt;
      groups[k].count++;
      groups[k].price = (groups[k].price * (groups[k].count - 1) + l.price) / groups[k].count;
    });
    return Object.values(groups).sort((a, b) => a.timestamp - b.timestamp);
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartRef.current;
    c.removeOverlay({ groupId: 'liqs' });
    if (!showLiquidations || allLiquidations.length === 0) return;

    const grouped = groupLiqs(allLiquidations, liqGrouping);
    const overlays = grouped.map(g => {
      const vol = g.totalVolume;
      const color = g.side === 1
        ? (vol > 1e6 ? '#ff1744' : vol > 1e5 ? '#ff5722' : '#ff9800')
        : (vol > 1e6 ? '#1976d2' : vol > 1e5 ? '#2196f3' : '#64b5f6');
      const borderColor = g.side === 1 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.45)';
      const r = vol > 1e6 ? 7 : vol > 2e5 ? 5 : vol > 5e4 ? 4 : 3;
      const shortVol = vol >= 1e6
        ? `$${(vol / 1e6).toFixed(1)}M`
        : vol >= 1000
          ? `$${Math.round(vol / 1000)}K`
          : `$${Math.round(vol)}`;
      const showText = vol >= 1e5 || g.count >= 3;
      const text = showText ? `${g.count}${g.side === 1 ? 'L' : 'S'} ${shortVol}` : '';
      const textOffsetY = g.side === 1 ? -(r + 12) : (r + 12);
      return {
        name: 'liqMarker', groupId: 'liqs', lock: true, visible: true,
        points: [{ timestamp: g.timestamp, value: g.price }],
        extendData: {
          color,
          borderColor,
          r,
          text,
          textOffsetY,
          timestamp: g.timestamp,
          price: g.price,
        },
      };
    });
    if (overlays.length > 0) c.createOverlay(overlays as any);
  }, [showLiquidations, allLiquidations, liqGrouping, groupLiqs, dataVersion]);

  // ══════════════════════════════════════════════════════════════════
  // VWAP custom indicator
  // ══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartRef.current;
    c.removeIndicator({ name: 'VWAP_CUSTOM', paneId: 'candle_pane' });
    if (!showVWAP || !symbol) return;

    const symCfg = config?.symbols?.[symbol];
    const vwapTf = symCfg?.vwapTimeframe || '5m';
    const tf = tfRef.current;
    _vwapTfRef.current = tf;

    const doFetch = async () => {
      try {
        const r = await fetch(`/api/vwap/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${vwapTf}&limit=1500`);
        const j = await r.json();
        if (!j?.data?.length) return;

        const chartMs = tfToMs(tf);
        const vMs = tfToMs(vwapTf);
        let pts = j.data;
        if (chartMs > vMs) {
          const step = Math.max(1, Math.floor(chartMs / vMs));
          const ds: typeof pts = [];
          for (let i = 0; i < pts.length; i += step) ds.push(pts[i]);
          if (pts.length > 0 && (pts.length - 1) % step !== 0) ds.push(pts[pts.length - 1]);
          pts = ds;
        }

        const map = new Map<number, number>();
        for (const p of pts) {
          const ts = toChartTimestamp(p.time);
          map.set(ts, p.value);
        }
        _vwapDataMap.current = map;

        c.removeIndicator({ name: 'VWAP_CUSTOM', paneId: 'candle_pane' });
        c.createIndicator('VWAP_CUSTOM', true, { id: 'candle_pane' });
      } catch (err) {
        console.warn('[KLineChart] VWAP error:', err);
      }
    };

    doFetch();
    const iv = setInterval(doFetch, 30000);
    return () => {
      clearInterval(iv);
      chartRef.current?.removeIndicator({ name: 'VWAP_CUSTOM', paneId: 'candle_pane' });
    };
  }, [showVWAP, symbol, config, dataVersion]);

  // ══════════════════════════════════════════════════════════════════
  // Funding Rate custom indicator
  // ══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartRef.current;
    c.removeIndicator({ name: 'FUNDING_RATE' });
    if (!showFundingRate || !symbol) return;

    const tf = tfRef.current;
    _frTfRef.current = tf;

    const hrsMap: Record<string, number> = {
      '1m': 24, '5m': 72, '15m': 168, '30m': 336, '1h': 720, '4h': 720, '1d': 720,
    };

    const doFetch = async () => {
      try {
        const r = await fetch(`/api/funding-rates?symbol=${encodeURIComponent(symbol)}&hours=${hrsMap[tf] || 168}`);
        const j = await r.json();
        if (!j?.data?.length) return;

        const bSec = tfToSec(tf);
        const map = new Map<number, number>();
        for (const d of j.data) {
          const b = Math.floor(toChartTimestamp(d.time) / (bSec * 1000)) * (bSec * 1000);
          map.set(b, d.value);
        }
        _frDataMap.current = map;

        c.removeIndicator({ name: 'FUNDING_RATE' });
        c.createIndicator('FUNDING_RATE', false, { height: 80 });
      } catch (err) {
        console.warn('[KLineChart] FR error:', err);
      }
    };

    doFetch();
    const iv = setInterval(doFetch, 60000);
    return () => {
      clearInterval(iv);
      chartRef.current?.removeIndicator({ name: 'FUNDING_RATE' });
    };
  }, [showFundingRate, symbol, dataVersion]);

  // ══════════════════════════════════════════════════════════════════
  // Dynamic indicator sync (for indicators added via picker)
  // ══════════════════════════════════════════════════════════════════



  // ══════════════════════════════════════════════════════════════════
  // Recent orders
  // ══════════════════════════════════════════════════════════════════

  useEffect(() => {
    const load = async () => {
      if (!showRecentOrders) { setFilledOrders([]); return; }
      try {
        const params = new URLSearchParams({
          symbol, format: 'orders', limit: '500',
          startTime: (Date.now() - 90 * 86400000).toString(),
        });
        const r = await fetch(`/api/trades/history?${params}`);
        if (r.ok) {
          const db = await r.json();
          if (db.length > 0) {
            const ids = new Set(db.map((o: any) => o.orderId));
            const rt = orderStore.getOrders().data.filter((o: any) =>
              o.status === 'FILLED' && o.symbol === symbol && !ids.has(o.orderId));
            setFilledOrders([...rt, ...db]);
            return;
          }
        }
      } catch { /* fallthrough */ }
      setFilledOrders(orderStore.getOrders().data.filter((o: any) => o.status === 'FILLED' && o.symbol === symbol));
    };
    load();
    const h = () => {
      if (!showRecentOrders) return;
      const all = orderStore.getOrders().data.filter((o: any) => o.status === 'FILLED' && o.symbol === symbol);
      setFilledOrders(prev => {
        const ids = new Set(prev.map((o: any) => o.orderId));
        const fresh = all.filter((o: any) => !ids.has(o.orderId));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
    };
    orderStore.on('orders:updated', h);
    orderStore.on('orders:filtered', h);
    return () => { orderStore.off('orders:updated', h); orderStore.off('orders:filtered', h); };
  }, [symbol, showRecentOrders]);

  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartRef.current;
    c.removeOverlay({ groupId: 'orders' });
    if (!showRecentOrders || filledOrders.length === 0) return;

    const seen = new Set<string>();
    const ovs: any[] = [];
    filledOrders.forEach((o: any) => {
      if (!o.orderId || seen.has(o.orderId)) return;
      seen.add(o.orderId);
      const t = Number(o.updateTime || o.time || o.transactTime);
      const price = parseFloat(o.avgPrice || o.price || o.stopPrice || '0');
      if (price <= 0) return;
      const isBuy = o.side === 'BUY';
      const isReduce = o.reduceOnly === true || o.reduceOnly === 'true';
      const pnl = o.realizedProfit ? parseFloat(o.realizedProfit) : 0;
      const color = isReduce ? (pnl > 0 ? '#4caf50' : pnl < 0 ? '#f44336' : '#9e9e9e') : (isBuy ? '#26a69a' : '#ef5350');
      const type = isReduce ? (isBuy ? 'Close SHORT' : 'Close LONG') : (isBuy ? 'LONG' : 'SHORT');
      const qty = o.executedQty || o.origQty || '';
      let text = `${type} ${qty}@${smartPrice(price)}`;
      if (isReduce && pnl !== 0) text += ` ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`;
      ovs.push({
        name: 'orderMarker', groupId: 'orders', lock: true, visible: true,
        points: [{ timestamp: toChartTimestamp(t), value: price }],
        extendData: { color, isBuy: isBuy && !isReduce, text, timestamp: toChartTimestamp(t), price },
      });
    });
    if (ovs.length > 0) c.createOverlay(ovs as any);
  }, [showRecentOrders, filledOrders, dataVersion]);

  // ══════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════

  if (!symbol) {
    return (
      <div className={cn("rounded-lg border bg-card text-card-foreground", className)}>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Select a symbol to view chart</p>
        </div>
      </div>
    );
  }

  const allActiveIndicators = [...activeMainIndicators, ...activeSubIndicators];

  return (
    <div className={cn("rounded-lg border bg-card text-card-foreground flex flex-col", className)}>
      {/* ─── Top Toolbar ─── */}
      <div className="flex items-center h-10 border-b bg-card/80 px-2 gap-1.5 overflow-x-auto flex-shrink-0">
        {/* Symbol Selector */}
        {availableSymbols.length > 0 && onSymbolChange ? (
          <SearchableSelect
            value={symbol} onValueChange={onSymbolChange}
            options={availableSymbols} placeholder="Symbol"
            className="w-[110px] sm:w-[130px] h-7 text-xs flex-shrink-0"
          />
        ) : (
          <span className="text-xs font-semibold px-1 flex-shrink-0">{symbol}</span>
        )}

        <div className="w-px h-5 bg-border mx-1 flex-shrink-0" />

        {/* Timeframe Buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {timeframes.map(tf => (
            <button
              key={tf}
              type="button"
              onClick={() => setSelectedTf(tf)}
              className={cn(
                "h-6 rounded px-2 text-[10px] font-medium transition-colors",
                selectedTf === tf
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-border mx-1 flex-shrink-0" />

        {/* Indicator Picker */}
        <div className="relative flex-shrink-0" ref={indicatorMenuRef}>
          <button
            type="button"
            onClick={() => setShowIndicatorMenu(v => !v)}
            className={cn(
              "inline-flex items-center gap-1 h-7 rounded px-2 text-[10px] font-medium transition-colors",
              showIndicatorMenu ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
            )}
          >
            <BarChart3 className="h-3 w-3" />
            <span className="hidden sm:inline">Indicators</span>
            <ChevronDown className="h-2.5 w-2.5" />
          </button>

          {showIndicatorMenu && (
            <div
              ref={indicatorDropdownRef}
              className="fixed z-[9999] w-52 rounded-md border bg-popover shadow-lg p-1 max-h-80 overflow-y-auto"
              style={{ top: indicatorMenuPos.top, left: indicatorMenuPos.left }}>
              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                Main Pane
              </div>
              {AVAILABLE_INDICATORS.filter(i => i.isMain).map(ind => {
                const active = allActiveIndicators.includes(ind.name);
                return (
                  <button
                    key={ind.name}
                    type="button"
                    onClick={() => handleToggleIndicator(ind)}
                    className="flex items-center w-full gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors"
                  >
                    <span className={cn("h-3.5 w-3.5 flex items-center justify-center", active && "text-primary")}>
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    <span className={cn(active && "text-foreground font-medium")}>{ind.label}</span>
                  </button>
                );
              })}
              <div className="my-1 h-px bg-border" />
              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                Sub Pane
              </div>
              {AVAILABLE_INDICATORS.filter(i => !i.isMain).map(ind => {
                const active = allActiveIndicators.includes(ind.name);
                return (
                  <button
                    key={ind.name}
                    type="button"
                    onClick={() => handleToggleIndicator(ind)}
                    className="flex items-center w-full gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors"
                  >
                    <span className={cn("h-3.5 w-3.5 flex items-center justify-center", active && "text-primary")}>
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    <span className={cn(active && "text-foreground font-medium")}>{ind.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1 flex-shrink-0" />

        {/* Study Toggles */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {studyToggles.map(o => (
            <button
              key={o.id}
              type="button"
              aria-pressed={o.val}
              onClick={() => o.set(v => !v)}
              className={cn(
                "inline-flex items-center gap-1 h-6 rounded px-2 text-[10px] font-medium transition-colors",
                o.val
                  ? "bg-accent text-foreground ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", o.val ? "bg-primary" : "bg-muted-foreground/40")} />
              {o.label}
            </button>
          ))}
        </div>

        {showLiquidations && (
          <>
            <div className="w-px h-5 bg-border mx-1 flex-shrink-0" />
            <select
              value={liqGrouping}
              onChange={e => setLiqGrouping(e.target.value)}
              className="h-6 text-[10px] bg-background border rounded px-1.5 text-muted-foreground flex-shrink-0"
            >
              {timeframes.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </>
        )}

        <div className="flex-1" />

        {/* Collapse Toggle */}
        <button
          type="button"
          onClick={() => setIsVisible(v => !v)}
          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 flex-shrink-0"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !isVisible && '-rotate-90')} />
        </button>
      </div>

      {/* ─── Chart Area ─── */}
      {isVisible && (
        <div className="flex flex-1 min-h-0">
          {/* Drawing Tools Sidebar */}
          <div className="hidden sm:flex flex-col w-9 border-r bg-card/50 items-center py-1 gap-px flex-shrink-0 overflow-y-auto">
            {/* Cursor */}
            <button
              type="button"
              onClick={handleCursorMode}
              title="Cursor"
              className={cn(
                "h-7 w-7 flex items-center justify-center rounded transition-colors",
                activeDrawTool === null
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              <MousePointer2 className="h-3.5 w-3.5" />
            </button>

            <div className="w-5 h-px bg-border my-0.5" />

            {/* Drawing Tools */}
            {DRAWING_TOOLS.map(tool => (
              <button
                key={tool.name}
                type="button"
                onClick={() => handleDrawingTool(tool.name)}
                title={tool.label}
                className={cn(
                  "h-7 w-7 flex items-center justify-center rounded transition-colors",
                  activeDrawTool === tool.name
                    ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
              >
                <tool.icon className="h-3.5 w-3.5" />
              </button>
            ))}

            <div className="flex-1" />

            {/* Clear All Drawings */}
            <button
              type="button"
              onClick={handleClearDrawings}
              title="Clear all drawings"
              className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Chart Container */}
          <div
            ref={containerRef}
            className="flex-1 min-w-0"
            style={{ height: 600 }}
          />
        </div>
      )}
    </div>
  );
}
