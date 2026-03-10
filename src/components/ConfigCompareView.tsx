'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Table2, Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfig } from '@/components/ConfigProvider';

const COLS = [
  { key: 'leverage',              label: 'Lev',         format: (v: any) => v ? `${v}×` : '—' },
  { key: 'tpPercent',             label: 'TP%',          format: (v: any) => v != null ? `${v}%` : '—' },
  { key: 'slPercent',             label: 'SL%',          format: (v: any) => v != null ? `${v}%` : '—' },
  { key: 'longVolumeThresholdUSDT',  label: 'Long Vol',  format: (v: any) => v ? `$${(v/1000).toFixed(0)}k` : '—' },
  { key: 'shortVolumeThresholdUSDT', label: 'Short Vol', format: (v: any) => v ? `$${(v/1000).toFixed(0)}k` : '—' },
  { key: 'tradeSize',             label: 'Size',         format: (v: any) => v != null ? String(v) : '—' },
  { key: 'longTradeSize',         label: 'L Size',       format: (v: any) => v != null ? `$${v}` : '—' },
  { key: 'shortTradeSize',        label: 'S Size',       format: (v: any) => v != null ? `$${v}` : '—' },
  { key: 'maxPositionMarginUSDT', label: 'Max Mgn',      format: (v: any) => v ? `$${v}` : '—' },
  { key: 'vwapProtection',        label: 'VWAP',         format: (v: any) => v ? '✅' : '❌', isFlag: true },
  { key: 'orderType',             label: 'Order',        format: (v: any) => v === 'MARKET' ? <Badge variant="secondary" className="text-[10px] px-1 h-4">MKT</Badge> : <Badge variant="outline" className="text-[10px] px-1 h-4">LMT</Badge> },
  { key: 'priceOffsetBps',        label: 'Offset',       format: (v: any) => v != null ? `${v}bps` : '—' },
];

// Highlight cells that differ from the most common value in a column
function findOutliers(rows: any[], colKey: string): Set<string> {
  const freq: Record<string, number> = {};
  for (const r of rows) {
    const v = String(r.cfg[colKey] ?? '');
    freq[v] = (freq[v] ?? 0) + 1;
  }
  const majority = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
  return new Set(rows.filter(r => String(r.cfg[colKey] ?? '') !== majority).map(r => r.symbol));
}

export default function ConfigCompareView() {
  const { config } = useConfig();
  const [collapsed, setCollapsed] = useState(false);

  if (!config?.symbols || Object.keys(config.symbols).length < 2) return null;

  const symbols = Object.keys(config.symbols);
  const rows = symbols.map(sym => ({ symbol: sym, cfg: config.symbols[sym] }));

  // Precompute outlier sets per column
  const outliersByCol = Object.fromEntries(COLS.map(c => [c.key, findOutliers(rows, c.key)]));

  return (
    <div className="rounded-lg border bg-card">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/40 transition-colors rounded-t-lg"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-muted-foreground" />
          <span>Symbol Config Comparison</span>
          <Badge variant="secondary" className="h-4 text-[10px] px-1.5">{symbols.length} symbols</Badge>
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-1.5 font-medium sticky left-0 bg-muted/60 text-muted-foreground min-w-[90px]">Symbol</th>
                {COLS.map(c => (
                  <th key={c.key} className="text-center px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ symbol, cfg }, idx) => (
                <tr key={symbol} className={`border-b last:border-b-0 ${idx % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <td className="px-3 py-1.5 font-medium sticky left-0 bg-card whitespace-nowrap">
                    {symbol.replace('USDT', '')}
                    <span className="text-muted-foreground text-[9px] ml-0.5">USDT</span>
                  </td>
                  {COLS.map(c => {
                    const val = cfg[c.key as keyof typeof cfg];
                    const isOutlier = outliersByCol[c.key].has(symbol);
                    const formatted = c.format(val);
                    return (
                      <td
                        key={c.key}
                        className={`text-center px-2 py-1.5 ${
                          isOutlier && val != null
                            ? 'text-amber-400 font-medium'
                            : val == null ? 'text-muted-foreground/40' : ''
                        }`}
                      >
                        {formatted}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[9px] text-muted-foreground/50 px-3 pb-1.5 pt-0.5">
            Amber = differs from most common value across symbols
          </p>
        </div>
      )}
    </div>
  );
}
