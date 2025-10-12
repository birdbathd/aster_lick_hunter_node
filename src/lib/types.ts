export interface SymbolConfig {
  // Volume thresholds
  volumeThresholdUSDT?: number;       // Legacy field for backward compatibility
  longVolumeThresholdUSDT?: number;   // Min liquidation volume to trigger long trades (buy on sell liquidations)
  shortVolumeThresholdUSDT?: number;  // Min liquidation volume to trigger short trades (sell on buy liquidations)

  // Position sizing
  tradeSize: number;                  // Base quantity for trades (adjusted by leverage)
  longTradeSize?: number;              // Optional: Specific margin in USDT for long positions
  shortTradeSize?: number;             // Optional: Specific margin in USDT for short positions
  maxPositionMarginUSDT?: number;     // Max margin exposure for this symbol (position size × leverage × price)

  // Risk parameters
  leverage: number;            // Leverage (1-125)
  tpPercent: number;           // Take profit as percentage (e.g., 5 for 5%)
  slPercent: number;           // Stop loss as percentage (e.g., 2 for 2%)

  // Limit order specific settings
  priceOffsetBps?: number;     // Price offset in basis points from best bid/ask (default: 1)
  usePostOnly?: boolean;       // Use post-only orders to guarantee maker fees (default: false)
  maxSlippageBps?: number;     // Maximum acceptable slippage in basis points (default: 50)
  orderType?: 'LIMIT' | 'MARKET'; // Order type preference (default: 'LIMIT')
  forceMarketEntry?: boolean;  // Force market orders for opening positions (default: false)

  // VWAP protection settings
  vwapProtection?: boolean;    // Enable VWAP-based entry filtering (default: false)
  vwapTimeframe?: string;      // Timeframe for VWAP calculation: 1m, 5m, 15m, 30m, 1h (default: '1m')
  vwapLookback?: number;       // Number of candles to use for VWAP calculation (default: 100)

  // Threshold system settings (60-second rolling window)
  useThreshold?: boolean;       // Enable threshold-based triggering for this symbol (default: false)
  thresholdTimeWindow?: number; // Time window in ms for volume accumulation (default: 60000)
  thresholdCooldown?: number;   // Cooldown period in ms between triggers (default: 30000)

  // Tranche management settings
  enableTrancheManagement?: boolean;           // Enable multi-tranche system (default: false)
  trancheIsolationThreshold?: number;          // % loss to isolate tranche (default: 5)
  maxTranches?: number;                        // Max active tranches (default: 3)
  maxIsolatedTranches?: number;                // Max isolated tranches before blocking (default: 2)
  trancheAllocation?: 'equal' | 'dynamic';     // How to size new tranches (default: 'equal')
  trancheStrategy?: TrancheStrategy;           // Tranche behavior settings

  // Advanced tranche settings
  allowTrancheWhileIsolated?: boolean;         // Allow new tranches when some are isolated (default: true)
  isolatedTrancheMinMargin?: number;           // Min margin to keep in isolated tranches (USDT)
  trancheAutoCloseIsolated?: boolean;          // Auto-close isolated tranches at breakeven (default: false)
}

export interface ApiCredentials {
  apiKey: string;          // API Key from Aster Finance exchange
  secretKey: string;       // Secret Key from Aster Finance exchange
}

export interface ServerConfig {
  dashboardPassword?: string;  // Optional password to protect the dashboard
  dashboardPort?: number;       // Port for the web UI (default: 3000)
  websocketPort?: number;       // Port for the WebSocket server (default: 8080)
  useRemoteWebSocket?: boolean; // Enable remote WebSocket access (default: false)
  websocketHost?: string | null; // Optional WebSocket host override (null for auto-detect)
}

export interface RateLimitConfig {
  maxRequestWeight?: number;  // Max request weight per minute (default: 2400)
  maxOrderCount?: number;      // Max orders per minute (default: 1200)
  reservePercent?: number;     // Percentage to reserve for critical operations (default: 30)
  enableBatching?: boolean;    // Enable order batching (default: true)
  queueTimeout?: number;       // Timeout for queued requests in ms (default: 30000)
  enableDeduplication?: boolean; // Enable request deduplication (default: true)
  deduplicationWindowMs?: number; // Time window for request deduplication in ms (default: 1000)
  parallelProcessing?: boolean; // Enable parallel processing of requests (default: false)
  maxConcurrentRequests?: number; // Maximum number of concurrent requests (default: 3)
}

export interface GlobalConfig {
  riskPercent: number;     // Max risk per trade as % of account balance
  paperMode: boolean;      // If true, simulate trades without executing
  positionMode?: 'ONE_WAY' | 'HEDGE'; // Position mode preference (optional)
  maxOpenPositions?: number; // Max number of open positions (hedged pairs count as one)
  useThresholdSystem?: boolean; // Enable 60-second rolling volume threshold system (default: false)
  server?: ServerConfig;    // Optional server configuration
  rateLimit?: RateLimitConfig; // Rate limit configuration
}

