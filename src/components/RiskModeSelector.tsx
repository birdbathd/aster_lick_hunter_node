'use client';

import React, { useState } from 'react';
import { Gauge } from 'lucide-react';
import { useConfig } from '@/components/ConfigProvider';

const PRESETS = {
  CONSERVATIVE: { multiplier: 0.5, maxPositions: 2, label: 'Safe', color: 'text-blue-400 border-blue-500 bg-blue-500/10', activeColor: 'bg-blue-500 text-white border-blue-500' },
  NORMAL:       { multiplier: 1.0, maxPositions: 3, label: 'Normal', color: 'text-muted-foreground border-border bg-transparent hover:bg-muted', activeColor: 'bg-muted text-foreground border-border' },
  AGGRESSIVE:   { multiplier: 1.5, maxPositions: 4, label: 'Hot 🔥', color: 'text-amber-400 border-amber-500 bg-amber-500/10', activeColor: 'bg-amber-500 text-white border-amber-500' },
  MAX:          { multiplier: 2.0, maxPositions: 5, label: 'Max ⚡', color: 'text-red-400 border-red-500 bg-red-500/10 hover:bg-red-500/20', activeColor: 'bg-red-500 text-white border-red-500' },
} as const;

type RiskMode = keyof typeof PRESETS;

export default function RiskModeSelector() {
  const { config, updateConfig } = useConfig();
  const [isSaving, setIsSaving] = useState(false);

  if (!config) return null;

  const currentMode: RiskMode = (config.global?.riskMode as RiskMode) || 'NORMAL';

  const handleSelect = async (mode: RiskMode) => {
    if (mode === currentMode || isSaving) return;
    const preset = PRESETS[mode];
    setIsSaving(true);
    try {
      await updateConfig({
        ...config,
        global: {
          ...config.global,
          riskMode: mode,
          tradeSizeMultiplier: preset.multiplier,
          maxOpenPositions: preset.maxPositions,
        },
      });
    } catch (e) {
      console.error('Failed to set risk mode:', e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex rounded-md border overflow-hidden" title="Global risk mode — scales trade size & max positions">
        {(Object.keys(PRESETS) as RiskMode[]).map((mode) => {
          const p = PRESETS[mode];
          const isActive = mode === currentMode;
          return (
            <button
              key={mode}
              disabled={isSaving}
              onClick={() => handleSelect(mode)}
              className={`px-2 py-0.5 text-[10px] font-medium border-r last:border-r-0 transition-colors
                ${isActive ? p.activeColor : p.color}
                ${isSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
              `}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <span className="text-[10px] text-muted-foreground">
        {PRESETS[currentMode].multiplier}× / {PRESETS[currentMode].maxPositions}pos
      </span>
    </div>
  );
}
