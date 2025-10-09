'use client';

import React from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface OptimizerWeightSlidersProps {
  pnlWeight: number;
  sharpeWeight: number;
  drawdownWeight: number;
  onPnlWeightChange: (value: number) => void;
  onSharpeWeightChange: (value: number) => void;
  onDrawdownWeightChange: (value: number) => void;
}

/**
 * OptimizerWeightSliders Component
 *
 * Customizable weight controls for PnL/Sharpe/Drawdown scoring
 * Auto-adjusts other weights proportionally to maintain 100% sum
 */
export function OptimizerWeightSliders({
  pnlWeight,
  sharpeWeight,
  drawdownWeight,
  onPnlWeightChange,
  onSharpeWeightChange,
  onDrawdownWeightChange,
}: OptimizerWeightSlidersProps) {
  const total = pnlWeight + sharpeWeight + drawdownWeight;
  const isValid = Math.abs(total - 100) < 0.1;

  const handlePnlChange = (value: number) => {
    const remaining = 100 - value;
    const currentOthersSum = sharpeWeight + drawdownWeight;

    if (currentOthersSum === 0) {
      // Split evenly
      const half = Math.floor(remaining / 2);
      onPnlWeightChange(value);
      onSharpeWeightChange(half);
      onDrawdownWeightChange(remaining - half);
    } else {
      // Distribute proportionally
      const sharpeRatio = sharpeWeight / currentOthersSum;
      const newSharpe = Math.round(remaining * sharpeRatio);
      const newDrawdown = remaining - newSharpe;

      onPnlWeightChange(value);
      onSharpeWeightChange(newSharpe);
      onDrawdownWeightChange(newDrawdown);
    }
  };

  const handleSharpeChange = (value: number) => {
    const remaining = 100 - value;
    const currentOthersSum = pnlWeight + drawdownWeight;

    if (currentOthersSum === 0) {
      // Split evenly
      const half = Math.floor(remaining / 2);
      onSharpeWeightChange(value);
      onPnlWeightChange(half);
      onDrawdownWeightChange(remaining - half);
    } else {
      // Distribute proportionally
      const pnlRatio = pnlWeight / currentOthersSum;
      const newPnl = Math.round(remaining * pnlRatio);
      const newDrawdown = remaining - newPnl;

      onSharpeWeightChange(value);
      onPnlWeightChange(newPnl);
      onDrawdownWeightChange(newDrawdown);
    }
  };

  const handleDrawdownChange = (value: number) => {
    const remaining = 100 - value;
    const currentOthersSum = pnlWeight + sharpeWeight;

    if (currentOthersSum === 0) {
      // Split evenly
      const half = Math.floor(remaining / 2);
      onDrawdownWeightChange(value);
      onPnlWeightChange(half);
      onSharpeWeightChange(remaining - half);
    } else {
      // Distribute proportionally
      const pnlRatio = pnlWeight / currentOthersSum;
      const newPnl = Math.round(remaining * pnlRatio);
      const newSharpe = remaining - newPnl;

      onDrawdownWeightChange(value);
      onPnlWeightChange(newPnl);
      onSharpeWeightChange(newSharpe);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="pnl-weight">PnL Weight</Label>
          <span className="text-sm font-medium">{pnlWeight}%</span>
        </div>
        <Slider
          id="pnl-weight"
          min={0}
          max={100}
          step={5}
          value={[pnlWeight]}
          onValueChange={(value) => handlePnlChange(value[0])}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Prioritize total profit generation
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="sharpe-weight">Sharpe Ratio Weight</Label>
          <span className="text-sm font-medium">{sharpeWeight}%</span>
        </div>
        <Slider
          id="sharpe-weight"
          min={0}
          max={100}
          step={5}
          value={[sharpeWeight]}
          onValueChange={(value) => handleSharpeChange(value[0])}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Prioritize consistency & risk-adjusted returns
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="drawdown-weight">Drawdown Protection Weight</Label>
          <span className="text-sm font-medium">{drawdownWeight}%</span>
        </div>
        <Slider
          id="drawdown-weight"
          min={0}
          max={100}
          step={5}
          value={[drawdownWeight]}
          onValueChange={(value) => handleDrawdownChange(value[0])}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Prioritize capital preservation
        </p>
      </div>

      <div className="pt-2 border-t">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total:</span>
          <span className={`font-medium ${isValid ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
            {total.toFixed(1)}%
            {!isValid && ' (Must equal 100%)'}
          </span>
        </div>
      </div>
    </div>
  );
}