export interface Config {
  api: ApiCredentials;
  symbols: Record<string, SymbolConfig>; // key: symbol like "BTCUSDT"
  global: GlobalConfig;
  version?: string; // Optional version field for config schema versioning
}

// API response types
export interface LiquidationEvent {
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  quantity: number;
  price: number;
  averagePrice: number;
  orderStatus: string;
  orderLastFilledQuantity: number;
  orderFilledAccumulatedQuantity: number;
  orderTradeTime: number;
  eventTime: number;

  // Keep for backward compatibility
  qty: number;
  time: number;
}

export interface Order {
  symbol: string;
  orderId: string;
  clientOrderId?: string;
  side: 'BUY' | 'SELL';
  type: string;
  quantity: number;
  price: number;
  status: string;
  updateTime: number;
}

export interface Position {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  liquidationPrice?: number;
  leverage: number;
}

// Other types as needed
export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface MarkPrice {
  symbol: string;
  markPrice: string;
  indexPrice: string;
}

// Tranche Management Types

export interface TrancheStrategy {
  // Closing priority when SL/TP hits
  closingStrategy: 'FIFO' | 'LIFO' | 'WORST_FIRST' | 'BEST_FIRST';

  // SL/TP calculation method
  slTpStrategy: 'NEWEST' | 'OLDEST' | 'BEST_ENTRY' | 'AVERAGE';

  // Isolation behavior
  isolationAction: 'HOLD' | 'REDUCE_LEVERAGE' | 'PARTIAL_CLOSE';
}

export interface Tranche {
  // Identity
  id: string;                      // UUID v4
  symbol: string;                  // e.g., "BTCUSDT"
  side: 'LONG' | 'SHORT';          // Position direction
  positionSide: 'LONG' | 'SHORT' | 'BOTH'; // Exchange position side

  // Entry details
  entryPrice: number;              // Average entry price for this tranche
  quantity: number;                // Position size in base asset (BTC, ETH, etc.)
  marginUsed: number;              // USDT margin allocated
  leverage: number;                // Leverage used (1-125)
  entryTime: number;               // Unix timestamp
  entryOrderId?: string;           // Exchange order ID that created this tranche

  // Exit details
  exitPrice?: number;              // Average exit price (when closed)
  exitTime?: number;               // Unix timestamp
  exitOrderId?: string;            // Exchange order ID that closed this tranche

  // P&L tracking
  unrealizedPnl: number;           // Current unrealized P&L (updated real-time)
  realizedPnl: number;             // Final realized P&L (on close)

  // Risk management (inherited from SymbolConfig at entry time)
  tpPercent: number;               // Take profit %
  slPercent: number;               // Stop loss %
  tpPrice: number;                 // Calculated TP price
  slPrice: number;                 // Calculated SL price

  // Status tracking
  status: 'active' | 'closed' | 'liquidated';
  isolated: boolean;               // True if underwater > isolation threshold
  isolationTime?: number;          // When it became isolated
  isolationPrice?: number;         // Price when isolated

  // Metadata
  notes?: string;                  // Optional notes (e.g., "manual entry", "recovered from restart")
}

export interface TrancheGroup {
  symbol: string;
  side: 'LONG' | 'SHORT';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';

  // Tranche tracking
  tranches: Tranche[];             // All tranches (active + closed)
  activeTranches: Tranche[];       // Currently open tranches
  isolatedTranches: Tranche[];     // Underwater tranches

  // Aggregated metrics (sum of active tranches)
  totalQuantity: number;           // Total position size
  totalMarginUsed: number;         // Total margin allocated
  weightedAvgEntry: number;        // Weighted average entry price
  totalUnrealizedPnl: number;      // Sum of all unrealized P&L

  // Exchange sync
  lastExchangeQuantity: number;    // Last known exchange position size
  lastExchangeSync: number;        // Last sync timestamp
  syncStatus: 'synced' | 'drift' | 'conflict'; // Sync health

  // Order management
  activeSlOrderId?: number;        // Current exchange SL order
  activeTpOrderId?: number;        // Current exchange TP order
  targetSlPrice?: number;          // Target SL price
  targetTpPrice?: number;          // Target TP price
}

export interface TrancheEvent {
  id: number;                      // Auto-increment ID
  trancheId: string;               // Foreign key to tranche
  eventType: 'created' | 'isolated' | 'closed' | 'liquidated' | 'updated';
  eventTime: number;               // Unix timestamp

  // Event details
  price?: number;                  // Price at event time
  quantity?: number;               // Quantity affected
  pnl?: number;                    // P&L at event (if applicable)

  // Context
  trigger?: string;                // What triggered the event
  metadata?: string;               // JSON with additional details
}
