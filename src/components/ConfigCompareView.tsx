'use client';

import React, { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, Table2, Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useConfig } from '@/components/ConfigProvider';
import { toast } from 'sonner';

type ColDef = {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  options?: string[];       // for select
  step?: number;
  min?: number;
  suffix?: string;          // display suffix e.g. '×' or '%'
  prefix?: string;          // display prefix e.g. '$'
  scale?: number;           // display value = raw / scale (e.g. /1000 for k display)
};

const COLS: ColDef[] = [
  { key: 'leverage',                  label: 'Lev',       type: 'number', min: 1,    step: 1,     suffix: '×' },
  { key: 'tpPercent',                 label: 'TP%',       type: 'number', min: 0.1,  step: 0.1,   suffix: '%' },
  { key: 'slPercent',                 label: 'SL%',       type: 'number', min: 0.1,  step: 0.1,   suffix: '%' },
  { key: 'longVolumeThresholdUSDT',   label: 'Long Vol',  type: 'number', min: 0,    step: 100,   prefix: '$' },
  { key: 'shortVolumeThresholdUSDT',  label: 'Short Vol', type: 'number', min: 0,    step: 100,   prefix: '$' },
  { key: 'tradeSize',                 label: 'Size',      type: 'number', min: 0,    step: 0.001 },
  { key: 'longTradeSize',             label: 'L Size',    type: 'number', min: 0,    step: 1,     prefix: '$' },
  { key: 'shortTradeSize',            label: 'S Size',    type: 'number', min: 0,    step: 1,     prefix: '$' },
  { key: 'maxPositionMarginUSDT',     label: 'Max Mgn',   type: 'number', min: 0,    step: 10,    prefix: '$' },
  { key: 'vwapProtection',            label: 'VWAP',      type: 'boolean' },
  { key: 'orderType',                 label: 'Order',     type: 'select', options: ['LIMIT', 'MARKET'] },
  { key: 'priceOffsetBps',            label: 'Offset',    type: 'number', min: 0,    step: 1,     suffix: 'bps' },
];

function formatDisplay(col: ColDef, raw: unknown): string {
  if (raw == null) return '—';
  if (col.type === 'boolean') return raw ? '✅' : '❌';
  if (col.type === 'select') {
    if (raw === 'MARKET') return 'MKT';
    if (raw === 'LIMIT') return 'LMT';
    return String(raw);
  }
  const num = Number(raw);
  if (isNaN(num)) return String(raw);
  const disp = col.scale ? num / col.scale : num;
  const decimals = col.step && col.step < 1 ? String(col.step).split('.')[1]?.length ?? 2 : 0;
  return `${col.prefix ?? ''}${disp % 1 === 0 ? disp : disp.toFixed(decimals)}${col.suffix ?? ''}`;
}

function findOutliers(rows: { symbol: string; cfg: Record<string, unknown> }[], colKey: string): Set<string> {
  const freq: Record<string, number> = {};
  for (const r of rows) {
    const v = String(r.cfg[colKey] ?? '');
    freq[v] = (freq[v] ?? 0) + 1;
  }
  const majority = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
  return new Set(rows.filter(r => String(r.cfg[colKey] ?? '') !== majority).map(r => r.symbol));
}

export default function ConfigCompareView() {
  const { config, updateConfig } = useConfig();
  const [collapsed, setCollapsed] = useState(false);
  // editing: { symbol, key } | null
  const [editing, setEditing] = useState<{ symbol: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!config?.symbols || Object.keys(config.symbols).length < 2) return null;

  const symbols = Object.keys(config.symbols);
  const rows = symbols.map(sym => ({ symbol: sym, cfg: config.symbols[sym] as unknown as Record<string, unknown> }));
  const outliersByCol = Object.fromEntries(COLS.map(c => [c.key, findOutliers(rows, c.key)]));

  function startEdit(symbol: string, col: ColDef, rawVal: unknown) {
    setEditing({ symbol, key: col.key });
    setEditValue(rawVal == null ? '' : String(rawVal));
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function commitEdit(symbol: string, col: ColDef) {
    if (!config) return;
    let newVal: unknown = editValue;
    if (col.type === 'number') {
      const n = parseFloat(editValue);
      if (isNaN(n)) { setEditing(null); return; }
      newVal = n;
    } else if (col.type === 'boolean') {
      newVal = editValue === 'true';
    }
    const updated = {
      ...config,
      symbols: {
        ...config.symbols,
        [symbol]: { ...config.symbols[symbol], [col.key]: newVal },
      },
    };
    try {
      await updateConfig(updated);
      toast.success(`${symbol} ${col.label} → ${formatDisplay(col, newVal)}`);
    } catch {
      toast.error('Failed to save');
    }
    setEditing(null);
  }

  function cancelEdit() { setEditing(null); }

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
                  {COLS.map(col => {
                    const raw = cfg[col.key];
                    const isOutlier = outliersByCol[col.key].has(symbol);
                    const isActive = editing?.symbol === symbol && editing?.key === col.key;

                    return (
                      <td
                        key={col.key}
                        className={`text-center px-1 py-0.5 ${isOutlier && raw != null ? 'text-amber-400 font-medium' : raw == null ? 'text-muted-foreground/40' : ''}`}
                      >
                        {isActive ? (
                          <span className="flex items-center gap-0.5 justify-center">
                            {col.type === 'boolean' ? (
                              <select
                                className="w-12 h-5 text-[10px] bg-background border border-primary rounded px-0.5"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(symbol, col)}
                                autoFocus
                              >
                                <option value="true">✅</option>
                                <option value="false">❌</option>
                              </select>
                            ) : col.type === 'select' ? (
                              <select
                                className="h-5 text-[10px] bg-background border border-primary rounded px-0.5"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(symbol, col)}
                                autoFocus
                              >
                                {col.options!.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : (
                              <input
                                ref={inputRef}
                                type="number"
                                step={col.step}
                                min={col.min}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitEdit(symbol, col);
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                                onBlur={() => commitEdit(symbol, col)}
                                className="w-16 h-5 text-center text-[10px] bg-background border border-primary rounded px-0.5"
                              />
                            )}
                            <button onClick={() => commitEdit(symbol, col)} className="text-emerald-500 hover:text-emerald-400"><Check className="h-2.5 w-2.5" /></button>
                            <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground"><X className="h-2.5 w-2.5" /></button>
                          </span>
                        ) : (
                          <button
                            className="w-full hover:bg-primary/10 rounded px-1 py-0.5 cursor-pointer transition-colors min-w-[36px]"
                            onClick={() => startEdit(symbol, col, raw)}
                            title="Click to edit"
                          >
                            {formatDisplay(col, raw)}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[9px] text-muted-foreground/50 px-3 pb-1.5 pt-0.5">
            Amber = differs from majority · Click any cell to edit inline
          </p>
        </div>
      )}
    </div>
  );
}
