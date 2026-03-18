'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Config, SymbolConfig } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Plus,
  Trash2,
  Save,
  Key,
  Eye,
  EyeOff,
  Shield,
  ShieldAlert,
  TrendingUp,
  AlertCircle,
  Settings2,
  BarChart3,
  Database,
  Clock,
  Crosshair,
  ArrowUpDown,
  Heart,
  Gauge,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';
import { TrancheSettingsSection } from './TrancheSettingsSection';

// Number input that allows clearing the field
interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: number | '';
  onChange: (value: number | '') => void;
  defaultValue?: number;
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, defaultValue = 0, onBlur, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        type="number"
        value={value}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val === '' ? '' : parseFloat(val));
        }}
        onBlur={(e) => {
          const val = e.target.value;
          if (val === '' || isNaN(parseFloat(val))) {
            onChange(defaultValue);
          }
          onBlur?.(e);
        }}
        {...props}
      />
    );
  }
);
NumberInput.displayName = 'NumberInput';

interface SymbolConfigFormProps {
  onSave: (config: Config) => void;
  currentConfig?: Config;
}

export default function SymbolConfigForm({ onSave, currentConfig }: SymbolConfigFormProps) {
  // Ensure we have a properly initialized config with all required fields
  const getInitialConfig = (): Config => {
    if (currentConfig) {
      // Ensure api object exists
      if (!currentConfig.api) {
        currentConfig.api = { apiKey: '', secretKey: '' };
      }
      
      // Ensure global object exists with all required fields
      if (!currentConfig.global) {
        currentConfig.global = {
          riskPercent: 2,
          paperMode: false,
          positionMode: 'HEDGE',
          maxOpenPositions: 10,
          useThresholdSystem: false,
          server: {
            dashboardPassword: '',
            dashboardPort: 0,
            websocketPort: 0,
            useRemoteWebSocket: false,
            websocketHost: null
          },
          rateLimit: {
            maxRequestWeight: 2400,
            maxOrderCount: 1200,
            reservePercent: 30,
            enableBatching: true,
            queueTimeout: 30000,
            enableDeduplication: true,
            deduplicationWindowMs: 1000,
            parallelProcessing: true,
            maxConcurrentRequests: 3
          },
          liquidationDatabase: {
            retentionDays: 90,
            cleanupIntervalHours: 24
          }
        };
      } else {
        // Ensure liquidationDatabase exists even if global exists
        if (!currentConfig.global.liquidationDatabase) {
          currentConfig.global.liquidationDatabase = {
            retentionDays: 90,
            cleanupIntervalHours: 24
          };
        }
        // Ensure cascadeProtection exists
        if (!currentConfig.global.cascadeProtection) {
          currentConfig.global.cascadeProtection = {
            enabled: true,
            rollingWindowMinutes: 5,
            baselineWindowMinutes: 30,
            volumeMultiplierThreshold: 3.0,
            minSymbolsForCascade: 3,
            directionalSkewThreshold: 0.8,
            cooldownMinutes: 10,
            minVolumeForDetection: 50000
          };
        }
      }
      
      // Ensure symbols object exists
      if (!currentConfig.symbols) {
        currentConfig.symbols = {};
      }
      
      return { ...currentConfig };
    }
    
    // Default config if none provided
    return {
      api: {
        apiKey: '',
        secretKey: ''
      },
      global: {
        riskPercent: 5,
        paperMode: false,
        positionMode: 'HEDGE',
        maxOpenPositions: 10,
        useThresholdSystem: false,
        useTradeQualityScoring: false,
        useFTAExitAnalysis: false,
        server: {
          dashboardPassword: 'admin',
          dashboardPort: 0,
          websocketPort: 0,
          useRemoteWebSocket: false,
          websocketHost: null
        },
        rateLimit: {
          maxRequestWeight: 2400,
          maxOrderCount: 1200,
          reservePercent: 30,
          enableBatching: true,
          queueTimeout: 30000,
          parallelProcessing: true,
          maxConcurrentRequests: 3
        },
        liquidationDatabase: {
          retentionDays: 90,
          cleanupIntervalHours: 24
        }
      },
      symbols: {},
      version: '1.1.0'
    };
  };

  const [config, setConfig] = useState<Config>(getInitialConfig());

  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [newSymbol, setNewSymbol] = useState<string>('');
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<any[]>([]);
  const [symbolDetails, setSymbolDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingSymbols, setLoadingSymbols] = useState(false);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [useSeparateTradeSizes, setUseSeparateTradeSizes] = useState<Record<string, boolean>>({});
  const [longTradeSizeInput, setLongTradeSizeInput] = useState<string>('');
  const [shortTradeSizeInput, setShortTradeSizeInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('api');

  // Handle URL parameter for adding symbols from Discovery page
  const searchParams = useSearchParams();
  const symbolFromUrl = searchParams.get('symbol');
  const addFromUrl = searchParams.get('add');

  useEffect(() => {
    if (symbolFromUrl && addFromUrl === 'true') {
      // Switch to symbols tab and add the symbol
      setActiveTab('symbols');
      
      // Small delay to ensure config is loaded
      setTimeout(() => {
        if (!config.symbols[symbolFromUrl]) {
          // Symbol not configured yet - add it
          const defaultConfig = getDefaultSymbolConfig();
          setConfig(prev => ({
            ...prev,
            symbols: {
              ...prev.symbols,
              [symbolFromUrl]: defaultConfig,
            },
          }));
          setSelectedSymbol(symbolFromUrl);
          toast.success(`Added ${symbolFromUrl} - configure settings and save`);
        } else {
          // Symbol already exists - just select it
          setSelectedSymbol(symbolFromUrl);
          toast.info(`${symbolFromUrl} is already configured`);
        }
        
        // Clear the URL params without reload
        window.history.replaceState({}, '', '/config');
      }, 100);
    }
  }, [symbolFromUrl, addFromUrl]);

  // Function to generate default config - conservative defaults
  // Trade size defaults to $1 - users MUST adjust based on the minimum shown for each symbol
  const getDefaultSymbolConfig = (): SymbolConfig => {
    return {
      longVolumeThresholdUSDT: 10000,  // For long positions (buy on sell liquidations)
      shortVolumeThresholdUSDT: 10000, // For short positions (sell on buy liquidations)
      leverage: 10,
      tradeSize: 1, // Very conservative - user must set based on symbol minimum
      maxPositionMarginUSDT: 100,
      slPercent: 2,
      tpPercent: 3,
      priceOffsetBps: 5,      // 5 basis points offset for limit orders
      maxSlippageBps: 50,     // 50 basis points max slippage
      orderType: 'LIMIT' as const,
      vwapProtection: false,  // VWAP protection disabled by default
      vwapTimeframe: '1m',    // Default to 1 minute timeframe
      vwapLookback: 100,      // Default to 100 candles
      // Multi-Tranche defaults (disabled by default)
      enableTrancheManagement: false,
      trancheIsolationThreshold: 5,
      maxTranches: 3,
      maxIsolatedTranches: 2,
      allowTrancheWhileIsolated: true,
      trancheAutoCloseIsolated: false,
      trancheRecoveryThreshold: 0.5,
    };
  };

  const handleGlobalChange = (field: string, value: any) => {
    setConfig({
      ...config,
      global: {
        ...config.global,
        [field]: value,
      },
    });
  };

  const handleApiChange = (field: string, value: string) => {
    setConfig({
      ...config,
      api: {
        ...config.api,
        [field]: value,
      },
    });
  };

  const handleSymbolChange = (symbol: string, field: string, value: any) => {
    setConfig({
      ...config,
      symbols: {
        ...config.symbols,
        [symbol]: {
          ...config.symbols[symbol],
          [field]: value,
        },
      },
    });
  };

  // Fetch available symbols when the symbols tab is clicked
  const fetchAvailableSymbols = async () => {
    if (availableSymbols.length > 0) return; // Already loaded

    setLoadingSymbols(true);
    try {
      const response = await fetch('/api/symbols');
      if (!response.ok) {
        throw new Error('Failed to fetch symbols');
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response type');
      }
      const data = await response.json();
      if (data.symbols) {
        setAvailableSymbols(data.symbols);
      }
    } catch (error) {
      console.error('Failed to fetch symbols:', error);
      toast.error('Failed to load available symbols');
    } finally {
      setLoadingSymbols(false);
    }
  };

  const addSymbol = (symbolToAdd?: string) => {
    const symbol = symbolToAdd || newSymbol;
    if (symbol && !config.symbols[symbol]) {
      const defaultConfig = getDefaultSymbolConfig();
      setConfig({
        ...config,
        symbols: {
          ...config.symbols,
          [symbol]: defaultConfig,
        },
      });
      setSelectedSymbol(symbol);
      setNewSymbol('');
      setShowSymbolPicker(false);
      setSymbolSearch('');
      toast.success(`Added ${symbol} to configuration`);
    }
  };

  const removeSymbol = (symbol: string) => {
    const { [symbol]: _, ...rest } = config.symbols;
    setConfig({
      ...config,
      symbols: rest,
    });
    if (selectedSymbol === symbol) {
      setSelectedSymbol('');
    }
    toast.success(`Removed ${symbol} from configuration`);
  };

  const handleSave = () => {
    // Validate dashboard password if set
    const dashboardPassword = config.global.server?.dashboardPassword;
    if (dashboardPassword && dashboardPassword.length > 0 && dashboardPassword.length < 4) {
      alert('Dashboard password must be at least 4 characters');
      return;
    }

    // Clean up longTradeSize/shortTradeSize from symbols where separate sizes are disabled
    const cleanedConfig = { ...config };
    cleanedConfig.symbols = { ...config.symbols };
    
    Object.keys(cleanedConfig.symbols).forEach(symbol => {
      if (!useSeparateTradeSizes[symbol]) {
        // Remove separate trade size fields when toggle is off
        const { longTradeSize: _longTradeSize, shortTradeSize: _shortTradeSize, ...restSymbolConfig } = cleanedConfig.symbols[symbol];
        cleanedConfig.symbols[symbol] = restSymbolConfig;
      }
    });

    onSave(cleanedConfig);
  };

  // Fetch symbol details when selecting a symbol
  const fetchSymbolDetails = async (symbol: string) => {
    setLoadingDetails(true);
    try {
      const response = await fetch(`/api/symbol-details/${symbol}`);
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`Symbol details API error: ${response.status} - ${errorText}`);
        throw new Error(`Failed to fetch symbol details (${response.status})`);
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response type');
      }
      const data = await response.json();
      setSymbolDetails(data);
    } catch (error) {
      console.error('Failed to fetch symbol details:', error);
      setSymbolDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Effect to fetch details when selected symbol changes
  useEffect(() => {
    if (selectedSymbol && config.symbols[selectedSymbol]) {
      fetchSymbolDetails(selectedSymbol);
      // Sync input states with config values
      const symbolConfig = config.symbols[selectedSymbol];
      const hasLongSize = symbolConfig.longTradeSize !== undefined;
      const hasShortSize = symbolConfig.shortTradeSize !== undefined;

      // Update the toggle state for this symbol
      setUseSeparateTradeSizes(prev => ({
        ...prev,
        [selectedSymbol]: hasLongSize || hasShortSize
      }));

      setLongTradeSizeInput((hasLongSize && symbolConfig.longTradeSize !== undefined ? symbolConfig.longTradeSize : symbolConfig.tradeSize ?? 100).toString());
      setShortTradeSizeInput((hasShortSize && symbolConfig.shortTradeSize !== undefined ? symbolConfig.shortTradeSize : symbolConfig.tradeSize ?? 100).toString());
    } else {
      setSymbolDetails(null);
    }
  }, [selectedSymbol, config.symbols]);

  // Initialize separate trade sizes state based on existing config
  useEffect(() => {
    const separateSizes: Record<string, boolean> = {};
    Object.keys(config.symbols).forEach(symbol => {
      const symbolConfig = config.symbols[symbol];
      // Set to true if either longTradeSize or shortTradeSize are explicitly defined
      const hasLongSize = symbolConfig.longTradeSize !== undefined;
      const hasShortSize = symbolConfig.shortTradeSize !== undefined;
      separateSizes[symbol] = hasLongSize || hasShortSize;
    });
    setUseSeparateTradeSizes(separateSizes);
  }, [config.symbols]);

  // Calculate minimum margin based on leverage (with 30% buffer for safety)
  const getMinimumMargin = () => {
    if (!symbolDetails || !selectedSymbol || !config.symbols[selectedSymbol]) {
      return null;
    }
    const leverage = config.symbols[selectedSymbol].leverage || 1;

    // Calculate minimum from notional requirement
    const minFromNotional = symbolDetails.minNotional / leverage;

    // Calculate minimum from quantity requirement
    // minQty * currentPrice = notional needed, then divide by leverage for margin
    const minFromQuantity = (symbolDetails.minQty * symbolDetails.currentPrice) / leverage;

    // Use the larger of the two requirements
    const rawMinimum = Math.max(minFromNotional, minFromQuantity);

    // Add 30% buffer to avoid rejection due to price movements
    return rawMinimum * 1.3;
  };

  // Get raw minimum without buffer (for display purposes)
  const getRawMinimum = () => {
    if (!symbolDetails || !selectedSymbol || !config.symbols[selectedSymbol]) {
      return null;
    }
    const leverage = config.symbols[selectedSymbol].leverage || 1;

    // Calculate both minimums and return the larger one
    const minFromNotional = symbolDetails.minNotional / leverage;
    const minFromQuantity = (symbolDetails.minQty * symbolDetails.currentPrice) / leverage;

    return Math.max(minFromNotional, minFromQuantity);
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="api" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="global" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Global Settings
          </TabsTrigger>
          <TabsTrigger value="symbols" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Symbols
          </TabsTrigger>
        </TabsList>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API Configuration</CardTitle>
              <CardDescription>
                Connect your exchange API for live trading or leave empty for paper mode
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="text"
                  value={config.api?.apiKey || ''} 
                  onChange={(e) => handleApiChange('apiKey', e.target.value)}
                  placeholder="Enter your API key (optional for paper mode)"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Your API key for exchange authentication
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="secretKey">Secret Key</Label>
                <div className="relative">
                  <Input
                    id="secretKey"
                    type={showApiSecret ? 'text' : 'password'}
                    value={config.api?.secretKey || ''} 
                    onChange={(e) => handleApiChange('secretKey', e.target.value)}
                    placeholder="Enter your secret key (optional for paper mode)"
                    className="font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowApiSecret(!showApiSecret)}
                  >
                    {showApiSecret ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your secret key is encrypted and never shared
                </p>
              </div>

              {!config.api.apiKey && !config.api.secretKey && (
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    No API keys configured - Bot will run in paper mode only
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="global" className="space-y-3">

          {/* ── 1. TRADING MODE ──────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4" />
                Trading Mode
              </CardTitle>
              <CardDescription>Live vs simulation, position mode</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="paperMode">Paper Mode</Label>
                  <p className="text-xs text-muted-foreground">Simulation — no real orders placed</p>
                  <p className="text-xs text-amber-500">⚠️ Experimental — not thoroughly tested</p>
                </div>
                <Switch id="paperMode" checked={config.global.paperMode} onCheckedChange={(checked) => handleGlobalChange('paperMode', checked)} />
              </div>

              {config.global.paperMode && (
                <div className="space-y-4 pl-4 border-l-2 border-blue-500/30">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="startingBalance">Starting Balance (USDT)</Label>
                      <Input id="startingBalance" type="number" value={config.global.paperTrading?.startingBalance || 1000} onChange={(e) => { const v = parseFloat(e.target.value); handleGlobalChange('paperTrading', { ...config.global.paperTrading, startingBalance: isNaN(v) ? 1000 : Math.max(100, v) }); }} className="w-32" min="100" />
                      <p className="text-xs text-muted-foreground">Virtual balance to start with</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="slippageBps">Simulated Slippage (bps)</Label>
                      <Input id="slippageBps" type="number" value={config.global.paperTrading?.slippageBps || 0} onChange={(e) => { const v = parseFloat(e.target.value); handleGlobalChange('paperTrading', { ...config.global.paperTrading, slippageBps: isNaN(v) ? 0 : Math.max(0, Math.min(500, v)) }); }} className="w-32" min="0" max="500" />
                      <p className="text-xs text-muted-foreground">10 bps = 0.1% — recommended: 5–20</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="latencyMs">Network Latency (ms)</Label>
                      <Input id="latencyMs" type="number" value={config.global.paperTrading?.latencyMs || 0} onChange={(e) => { const v = parseInt(e.target.value); handleGlobalChange('paperTrading', { ...config.global.paperTrading, latencyMs: isNaN(v) ? 0 : Math.max(0, Math.min(5000, v)) }); }} className="w-32" min="0" max="5000" />
                      <p className="text-xs text-muted-foreground">Delay before fill — recommended: 50–200</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="partialFillPercent">Partial Fill Chance (%)</Label>
                      <Input id="partialFillPercent" type="number" value={config.global.paperTrading?.partialFillPercent || 0} onChange={(e) => { const v = parseFloat(e.target.value); handleGlobalChange('paperTrading', { ...config.global.paperTrading, partialFillPercent: isNaN(v) ? 0 : Math.max(0, Math.min(100, v)) }); }} className="w-32" min="0" max="100" />
                      <p className="text-xs text-muted-foreground">% chance limit orders only partially fill</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rejectionRate">Order Rejection Rate (%)</Label>
                      <Input id="rejectionRate" type="number" value={config.global.paperTrading?.rejectionRate || 0} onChange={(e) => { const v = parseFloat(e.target.value); handleGlobalChange('paperTrading', { ...config.global.paperTrading, rejectionRate: isNaN(v) ? 0 : Math.max(0, Math.min(100, v)) }); }} className="w-32" min="0" max="100" step="0.1" />
                      <p className="text-xs text-muted-foreground">% chance of random rejection — keep &lt;2%</p>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <div className="space-y-0.5">
                        <Label>Realistic Fill Simulation</Label>
                        <p className="text-xs text-muted-foreground">Use orderbook depth for fills</p>
                      </div>
                      <Switch checked={config.global.paperTrading?.enableRealisticFills || false} onCheckedChange={(checked) => handleGlobalChange('paperTrading', { ...config.global.paperTrading, enableRealisticFills: checked })} />
                    </div>
                  </div>
                  <Button type="button" variant="destructive" size="sm" onClick={async () => { if (!confirm('This will delete all paper trading positions and reset your balance. Continue?')) return; try { const r = await fetch('/api/paper-trading/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newBalance: config.global.paperTrading?.startingBalance || 1000 }) }); if (r.ok) { toast.success('Paper trading reset'); window.location.reload(); } else { toast.error('Failed to reset'); } } catch { toast.error('Error resetting'); } }}>
                    Reset Paper Trading
                  </Button>
                </div>
              )}

              <Separator />

              <div className="space-y-1.5">
                <Label htmlFor="positionMode">Position Mode</Label>
                <select id="positionMode" value={config.global.positionMode || 'ONE_WAY'} onChange={(e) => handleGlobalChange('positionMode', e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <option value="ONE_WAY">One-way Mode (BOTH)</option>
                  <option value="HEDGE">Hedge Mode (LONG/SHORT)</option>
                </select>
                <p className="text-xs text-muted-foreground">One-way: single position per symbol · Hedge: simultaneous longs &amp; shorts</p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="debugMode">Debug Mode</Label>
                  <p className="text-xs text-muted-foreground">Verbose console logging</p>
                </div>
                <Switch id="debugMode" checked={config.global.debugMode || false} onCheckedChange={(checked) => handleGlobalChange('debugMode', checked)} />
              </div>
            </CardContent>
          </Card>

          {/* ── 2. POSITION LIMITS ───────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4" />
                Position Limits
              </CardTitle>
              <CardDescription>How many positions the bot can hold at once</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="maxOpenPositions">Max Open Positions</Label>
                  <NumberInput id="maxOpenPositions" value={config.global.maxOpenPositions ?? ''} onChange={(v) => handleGlobalChange('maxOpenPositions', v)} defaultValue={10} className="w-full" min="1" max="50" step="1" />
                  <p className="text-xs text-muted-foreground">Total simultaneous positions</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="maxLongPositions">Max Long Positions</Label>
                  <NumberInput id="maxLongPositions" value={config.global.maxLongPositions ?? ''} onChange={(v) => handleGlobalChange('maxLongPositions', v)} defaultValue={3} className="w-full" min="1" max="20" step="1" />
                  <p className="text-xs text-muted-foreground">Max longs at once</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="maxShortPositions">Max Short Positions</Label>
                  <NumberInput id="maxShortPositions" value={config.global.maxShortPositions ?? ''} onChange={(v) => handleGlobalChange('maxShortPositions', v)} defaultValue={3} className="w-full" min="1" max="20" step="1" />
                  <p className="text-xs text-muted-foreground">Max shorts at once</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── 3. SIZE & RISK ───────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4" />
                Size &amp; Risk
              </CardTitle>
              <CardDescription>Global trade size multiplier and risk budget</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label>Trade Size Multiplier</Label>
                  {(() => {
                    const m = config.global.tradeSizeMultiplier ?? 1.0;
                    if (m > 2.0) return <Badge variant="destructive" className="text-[10px]">HIGH RISK</Badge>;
                    if (m > 1.0) return <Badge className="text-[10px] bg-yellow-500 hover:bg-yellow-600">RISK-ON</Badge>;
                    if (m < 1.0) return <Badge variant="secondary" className="text-[10px]">RISK-OFF</Badge>;
                    return <Badge variant="outline" className="text-[10px]">NORMAL</Badge>;
                  })()}
                </div>
                <p className="text-xs text-muted-foreground">Scales all per-symbol trade sizes globally — quick risk-on/off without editing each symbol</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {[{ label: '0.5×', value: 0.5 }, { label: '1×', value: 1.0 }, { label: '1.5×', value: 1.5 }, { label: '2×', value: 2.0 }, { label: '3×', value: 3.0 }].map((p) => (
                    <Button key={p.value} type="button" size="sm" variant={(config.global.tradeSizeMultiplier ?? 1.0) === p.value ? 'default' : 'outline'} className={`px-3 ${p.value > 2 && (config.global.tradeSizeMultiplier ?? 1) === p.value ? 'bg-red-600 hover:bg-red-700' : p.value > 1 && (config.global.tradeSizeMultiplier ?? 1) === p.value ? 'bg-yellow-600 hover:bg-yellow-700' : ''}`} onClick={() => handleGlobalChange('tradeSizeMultiplier', p.value)}>{p.label}</Button>
                  ))}
                  <NumberInput value={config.global.tradeSizeMultiplier ?? ''} onChange={(v) => handleGlobalChange('tradeSizeMultiplier', v)} defaultValue={1.0} className="w-20" min="0.1" max="5" step="0.1" />
                </div>
                {(config.global.tradeSizeMultiplier ?? 1.0) > 1.0 && (
                  <Alert className={(config.global.tradeSizeMultiplier ?? 1.0) > 2.0 ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20'}>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Trade sizes are {config.global.tradeSizeMultiplier}× normal. Losses scale proportionally.</AlertDescription>
                  </Alert>
                )}
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label htmlFor="riskPercent">Risk Percentage</Label>
                <div className="flex items-center gap-3">
                  <NumberInput id="riskPercent" value={config.global.riskPercent ?? ''} onChange={(v) => handleGlobalChange('riskPercent', v)} defaultValue={0} className="w-24" min="0.1" max="100" step="0.1" />
                  <span className="text-sm text-muted-foreground">% of account balance at risk</span>
                </div>
                <p className="text-xs text-amber-500">⚠️ Not yet implemented — reserved for future use</p>
              </div>
            </CardContent>
          </Card>

          {/* ── 4. EXIT STRATEGY ────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Crosshair className="h-4 w-4" />
                Exit Strategy
              </CardTitle>
              <CardDescription>Trailing take-profit and DCA spacing defaults</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Trailing Take Profit</Label>
                    <p className="text-xs text-muted-foreground">Trail from peak instead of fixed TP targets</p>
                  </div>
                  <Switch checked={config.global.enableTrailingTP === true} onCheckedChange={(checked) => handleGlobalChange('enableTrailingTP', checked)} />
                </div>
                {config.global.enableTrailingTP && (
                  <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-muted">
                    <div className="space-y-1.5">
                      <Label htmlFor="trailingTPActivation">Activation %</Label>
                      <NumberInput id="trailingTPActivation" value={config.global.trailingTPActivation ?? ''} onChange={(v) => handleGlobalChange('trailingTPActivation', v)} defaultValue={0.5} className="w-24" min="0.1" max="10" step="0.1" />
                      <p className="text-xs text-muted-foreground">Profit % before trailing starts</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="trailingTPCallback">Callback %</Label>
                      <NumberInput id="trailingTPCallback" value={config.global.trailingTPCallback ?? ''} onChange={(v) => handleGlobalChange('trailingTPCallback', v)} defaultValue={0.3} className="w-24" min="0.05" max="5" step="0.05" />
                      <p className="text-xs text-muted-foreground">Drop from peak to trigger close</p>
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label htmlFor="minEntrySpacingPercent" className="flex items-center gap-2">
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  Min DCA Entry Spacing %
                </Label>
                <div className="flex items-center gap-3">
                  <NumberInput id="minEntrySpacingPercent" value={config.global.minEntrySpacingPercent ?? ''} onChange={(v) => handleGlobalChange('minEntrySpacingPercent', v)} defaultValue={0.5} className="w-24" min="0" max="10" step="0.1" />
                  <span className="text-sm text-muted-foreground">Min price distance between DCA entries (0 = off)</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── 5. SIGNAL FILTERS ───────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4" />
                Signal Filters
              </CardTitle>
              <CardDescription>Control which liquidation signals actually trigger trades</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">Trade Quality Scoring</Label>
                    <p className="text-xs text-muted-foreground">Score trades 0–3 on spike, volume &amp; regime. 0 = skip, adjusts size 0.5×–1.5×</p>
                  </div>
                  <Switch checked={config.global.useTradeQualityScoring !== false} onCheckedChange={(checked) => handleGlobalChange('useTradeQualityScoring', checked)} />
                </div>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {config.global.useTradeQualityScoring !== false
                      ? <><strong>ACTIVE:</strong> Low-quality trades (0/3) are skipped. Position sizes scale 0.5×–1.5× with score.</>
                      : <><strong>PASSIVE:</strong> Scores are logged but nothing is blocked — good for observing before enabling.</>}
                  </AlertDescription>
                </Alert>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <TrendingUp className="h-3.5 w-3.5" />
                      60-Second Volume Threshold System
                    </Label>
                    <p className="text-xs text-muted-foreground">Accumulate liquidation volume over rolling windows before triggering</p>
                  </div>
                  <Switch checked={config.global.useThresholdSystem || false} onCheckedChange={(checked) => handleGlobalChange('useThresholdSystem', checked)} />
                </div>
                {config.global.useThresholdSystem && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">Trades only trigger when the rolling window fills to threshold. Configure time window &amp; cooldown per symbol in the Symbols tab.</AlertDescription>
                  </Alert>
                )}
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" />
                      FTA Exit Analysis
                    </Label>
                    <p className="text-xs text-muted-foreground">Monitor positions for early-exit signals — does NOT auto-close</p>
                  </div>
                  <Switch checked={config.global.useFTAExitAnalysis === true} onCheckedChange={(checked) => handleGlobalChange('useFTAExitAnalysis', checked)} />
                </div>
                {config.global.useFTAExitAnalysis && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">Logs signals every 5 min when trades exceed 3× average win duration or hit First Trouble Area prices. Shown in Signal Feed.</AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── 6. RISK CONTROLS ────────────────────────────────────── */}

          {/* Account Health Monitor */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Heart className="h-4 w-4" />
                Account Health Monitor
              </CardTitle>
              <CardDescription>Pause new entries when the account draws down too far. DCA into existing positions is never blocked.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="maxDrawdownPercent">Max Drawdown (%)</Label>
                  <NumberInput id="maxDrawdownPercent" value={config.global.accountHealth?.maxDrawdownPercent ?? ''} onChange={(v) => handleGlobalChange('accountHealth', { ...config.global.accountHealth, maxDrawdownPercent: typeof v === 'number' ? Math.max(0, v) : 25 })} defaultValue={25} className="w-full" min="0" max="100" step="0.5" />
                  <p className="text-xs text-muted-foreground">Pause when balance drops this % from session peak</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="resumeAtDrawdownPercent">Resume At Drawdown (%)</Label>
                  <NumberInput id="resumeAtDrawdownPercent" value={config.global.accountHealth?.resumeAtDrawdownPercent ?? ''} onChange={(v) => handleGlobalChange('accountHealth', { ...config.global.accountHealth, resumeAtDrawdownPercent: typeof v === 'number' ? Math.max(0, v) : 15 })} defaultValue={15} className="w-full" min="0" max="100" step="0.5" />
                  <p className="text-xs text-muted-foreground">Resume trading when recovered to this % drawdown</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="maxUnrealizedLossPercent">Max Unrealized Loss (%)</Label>
                  <NumberInput id="maxUnrealizedLossPercent" value={config.global.accountHealth?.maxUnrealizedLossPercent ?? ''} onChange={(v) => handleGlobalChange('accountHealth', { ...config.global.accountHealth, maxUnrealizedLossPercent: typeof v === 'number' ? Math.max(0, v) : 20 })} defaultValue={20} className="w-full" min="0" max="100" step="0.5" />
                  <p className="text-xs text-muted-foreground">Also pause when open positions lose this % of balance</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="checkIntervalSeconds">Check Interval (sec)</Label>
                  <NumberInput id="checkIntervalSeconds" value={config.global.accountHealth?.checkIntervalSeconds ?? ''} onChange={(v) => handleGlobalChange('accountHealth', { ...config.global.accountHealth, checkIntervalSeconds: typeof v === 'number' ? Math.max(5, v) : 60 })} defaultValue={60} className="w-full" min="5" max="300" step="5" />
                  <p className="text-xs text-muted-foreground">How often to check account health</p>
                </div>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label htmlFor="closeAllAtDrawdownPercent" className="flex items-center gap-1.5 text-red-500">
                  Emergency Close-All Drawdown (%)
                </Label>
                <div className="flex items-center gap-3">
                  <NumberInput id="closeAllAtDrawdownPercent" value={config.global.accountHealth?.closeAllAtDrawdownPercent ?? ''} onChange={(v) => handleGlobalChange('accountHealth', { ...config.global.accountHealth, closeAllAtDrawdownPercent: typeof v === 'number' ? Math.max(0, v) : 0 })} defaultValue={0} className="w-24" min="0" max="100" step="1" />
                  <span className="text-xs text-muted-foreground">Close ALL positions at this drawdown (0 = disabled)</span>
                </div>
                {(config.global.accountHealth?.closeAllAtDrawdownPercent || 0) > 0 && (
                  <p className="text-xs text-red-500">⚠️ Will close all positions — including profitable ones!</p>
                )}
              </div>

              <Separator />

              <div>
                <h4 className="text-sm font-medium mb-3">🛡️ DCA Guardrails <span className="text-xs text-muted-foreground font-normal">— hard limits on position growth</span></h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="maxPositionNotional">Max Position Notional ($)</Label>
                    <NumberInput id="maxPositionNotional" value={config.global.accountHealth?.maxPositionNotional ?? ''} onChange={(v) => handleGlobalChange('accountHealth', { ...config.global.accountHealth, maxPositionNotional: typeof v === 'number' ? Math.max(0, v) : 0 })} defaultValue={0} className="w-full" min="0" max="10000" step="5" />
                    <p className="text-xs text-muted-foreground">Stop DCA when notional hits this cap (0 = unlimited)</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="maxDCAEntries">Max DCA Entries</Label>
                    <NumberInput id="maxDCAEntries" value={config.global.accountHealth?.maxDCAEntries ?? ''} onChange={(v) => handleGlobalChange('accountHealth', { ...config.global.accountHealth, maxDCAEntries: typeof v === 'number' ? Math.max(0, Math.round(v)) : 0 })} defaultValue={0} className="w-full" min="0" max="100" step="1" />
                    <p className="text-xs text-muted-foreground">Max DCA entries per position (0 = unlimited)</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cascade Protection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4" />
                Cascade Protection
              </CardTitle>
              <CardDescription>Circuit breaker — detect market-wide liquidation cascades and pause/reduce trading</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Cascade Protection</Label>
                  <p className="text-xs text-muted-foreground">Monitor exchange-wide liquidation spikes</p>
                </div>
                <Switch checked={config.global.cascadeProtection?.enabled !== false} onCheckedChange={(checked) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, enabled: checked })} />
              </div>

              {config.global.cascadeProtection?.enabled !== false && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="cascadeMode">Mode</Label>
                    <Select value={config.global.cascadeProtection?.mode || 'LOG_ONLY'} onValueChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, mode: v as 'LOG_ONLY' | 'REDUCE' | 'BLOCK' })}>
                      <SelectTrigger id="cascadeMode"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOG_ONLY">Log Only — detect &amp; report, never block</SelectItem>
                        <SelectItem value="REDUCE">Reduce — shrink position sizes during cascades</SelectItem>
                        <SelectItem value="BLOCK">Block — pause all new entries during cascades</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {config.global.cascadeProtection?.mode === 'BLOCK' ? '⚠️ Prevents ALL new entries including high-edge contrarian signals' : config.global.cascadeProtection?.mode === 'REDUCE' ? 'Position sizes × reduction factor during cascade' : '✅ Recommended — logs only, trades continue normally'}
                    </p>
                  </div>

                  {config.global.cascadeProtection?.mode === 'REDUCE' && (
                    <div className="space-y-1.5">
                      <Label>Size Multiplier During Cascade</Label>
                      <div className="flex items-center gap-3">
                        <NumberInput value={config.global.cascadeProtection?.reducedPositionMultiplier ?? ''} onChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, reducedPositionMultiplier: typeof v === 'number' ? Math.min(1, Math.max(0.1, v)) : 0.5 })} defaultValue={0.5} className="w-24" min="0.1" max="1" step="0.1" />
                        <span className="text-xs text-muted-foreground">Sizes × {config.global.cascadeProtection?.reducedPositionMultiplier || 0.5} during cascade</span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Detection Window (min)</Label>
                      <NumberInput value={config.global.cascadeProtection?.rollingWindowMinutes ?? ''} onChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, rollingWindowMinutes: typeof v === 'number' ? Math.max(1, v) : 5 })} defaultValue={5} className="w-full" min="1" max="30" step="1" />
                      <p className="text-xs text-muted-foreground">Window to detect abnormal activity</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Baseline Window (min)</Label>
                      <NumberInput value={config.global.cascadeProtection?.baselineWindowMinutes ?? ''} onChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, baselineWindowMinutes: typeof v === 'number' ? Math.max(5, v) : 30 })} defaultValue={30} className="w-full" min="5" max="120" step="5" />
                      <p className="text-xs text-muted-foreground">Longer window for "normal" baseline</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Volume Spike Multiplier</Label>
                      <NumberInput value={config.global.cascadeProtection?.volumeMultiplierThreshold ?? ''} onChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, volumeMultiplierThreshold: typeof v === 'number' ? Math.max(1.5, v) : 3.0 })} defaultValue={3.0} className="w-full" min="1.5" max="10" step="0.5" />
                      <p className="text-xs text-muted-foreground">Trigger when volume Nx above baseline</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Min Symbols for Cascade</Label>
                      <NumberInput value={config.global.cascadeProtection?.minSymbolsForCascade ?? ''} onChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, minSymbolsForCascade: typeof v === 'number' ? Math.max(2, v) : 3 })} defaultValue={3} className="w-full" min="2" max="10" step="1" />
                      <p className="text-xs text-muted-foreground">Symbols liquidating simultaneously</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Directional Skew Threshold</Label>
                      <NumberInput value={config.global.cascadeProtection?.directionalSkewThreshold ?? ''} onChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, directionalSkewThreshold: typeof v === 'number' ? Math.min(1, Math.max(0.5, v)) : 0.8 })} defaultValue={0.8} className="w-full" min="0.5" max="1" step="0.05" />
                      <p className="text-xs text-muted-foreground">% same direction = trending (0.8 = 80%)</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cooldown (min)</Label>
                      <NumberInput value={config.global.cascadeProtection?.cooldownMinutes ?? ''} onChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, cooldownMinutes: typeof v === 'number' ? Math.max(1, v) : 10 })} defaultValue={10} className="w-full" min="1" max="60" step="1" />
                      <p className="text-xs text-muted-foreground">Pause duration after cascade detected</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Min Volume for Detection ($)</Label>
                    <div className="flex items-center gap-3">
                      <NumberInput value={config.global.cascadeProtection?.minVolumeForDetection ?? ''} onChange={(v) => handleGlobalChange('cascadeProtection', { ...config.global.cascadeProtection, minVolumeForDetection: typeof v === 'number' ? Math.max(0, v) : 50000 })} defaultValue={50000} className="w-32" min="0" max="500000" step="5000" />
                      <span className="text-xs text-muted-foreground">Min $ in window before detection activates</span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Adaptive Thresholds */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Adaptive Thresholds
              </CardTitle>
              <CardDescription>Automatically adjust per-symbol liq volume thresholds based on recent market activity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Adaptive Thresholds</Label>
                  <p className="text-xs text-muted-foreground">Adjusts thresholds within ±bounds around your configured values</p>
                </div>
                <Switch checked={config.global.adaptiveThresholds?.enabled === true} onCheckedChange={(checked) => handleGlobalChange('adaptiveThresholds', { ...config.global.adaptiveThresholds, enabled: checked })} />
              </div>

              {config.global.adaptiveThresholds?.enabled && (
                <div className="grid grid-cols-2 gap-4 border-t pt-4">
                  <div className="space-y-1.5">
                    <Label>Target Percentile</Label>
                    <NumberInput value={config.global.adaptiveThresholds?.targetPercentile ?? 80} onChange={(v) => handleGlobalChange('adaptiveThresholds', { ...config.global.adaptiveThresholds, targetPercentile: typeof v === 'number' ? Math.max(50, Math.min(99, v)) : 80 })} defaultValue={80} className="w-24" min="50" max="99" step="5" />
                    <p className="text-xs text-muted-foreground">P80 = top 20% of liquidations only</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Lookback Hours</Label>
                    <NumberInput value={config.global.adaptiveThresholds?.lookbackHours ?? 24} onChange={(v) => handleGlobalChange('adaptiveThresholds', { ...config.global.adaptiveThresholds, lookbackHours: typeof v === 'number' ? Math.max(1, Math.min(168, v)) : 24 })} defaultValue={24} className="w-24" min="1" max="168" step="1" />
                    <p className="text-xs text-muted-foreground">Hours of history to analyze</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Update Interval (min)</Label>
                    <NumberInput value={config.global.adaptiveThresholds?.updateIntervalMinutes ?? 15} onChange={(v) => handleGlobalChange('adaptiveThresholds', { ...config.global.adaptiveThresholds, updateIntervalMinutes: typeof v === 'number' ? Math.max(5, Math.min(60, v)) : 15 })} defaultValue={15} className="w-24" min="5" max="60" step="5" />
                    <p className="text-xs text-muted-foreground">Minutes between recalculations</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Smoothing Factor</Label>
                    <NumberInput value={config.global.adaptiveThresholds?.smoothingFactor ?? 0.3} onChange={(v) => handleGlobalChange('adaptiveThresholds', { ...config.global.adaptiveThresholds, smoothingFactor: typeof v === 'number' ? Math.max(0.1, Math.min(1.0, v)) : 0.3 })} defaultValue={0.3} className="w-24" min="0.1" max="1" step="0.1" />
                    <p className="text-xs text-muted-foreground">Lower = smoother changes (0.1–1.0)</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max Adjustment %</Label>
                    <NumberInput value={config.global.adaptiveThresholds?.maxAdjustmentPercent ?? 50} onChange={(v) => handleGlobalChange('adaptiveThresholds', { ...config.global.adaptiveThresholds, maxAdjustmentPercent: typeof v === 'number' ? Math.max(10, Math.min(200, v)) : 50 })} defaultValue={50} className="w-24" min="10" max="200" step="10" />
                    <p className="text-xs text-muted-foreground">Max % deviation from static config values</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Min Samples</Label>
                    <NumberInput value={config.global.adaptiveThresholds?.minSamples ?? 20} onChange={(v) => handleGlobalChange('adaptiveThresholds', { ...config.global.adaptiveThresholds, minSamples: typeof v === 'number' ? Math.max(1, v) : 20 })} defaultValue={20} className="w-24" min="1" step="5" />
                    <p className="text-xs text-muted-foreground">Minimum liquidations before adapting</p>
                  </div>
                  <Alert className="col-span-2 border-blue-500 bg-blue-50 dark:bg-blue-950/20">
                    <AlertDescription className="text-xs">
                      📊 Thresholds adapt within ±{config.global.adaptiveThresholds?.maxAdjustmentPercent ?? 50}% of per-symbol values · p{config.global.adaptiveThresholds?.targetPercentile ?? 80} over {config.global.adaptiveThresholds?.lookbackHours ?? 24}h · Falls back to static if &lt;{config.global.adaptiveThresholds?.minSamples ?? 20} samples
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── 7. SERVER & DATA ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4" />
                Server Settings
              </CardTitle>
              <CardDescription>Dashboard security and network configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="dashboardPassword">Dashboard Password</Label>
                  <Input id="dashboardPassword" type="password" value={config.global.server?.dashboardPassword || ''} onChange={(e) => handleGlobalChange('server', { ...config.global.server, dashboardPassword: e.target.value })} placeholder="Min 4 characters" minLength={4} />
                  {config.global.server?.dashboardPassword && config.global.server.dashboardPassword.length > 0 && config.global.server.dashboardPassword.length < 4 && (
                    <p className="text-xs text-destructive">Min 4 characters</p>
                  )}
                </div>
                <div />
                <div className="space-y-1.5">
                  <Label htmlFor="dashboardPort">Dashboard Port</Label>
                  <NumberInput id="dashboardPort" value={config.global.server?.dashboardPort ?? ''} onChange={(v) => handleGlobalChange('server', { ...config.global.server, dashboardPort: v })} defaultValue={3000} className="w-full" min="1024" max="65535" />
                  <p className="text-xs text-muted-foreground">Web UI port (default: 3000)</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="websocketPort">WebSocket Port</Label>
                  <NumberInput id="websocketPort" value={config.global.server?.websocketPort ?? ''} onChange={(v) => handleGlobalChange('server', { ...config.global.server, websocketPort: v })} defaultValue={8080} className="w-full" min="1024" max="65535" />
                  <p className="text-xs text-muted-foreground">Bot WS port (default: 8080)</p>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Switch id="useRemoteWebSocket" checked={config.global.server?.useRemoteWebSocket || false} onCheckedChange={(checked) => handleGlobalChange('server', { ...config.global.server, useRemoteWebSocket: checked })} />
                  <Label htmlFor="useRemoteWebSocket" className="cursor-pointer">Enable Remote WebSocket Access</Label>
                </div>
                <p className="text-xs text-muted-foreground">Allow dashboard to connect to the bot from other devices on your network</p>
                {config.global.server?.useRemoteWebSocket && (
                  <div className="space-y-1.5 pl-6">
                    <Label>WebSocket Host (Optional)</Label>
                    <Input type="text" value={config.global.server?.websocketHost || ''} onChange={(e) => handleGlobalChange('server', { ...config.global.server, websocketHost: e.target.value || null })} placeholder="Auto-detect from browser (recommended)" />
                    <p className="text-xs text-muted-foreground">Leave empty to auto-detect. Only set if you need a specific IP.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                Liquidation Database
              </CardTitle>
              <CardDescription>How long to retain historical liquidation data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Data Retention (Days)</Label>
                  <NumberInput value={config.global.liquidationDatabase?.retentionDays ?? ''} onChange={(v) => handleGlobalChange('liquidationDatabase', { ...config.global.liquidationDatabase, retentionDays: typeof v === 'number' ? Math.max(0, v) : 90 })} defaultValue={90} className="w-full" min="0" max="3650" step="1" />
                  <p className="text-xs text-muted-foreground">Days to keep data (0 = keep forever)</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Cleanup Interval (Hours)</Label>
                  <NumberInput value={config.global.liquidationDatabase?.cleanupIntervalHours ?? ''} onChange={(v) => handleGlobalChange('liquidationDatabase', { ...config.global.liquidationDatabase, cleanupIntervalHours: typeof v === 'number' ? Math.max(1, v) : 24 })} defaultValue={24} className="w-full" min="1" max="168" step="1" />
                  <p className="text-xs text-muted-foreground">How often to run cleanup (default: 24h)</p>
                </div>
              </div>
            </CardContent>
          </Card>

        </TabsContent>

        <TabsContent value="symbols" className="space-y-4" onFocus={fetchAvailableSymbols}>
          <Card>
            <CardHeader>
              <CardTitle>Symbol Configuration</CardTitle>
              <CardDescription>
                Configure trading parameters for each symbol
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  placeholder="Enter symbol manually (e.g., BTCUSDT)"
                  onKeyPress={(e) => e.key === 'Enter' && addSymbol()}
                />
                <Button onClick={() => addSymbol()} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Manual
                </Button>
                <Button
                  onClick={() => {
                    fetchAvailableSymbols();
                    setShowSymbolPicker(!showSymbolPicker);
                  }}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Settings2 className="h-4 w-4" />
                  Browse Symbols
                </Button>
              </div>

              {/* Symbol Picker */}
              {showSymbolPicker && (
                <Card className="border-2">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Available Symbols</CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSymbolPicker(false)}
                      >
                        ✕
                      </Button>
                    </div>
                    <Input
                      type="text"
                      value={symbolSearch}
                      onChange={(e) => setSymbolSearch(e.target.value.toUpperCase())}
                      placeholder="Search symbols..."
                      className="mt-2"
                    />
                  </CardHeader>
                  <CardContent className="max-h-96 overflow-y-auto">
                    {loadingSymbols ? (
                      <div className="text-center py-4 text-muted-foreground">
                        Loading available symbols...
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {availableSymbols
                          .filter(s =>
                            !config.symbols[s.symbol] && // Not already added
                            (!symbolSearch || s.symbol.includes(symbolSearch))
                          )
                          .slice(0, 50) // Show max 50 results
                          .map((symbolInfo) => (
                            <div
                              key={symbolInfo.symbol}
                              className="flex items-center justify-between p-2 rounded hover:bg-accent cursor-pointer"
                              onClick={() => addSymbol(symbolInfo.symbol)}
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-medium">{symbolInfo.symbol}</span>
                              </div>
                              <Button size="sm" variant="ghost">
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        {symbolSearch && availableSymbols.filter(s =>
                          !config.symbols[s.symbol] && s.symbol.includes(symbolSearch)
                        ).length === 0 && (
                          <div className="text-center py-4 text-muted-foreground">
                            No matching symbols found
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {Object.keys(config.symbols).length > 0 && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {Object.keys(config.symbols).map((symbol) => (
                      <Badge
                        key={symbol}
                        variant={selectedSymbol === symbol ? "default" : "outline"}
                        className="cursor-pointer py-1.5 px-3"
                        onClick={() => setSelectedSymbol(symbol)}
                      >
                        {symbol}
                      </Badge>
                    ))}
                  </div>

                  {selectedSymbol && config.symbols[selectedSymbol] && (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">{selectedSymbol} Settings</CardTitle>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => removeSymbol(selectedSymbol)}
                            className="flex items-center gap-1"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Long Volume Threshold (USDT)</Label>
                          <NumberInput
                            value={config.symbols[selectedSymbol].longVolumeThresholdUSDT ?? config.symbols[selectedSymbol].volumeThresholdUSDT ?? ''}
                            onChange={(value) => handleSymbolChange(selectedSymbol, 'longVolumeThresholdUSDT', value)}
                            defaultValue={0}
                            min="0"
                          />
                          <p className="text-xs text-muted-foreground">
                            Min liquidation volume for longs (buy on sell liquidations)
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Short Volume Threshold (USDT)</Label>
                          <NumberInput
                            value={config.symbols[selectedSymbol].shortVolumeThresholdUSDT ?? config.symbols[selectedSymbol].volumeThresholdUSDT ?? ''}
                            onChange={(value) => handleSymbolChange(selectedSymbol, 'shortVolumeThresholdUSDT', value)}
                            defaultValue={0}
                            min="0"
                          />
                          <p className="text-xs text-muted-foreground">
                            Min liquidation volume for shorts (sell on buy liquidations)
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Leverage</Label>
                          <NumberInput
                            value={config.symbols[selectedSymbol].leverage ?? ''}
                            onChange={(value) => handleSymbolChange(selectedSymbol, 'leverage', value)}
                            defaultValue={1}
                            min="1"
                            max="125"
                          />
                          {(() => {
                            const lev = config.symbols[selectedSymbol].leverage ?? 1;
                            if (lev >= 50) return (
                              <p className="text-xs text-red-500 font-medium">⚠️ Very high leverage ({lev}×) — small price moves may trigger liquidation. Ensure tight SL.</p>
                            );
                            if (lev >= 20) return (
                              <p className="text-xs text-amber-500">⚠️ High leverage ({lev}×) — consider a SL ≤ {(100/lev * 0.8).toFixed(1)}% to stay safe.</p>
                            );
                            return (
                              <p className="text-xs text-muted-foreground">
                                Trading leverage (1-125×). Liquidation ~{(100/lev).toFixed(1)}% adverse move.
                              </p>
                            );
                          })()}
                        </div>

                        {/* Trade Size Configuration */}
                        <div className="col-span-2 space-y-4">
                          <div className="space-y-0.5">
                            <Label className="text-base">Trade Size Configuration</Label>
                            <p className="text-sm text-muted-foreground">
                              Configure how trade sizes are calculated
                            </p>
                          </div>

                          {/* Position Sizing Mode */}
                          <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                            <Label htmlFor={`positionSizingMode-${selectedSymbol}`} className="font-semibold">
                              Position Sizing Mode
                            </Label>
                            <Select
                              value={config.symbols[selectedSymbol].positionSizingMode || 'FIXED'}
                              onValueChange={(value: 'FIXED' | 'PERCENTAGE') => {
                                handleSymbolChange(selectedSymbol, 'positionSizingMode', value);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select sizing mode" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="FIXED">Fixed USDT (Static)</SelectItem>
                                <SelectItem value="PERCENTAGE">Percentage of Balance (Dynamic)</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              {config.symbols[selectedSymbol].positionSizingMode === 'PERCENTAGE' 
                                ? '✨ Trade sizes auto-update every 5 minutes based on your balance'
                                : 'Trade sizes remain constant until manually changed'}
                            </p>

                            {/* Percentage mode settings */}
                            {config.symbols[selectedSymbol].positionSizingMode === 'PERCENTAGE' && (
                              <div className="space-y-4 pt-2 mt-2 border-t">
                                <div className="space-y-2">
                                  <Label htmlFor={`percentageOfBalance-${selectedSymbol}`}>
                                    Percentage of Balance
                                  </Label>
                                  <NumberInput
                                    id={`percentageOfBalance-${selectedSymbol}`}
                                    value={config.symbols[selectedSymbol].percentageOfBalance ?? ''}
                                    onChange={(value) => handleSymbolChange(selectedSymbol, 'percentageOfBalance', value)}
                                    defaultValue={1.0}
                                    min="0.1"
                                    max="100"
                                    step="0.1"
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    Trade size = Balance × {config.symbols[selectedSymbol].percentageOfBalance || 1.0}%
                                  </p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <Label htmlFor={`minPositionSize-${selectedSymbol}`}>
                                      Min Size (USDT)
                                    </Label>
                                    <NumberInput
                                      id={`minPositionSize-${selectedSymbol}`}
                                      value={config.symbols[selectedSymbol].minPositionSize ?? ''}
                                      onChange={(value) => handleSymbolChange(selectedSymbol, 'minPositionSize', value)}
                                      defaultValue={5}
                                      min="0.01"
                                      step="0.01"
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor={`maxPositionSize-${selectedSymbol}`}>
                                      Max Size (USDT)
                                    </Label>
                                    <NumberInput
                                      id={`maxPositionSize-${selectedSymbol}`}
                                      value={config.symbols[selectedSymbol].maxPositionSize ?? ''}
                                      onChange={(value) => handleSymbolChange(selectedSymbol, 'maxPositionSize', value)}
                                      defaultValue={1000}
                                      min="0.01"
                                      step="0.01"
                                    />
                                  </div>
                                </div>

                                {/* Risk Warning */}
                                {(config.symbols[selectedSymbol].percentageOfBalance || 0) > 0.5 && (
                                  <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                      <strong>⚠️ HIGH RISK WARNING</strong>
                                      <p className="mt-1 text-xs">
                                        Above 0.5% is risky! Remember: positions pyramid (scale in), so total exposure grows much larger than a single trade.
                                      </p>
                                      {(config.symbols[selectedSymbol].percentageOfBalance || 0) > 2 && (
                                        <p className="mt-2 text-xs font-semibold">
                                          ⚠️ EXTREME RISK: Above 2% can rapidly deplete your account!
                                        </p>
                                      )}
                                    </AlertDescription>
                                  </Alert>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Use different sizes toggle */}
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label>Use Different Sizes for Long and Short</Label>
                              <p className="text-sm text-muted-foreground">
                                Set separate trade sizes for long vs short positions
                              </p>
                            </div>
                            <Switch
                              checked={useSeparateTradeSizes[selectedSymbol] || false}
                              onCheckedChange={(checked) => {
                                setUseSeparateTradeSizes({
                                  ...useSeparateTradeSizes,
                                  [selectedSymbol]: checked,
                                });
                                if (checked) {
                                  // Initialize separate values with current tradeSize when toggling on
                                  const currentTradeSize = config.symbols[selectedSymbol].tradeSize;
                                  const existingLongSize = config.symbols[selectedSymbol].longTradeSize;
                                  const existingShortSize = config.symbols[selectedSymbol].shortTradeSize;

                                  // Use existing values if they exist, otherwise use tradeSize
                                  const longSize = existingLongSize !== undefined ? existingLongSize : currentTradeSize;
                                  const shortSize = existingShortSize !== undefined ? existingShortSize : currentTradeSize;

                                  handleSymbolChange(selectedSymbol, 'longTradeSize', longSize);
                                  handleSymbolChange(selectedSymbol, 'shortTradeSize', shortSize);
                                  setLongTradeSizeInput(longSize.toString());
                                  setShortTradeSizeInput(shortSize.toString());
                                } else {
                                  // Remove separate values when toggling off
                                  const { longTradeSize: _longTradeSize, shortTradeSize: _shortTradeSize, ...restConfig } = config.symbols[selectedSymbol];
                                  setConfig({
                                    ...config,
                                    symbols: {
                                      ...config.symbols,
                                      [selectedSymbol]: restConfig,
                                    },
                                  });
                                  // Reset input fields to tradeSize
                                  const currentTradeSize = config.symbols[selectedSymbol].tradeSize;
                                  setLongTradeSizeInput(currentTradeSize.toString());
                                  setShortTradeSizeInput(currentTradeSize.toString());
                                }
                              }}
                            />
                          </div>

                          {!useSeparateTradeSizes[selectedSymbol] ? (
                            <div className="space-y-2">
                              <Label>Trade Size (USDT)</Label>
                              <NumberInput
                                value={config.symbols[selectedSymbol].tradeSize ?? ''}
                                onChange={(value) => handleSymbolChange(selectedSymbol, 'tradeSize', value)}
                                defaultValue={0}
                                min="0"
                                step="0.01"
                              />
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">
                                  Position size in USDT (used for both long and short)
                                </p>
                                {symbolDetails && !loadingDetails && getMinimumMargin() && (
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant={config.symbols[selectedSymbol].tradeSize >= getMinimumMargin()! ? "default" : "destructive"}
                                        className="text-xs"
                                      >
                                        Recommended: ${getMinimumMargin()!.toFixed(2)} USDT
                                      </Badge>
                                      {config.symbols[selectedSymbol].tradeSize < getMinimumMargin()! && (
                                        <Badge variant="destructive" className="text-xs">
                                          Too low - may be rejected!
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      Exchange min: ${getRawMinimum()!.toFixed(2)} @ {config.symbols[selectedSymbol].leverage}x (30% buffer added)
                                    </p>
                                  </div>
                                )}
                                {loadingDetails && (
                                  <p className="text-xs text-muted-foreground">
                                    Loading minimum requirements...
                                  </p>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                  Long Trade Size (USDT)
                                  <Badge variant="outline" className="text-xs">BUY</Badge>
                                </Label>
                                <NumberInput
                                  value={longTradeSizeInput === '' ? '' : parseFloat(longTradeSizeInput)}
                                  onChange={(value) => {
                                    setLongTradeSizeInput(value === '' ? '' : value.toString());
                                    if (value !== '') {
                                      handleSymbolChange(selectedSymbol, 'longTradeSize', value);
                                    }
                                  }}
                                  defaultValue={0}
                                  onBlur={(e) => {
                                    // On blur, if empty, reset to tradeSize
                                    if (e.target.value === '') {
                                      const fallbackValue = config.symbols[selectedSymbol].tradeSize;
                                      setLongTradeSizeInput(fallbackValue.toString());
                                      handleSymbolChange(selectedSymbol, 'longTradeSize', fallbackValue);
                                    }
                                  }}
                                  min="0"
                                  step="0.01"
                                />
                                <div className="space-y-1">
                                  <p className="text-xs text-muted-foreground">
                                    Margin used for long positions (buy on sell liquidations)
                                  </p>
                                  {symbolDetails && !loadingDetails && getMinimumMargin() && (
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-2">
                                        <Badge
                                          variant={(config.symbols[selectedSymbol].longTradeSize || config.symbols[selectedSymbol].tradeSize) >= getMinimumMargin()! ? "default" : "destructive"}
                                          className="text-xs"
                                        >
                                          Recommended: ${getMinimumMargin()!.toFixed(2)}
                                        </Badge>
                                        {(config.symbols[selectedSymbol].longTradeSize || config.symbols[selectedSymbol].tradeSize) < getMinimumMargin()! && (
                                          <Badge variant="destructive" className="text-xs">
                                            Too low!
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        Min: ${getRawMinimum()!.toFixed(2)} + 30% buffer
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                  Short Trade Size (USDT)
                                  <Badge variant="outline" className="text-xs">SELL</Badge>
                                </Label>
                                <NumberInput
                                  value={shortTradeSizeInput === '' ? '' : parseFloat(shortTradeSizeInput)}
                                  onChange={(value) => {
                                    setShortTradeSizeInput(value === '' ? '' : value.toString());
                                    if (value !== '') {
                                      handleSymbolChange(selectedSymbol, 'shortTradeSize', value);
                                    }
                                  }}
                                  defaultValue={0}
                                  onBlur={(e) => {
                                    // On blur, if empty, reset to tradeSize
                                    if (e.target.value === '') {
                                      const fallbackValue = config.symbols[selectedSymbol].tradeSize;
                                      setShortTradeSizeInput(fallbackValue.toString());
                                      handleSymbolChange(selectedSymbol, 'shortTradeSize', fallbackValue);
                                    }
                                  }}
                                  min="0"
                                  step="0.01"
                                />
                                <div className="space-y-1">
                                  <p className="text-xs text-muted-foreground">
                                    Margin used for short positions (sell on buy liquidations)
                                  </p>
                                  {symbolDetails && !loadingDetails && getMinimumMargin() && (
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-2">
                                        <Badge
                                          variant={(config.symbols[selectedSymbol].shortTradeSize || config.symbols[selectedSymbol].tradeSize) >= getMinimumMargin()! ? "default" : "destructive"}
                                          className="text-xs"
                                        >
                                          Recommended: ${getMinimumMargin()!.toFixed(2)}
                                        </Badge>
                                        {(config.symbols[selectedSymbol].shortTradeSize || config.symbols[selectedSymbol].tradeSize) < getMinimumMargin()! && (
                                          <Badge variant="destructive" className="text-xs">
                                            Too low!
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        Min: ${getRawMinimum()!.toFixed(2)} + 30% buffer
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label>Max Position Margin (USDT)</Label>
                          <NumberInput
                            value={config.symbols[selectedSymbol].maxPositionMarginUSDT ?? ''}
                            onChange={(value) => handleSymbolChange(selectedSymbol, 'maxPositionMarginUSDT', value)}
                            defaultValue={0}
                            min="0"
                          />
                          <p className="text-xs text-muted-foreground">
                            Max total margin exposure for this symbol
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Stop Loss (%)</Label>
                          <NumberInput
                            value={config.symbols[selectedSymbol].slPercent ?? ''}
                            onChange={(value) => handleSymbolChange(selectedSymbol, 'slPercent', value)}
                            defaultValue={0}
                            min="0.1"
                            step="0.1"
                          />
                          {(() => {
                            const sl = config.symbols[selectedSymbol].slPercent ?? 0;
                            const lev = config.symbols[selectedSymbol].leverage ?? 1;
                            const liquidAt = 100 / lev;
                            if (sl <= 0) return <p className="text-xs text-amber-500">⚠️ No stop loss configured — unlimited downside risk.</p>;
                            if (sl >= liquidAt * 0.8) return <p className="text-xs text-red-500 font-medium">⛔ SL ({sl}%) is ≥80% of liquidation distance ({liquidAt.toFixed(1)}%) — may not trigger in time.</p>;
                            if (sl * lev > 30) return <p className="text-xs text-amber-500">⚠️ At {lev}×, a {sl}% SL means ~{(sl * lev).toFixed(0)}% margin loss per trade.</p>;
                            return <p className="text-xs text-muted-foreground">Stop loss percentage (liquidates at ~{liquidAt.toFixed(1)}% at {lev}× leverage)</p>;
                          })()}
                        </div>

                        <div className="space-y-2">
                          <Label>Take Profit (%)</Label>
                          <NumberInput
                            value={config.symbols[selectedSymbol].tpPercent ?? ''}
                            onChange={(value) => handleSymbolChange(selectedSymbol, 'tpPercent', value)}
                            defaultValue={0}
                            min="0.1"
                            step="0.1"
                          />
                          <p className="text-xs text-muted-foreground">
                            Take profit percentage
                          </p>
                        </div>

                        {/* Per-Symbol Trailing Take Profit */}
                        <div className="col-span-2">
                          <Separator className="my-4" />
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label className="flex items-center gap-2">
                                  <Crosshair className="h-4 w-4 text-purple-500" />
                                  Trailing Take Profit
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                  Trail profit from peak instead of fixed TP — overrides global setting for this symbol
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {config.symbols[selectedSymbol].enableTrailingTP === undefined && config.global.enableTrailingTP && (
                                  <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-400">Global</Badge>
                                )}
                                <Switch
                                  checked={config.symbols[selectedSymbol].enableTrailingTP ?? config.global.enableTrailingTP ?? false}
                                  onCheckedChange={(checked) =>
                                    handleSymbolChange(selectedSymbol, 'enableTrailingTP', checked)
                                  }
                                />
                              </div>
                            </div>
                            {(config.symbols[selectedSymbol].enableTrailingTP ?? config.global.enableTrailingTP) && (
                              <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-purple-400/30">
                                <div className="space-y-2">
                                  <Label>Activation %</Label>
                                  <div className="flex items-center space-x-2">
                                    <NumberInput
                                      value={config.symbols[selectedSymbol].trailingTPActivation ?? ''}
                                      onChange={(value) => handleSymbolChange(selectedSymbol, 'trailingTPActivation', value)}
                                      defaultValue={config.global.trailingTPActivation ?? 0.5}
                                      className="w-24"
                                      min="0.05"
                                      max="20"
                                      step="0.1"
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      Profit % to start trailing
                                      {!config.symbols[selectedSymbol].trailingTPActivation && (
                                        <span className="text-purple-400"> (global: {config.global.trailingTPActivation ?? 0.5}%)</span>
                                      )}
                                    </span>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <Label>Callback %</Label>
                                  <div className="flex items-center space-x-2">
                                    <NumberInput
                                      value={config.symbols[selectedSymbol].trailingTPCallback ?? ''}
                                      onChange={(value) => handleSymbolChange(selectedSymbol, 'trailingTPCallback', value)}
                                      defaultValue={config.global.trailingTPCallback ?? 0.3}
                                      className="w-24"
                                      min="0.01"
                                      max="10"
                                      step="0.05"
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      Drop from peak to close
                                      {!config.symbols[selectedSymbol].trailingTPCallback && (
                                        <span className="text-purple-400"> (global: {config.global.trailingTPCallback ?? 0.3}%)</span>
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Order Type Settings */}
                        <div className="col-span-2">
                          <Separator className="my-4" />
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>Order Type</Label>
                              <Select
                                value={config.symbols[selectedSymbol].orderType || 'LIMIT'}
                                onValueChange={(value) =>
                                  handleSymbolChange(selectedSymbol, 'orderType', value)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="LIMIT">LIMIT Orders (Better fills)</SelectItem>
                                  <SelectItem value="MARKET">MARKET Orders (Instant fills)</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                Default order type for opening positions
                              </p>
                            </div>

                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label>Force Market Entry</Label>
                                <p className="text-sm text-muted-foreground">
                                  Always use MARKET orders for opening positions (overrides order type above)
                                </p>
                              </div>
                              <Switch
                                checked={config.symbols[selectedSymbol].forceMarketEntry || false}
                                onCheckedChange={(checked) =>
                                  handleSymbolChange(selectedSymbol, 'forceMarketEntry', checked)
                                }
                              />
                            </div>

                            {config.symbols[selectedSymbol].forceMarketEntry && (
                              <Alert>
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription className="text-xs">
                                  <strong>Market Entry Forced:</strong> All opening orders will use MARKET type for instant fills,
                                  regardless of the order type setting above. This ensures faster entry but may have higher slippage.
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                        </div>

                        {/* VWAP Protection Settings */}
                        <div className="col-span-2">
                          <Separator className="my-4" />
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label className="flex items-center gap-2">
                                  <BarChart3 className="h-4 w-4" />
                                  VWAP Protection
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                  Block entries against VWAP trend
                                </p>
                              </div>
                              <Switch
                                checked={config.symbols[selectedSymbol].vwapProtection || false}
                                onCheckedChange={(checked) =>
                                  handleSymbolChange(selectedSymbol, 'vwapProtection', checked)
                                }
                              />
                            </div>

                            {config.symbols[selectedSymbol].vwapProtection && (
                              <div className="grid grid-cols-2 gap-4 pt-2">
                                <div className="space-y-2">
                                  <Label>VWAP Timeframe</Label>
                                  <Select
                                    value={config.symbols[selectedSymbol].vwapTimeframe || '1m'}
                                    onValueChange={(value) =>
                                      handleSymbolChange(selectedSymbol, 'vwapTimeframe', value)
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1m">1 minute</SelectItem>
                                      <SelectItem value="5m">5 minutes</SelectItem>
                                      <SelectItem value="15m">15 minutes</SelectItem>
                                      <SelectItem value="30m">30 minutes</SelectItem>
                                      <SelectItem value="1h">1 hour</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <p className="text-xs text-muted-foreground">
                                    Candle timeframe for VWAP calculation
                                  </p>
                                </div>

                                <div className="space-y-2">
                                  <Label>Lookback Period</Label>
                                  <NumberInput
                                    value={config.symbols[selectedSymbol].vwapLookback ?? ''}
                                    onChange={(value) => {
                                      if (value === '') {
                                        // Remove the field if empty - will use default from config.default.json
                                        const { vwapLookback: _vwapLookback, ...rest } = config.symbols[selectedSymbol];
                                        setConfig({
                                          ...config,
                                          symbols: {
                                            ...config.symbols,
                                            [selectedSymbol]: rest,
                                          },
                                        });
                                      } else {
                                        handleSymbolChange(selectedSymbol, 'vwapLookback', value);
                                      }
                                    }}
                                    min="10"
                                    max="500"
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    Number of candles for VWAP (10-500)
                                  </p>
                                </div>
                              </div>
                            )}

                            {config.symbols[selectedSymbol].vwapProtection && (
                              <Alert>
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription className="text-xs">
                                  <strong>VWAP Protection Active:</strong> Long positions will only open when price is below VWAP.
                                  Short positions will only open when price is above VWAP. This helps avoid entering against the trend.
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                        </div>

                        {/* Threshold System Settings - Always show toggle, details only when enabled */}
                        <div className="col-span-2">
                          <Separator className="my-4" />
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label className="flex items-center gap-2">
                                  <TrendingUp className="h-4 w-4" />
                                  Enable Threshold System for {selectedSymbol}
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                  Use 60-second cumulative volume thresholds
                                </p>
                                {!config.global.useThresholdSystem && (
                                  <p className="text-xs text-amber-600 dark:text-amber-400">
                                    ⚠️ Enable &quot;60-Second Volume Threshold System&quot; in Global Settings first
                                  </p>
                                )}
                              </div>
                              <Switch
                                checked={config.symbols[selectedSymbol].useThreshold || false}
                                onCheckedChange={(checked) =>
                                  handleSymbolChange(selectedSymbol, 'useThreshold', checked)
                                }
                                disabled={!config.global.useThresholdSystem}
                              />
                            </div>

                            {config.symbols[selectedSymbol].useThreshold && config.global.useThresholdSystem && (
                                <div className="space-y-4 pt-2">
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                      <Label>Time Window (seconds)</Label>
                                      <NumberInput
                                        value={config.symbols[selectedSymbol].thresholdTimeWindow !== undefined 
                                          ? config.symbols[selectedSymbol].thresholdTimeWindow / 1000 
                                          : 60}
                                        onChange={(value) => {
                                          if (value === '' || value === 60) {
                                            // Remove the field if empty or set to default - will use default from config.default.json
                                            const { thresholdTimeWindow: _thresholdTimeWindow, ...rest } = config.symbols[selectedSymbol];
                                            setConfig({
                                              ...config,
                                              symbols: {
                                                ...config.symbols,
                                                [selectedSymbol]: rest,
                                              },
                                            });
                                          } else {
                                            handleSymbolChange(selectedSymbol, 'thresholdTimeWindow', value * 1000);
                                          }
                                        }}
                                        defaultValue={60}
                                        min="10"
                                        max="300"
                                        step="10"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Window for accumulating volume (default: 60s)
                                      </p>
                                    </div>

                                    <div className="space-y-2">
                                      <Label>Cooldown Period (seconds)</Label>
                                      <NumberInput
                                        value={config.symbols[selectedSymbol].thresholdCooldown !== undefined 
                                          ? config.symbols[selectedSymbol].thresholdCooldown / 1000 
                                          : 30}
                                        onChange={(value) => {
                                          if (value === '' || value === 30) {
                                            // Remove the field if empty or set to default - will use default from config.default.json
                                            const { thresholdCooldown: _thresholdCooldown, ...rest } = config.symbols[selectedSymbol];
                                            setConfig({
                                              ...config,
                                              symbols: {
                                                ...config.symbols,
                                                [selectedSymbol]: rest,
                                              },
                                            });
                                          } else {
                                            handleSymbolChange(selectedSymbol, 'thresholdCooldown', value * 1000);
                                          }
                                        }}
                                        defaultValue={30}
                                        min="10"
                                        max="300"
                                        step="10"
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Cooldown between triggers (default: 30s)
                                      </p>
                                    </div>
                                  </div>

                                  <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                      With threshold enabled, trades will only trigger when cumulative liquidation volume
                                      within the time window meets the Long/Short Volume Thresholds configured above.
                                    </AlertDescription>
                                  </Alert>
                                </div>
                              )}
                            </div>
                          </div>

                        {/* Multi-Tranche Position Management */}
                        <div className="col-span-2">
                          <Separator className="my-4" />
                          <TrancheSettingsSection
                            symbol={selectedSymbol}
                            config={config.symbols[selectedSymbol]}
                            onChange={(field, value) => handleSymbolChange(selectedSymbol, field, value)}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              {Object.keys(config.symbols).length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Settings2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No symbols configured yet</p>
                  <p className="text-sm">Add a symbol above to get started</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={handleSave} size="lg" className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          Save Configuration
        </Button>
      </div>
    </div>
  );
}