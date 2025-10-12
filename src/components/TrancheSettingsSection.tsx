'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TrancheSettingsSectionProps {
  symbol: string;
  config: any;
  onChange: (field: string, value: any) => void;
}

export function TrancheSettingsSection({ symbol, config, onChange }: TrancheSettingsSectionProps) {
  const enabled = config.enableTrancheManagement ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Multi-Tranche Position Management</CardTitle>
        <CardDescription>
          Track multiple position entries to isolate underwater positions and continue trading
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor={`${symbol}-enable-tranche`}>Enable Tranche Management</Label>
            <p className="text-sm text-muted-foreground">
              Track multiple virtual position entries for better margin utilization
            </p>
          </div>
          <Switch
            id={`${symbol}-enable-tranche`}
            checked={enabled}
            onCheckedChange={(checked) => onChange('enableTrancheManagement', checked)}
          />
        </div>

        {enabled && (
          <>
            <Separator />

            {/* Isolation Threshold */}
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${symbol}-isolation-threshold`}>
                  Isolation Threshold (%)
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Tranches with unrealized loss exceeding this percentage will be isolated.
                        New trades won't add to isolated tranches.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id={`${symbol}-isolation-threshold`}
                type="number"
                min="1"
                max="50"
                step="0.5"
                value={config.trancheIsolationThreshold ?? 5}
                onChange={(e) => onChange('trancheIsolationThreshold', parseFloat(e.target.value) || 5)}
                placeholder="5"
              />
              <p className="text-xs text-muted-foreground">
                Default: 5% loss. Typical range: 3-10%
              </p>
            </div>

            {/* Max Tranches */}
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${symbol}-max-tranches`}>
                  Max Active Tranches
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Maximum number of active (non-isolated) tranches allowed per symbol.
                        Prevents over-exposure to a single asset.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id={`${symbol}-max-tranches`}
                type="number"
                min="1"
                max="10"
                step="1"
                value={config.maxTranches ?? 3}
                onChange={(e) => onChange('maxTranches', parseInt(e.target.value) || 3)}
                placeholder="3"
              />
              <p className="text-xs text-muted-foreground">
                Default: 3. Typical range: 2-5
              </p>
            </div>

            {/* Max Isolated Tranches */}
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${symbol}-max-isolated-tranches`}>
                  Max Isolated Tranches
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Maximum number of isolated (underwater) tranches allowed before blocking new trades.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                id={`${symbol}-max-isolated-tranches`}
                type="number"
                min="1"
                max="5"
                step="1"
                value={config.maxIsolatedTranches ?? 2}
                onChange={(e) => onChange('maxIsolatedTranches', parseInt(e.target.value) || 2)}
                placeholder="2"
              />
              <p className="text-xs text-muted-foreground">
                Default: 2. Typical range: 1-3
              </p>
            </div>

            <Separator />

            {/* Closing Strategy */}
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${symbol}-closing-strategy`}>
                  Closing Strategy
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Determines which tranches to close first when SL/TP is hit:
                        <br />• FIFO: First in, first out
                        <br />• LIFO: Last in, first out
                        <br />• WORST_FIRST: Most negative P&L first
                        <br />• BEST_FIRST: Most positive P&L first
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select
                value={config.trancheStrategy?.closingStrategy ?? 'FIFO'}
                onValueChange={(value) =>
                  onChange('trancheStrategy', {
                    ...(config.trancheStrategy || {}),
                    closingStrategy: value,
                  })
                }
              >
                <SelectTrigger id={`${symbol}-closing-strategy`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIFO">FIFO (First In, First Out)</SelectItem>
                  <SelectItem value="LIFO">LIFO (Last In, First Out)</SelectItem>
                  <SelectItem value="WORST_FIRST">Worst First (Most Negative P&L)</SelectItem>
                  <SelectItem value="BEST_FIRST">Best First (Most Positive P&L)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* SL/TP Strategy */}
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${symbol}-sltp-strategy`}>
                  SL/TP Price Strategy
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Determines which tranche's TP/SL prices to use for exchange orders:
                        <br />• NEWEST: Use newest tranche's prices
                        <br />• OLDEST: Use oldest tranche's prices
                        <br />• BEST_ENTRY: Use best entry price
                        <br />• AVERAGE: Use weighted average
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select
                value={config.trancheStrategy?.slTpStrategy ?? 'NEWEST'}
                onValueChange={(value) =>
                  onChange('trancheStrategy', {
                    ...(config.trancheStrategy || {}),
                    slTpStrategy: value,
                  })
                }
              >
                <SelectTrigger id={`${symbol}-sltp-strategy`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NEWEST">Newest Tranche</SelectItem>
                  <SelectItem value="OLDEST">Oldest Tranche</SelectItem>
                  <SelectItem value="BEST_ENTRY">Best Entry Price</SelectItem>
                  <SelectItem value="AVERAGE">Weighted Average</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Advanced Options */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm">Advanced Options</h4>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor={`${symbol}-allow-while-isolated`}>
                    Allow New Tranches While Isolated
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Continue opening new tranches even when isolated tranches exist
                  </p>
                </div>
                <Switch
                  id={`${symbol}-allow-while-isolated`}
                  checked={config.allowTrancheWhileIsolated ?? true}
                  onCheckedChange={(checked) => onChange('allowTrancheWhileIsolated', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor={`${symbol}-auto-close-isolated`}>
                    Auto-Close Isolated Tranches
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically close isolated tranches when they recover (experimental)
                  </p>
                </div>
                <Switch
                  id={`${symbol}-auto-close-isolated`}
                  checked={config.trancheAutoCloseIsolated ?? false}
                  onCheckedChange={(checked) => onChange('trancheAutoCloseIsolated', checked)}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
