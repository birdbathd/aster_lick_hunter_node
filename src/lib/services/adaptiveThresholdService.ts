/**
 * Adaptive Threshold Service
 * 
 * Dynamically adjusts liquidation volume thresholds based on recent market activity.
 * Instead of static thresholds that lag behind changing market conditions, this service
 * computes a target percentile of recent liquidation volumes and adjusts thresholds to
 * always trigger on the top N% of events.
 * 
 * HOW IT WORKS:
 * 1. Every `updateIntervalMinutes`, queries the liquidation DB for recent data (lookbackHours)
 * 2. Computes volume percentiles per symbol (separately for long/short liquidation sides)
 * 3. Sets the effective threshold to the configured `targetPercentile` (e.g. p85 = top 15% of events)
 * 4. Clamps thresholds within [minThreshold, maxThreshold] bounds per symbol
 * 5. Smooths changes using EMA to avoid whiplash on bursty data
 * 6. Hunter reads getEffectiveThreshold(symbol, side) instead of static config value
 * 
 * CONFIGURATION (in global config):
 * - enabled: boolean (default: false)
 * - targetPercentile: 50-99 (default: 80) — target top N% of liquidations to trigger on
 * - lookbackHours: 1-168 (default: 24) — hours of data to analyze
 * - updateIntervalMinutes: 5-60 (default: 15) — how often to recalculate
 * - smoothingFactor: 0.1-1.0 (default: 0.3) — EMA weight for new values (1.0 = no smoothing)
 * - minThreshold: number (default: 1000) — absolute floor for any threshold
 * - maxThreshold: number (default: 100000) — absolute ceiling for any threshold
 * - maxAdjustmentPercent: 10-200 (default: 50) — max % change from config value in either direction
 * 
 * SAFETY:
 * - Thresholds can only move within ±maxAdjustmentPercent of the static config value
 * - If insufficient data (< minSamples), falls back to static config value
 * - If the service is disabled, static config values are used transparently
 * - All adjustments are logged for visibility
 */

import { EventEmitter } from 'events';
import { Config } from '../types';
import { db } from '../db/database';
import { logWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';

export interface AdaptiveThresholdConfig {
  enabled?: boolean;
  targetPercentile?: number;      // 50-99, default 80
  lookbackHours?: number;         // 1-168, default 24
  updateIntervalMinutes?: number; // 5-60, default 15
  smoothingFactor?: number;       // 0.1-1.0, default 0.3
  minThreshold?: number;          // Absolute floor, default 1000
  maxThreshold?: number;          // Absolute ceiling, default 100000
  maxAdjustmentPercent?: number;  // Max % deviation from config, default 50
  minSamples?: number;            // Min liquidations needed, default 20
}

interface SymbolThresholdState {
  symbol: string;
  // Current effective thresholds (after smoothing + clamping)
  effectiveLongThreshold: number;
  effectiveShortThreshold: number;
  // Raw percentile values (before smoothing)
  rawLongPercentile: number;
  rawShortPercentile: number;
  // Config base values (for clamping reference)
  configLongThreshold: number;
  configShortThreshold: number;
  // Sample counts
  longSamples: number;
  shortSamples: number;
  // Last update timestamp
  lastUpdated: number;
  // Whether we're using adaptive or falling back to static
  isAdaptive: boolean;
}

export interface AdaptiveThresholdStatus {
  enabled: boolean;
  lastUpdate: number;
  nextUpdate: number;
  symbols: Record<string, SymbolThresholdState>;
  config: Required<AdaptiveThresholdConfig>;
}

class AdaptiveThresholdService extends EventEmitter {
  private config: Config | null = null;
  private adaptiveConfig: Required<AdaptiveThresholdConfig>;
  private symbolStates: Map<string, SymbolThresholdState> = new Map();
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdateTime: number = 0;
  private nextUpdateTime: number = 0;
  private isUpdating: boolean = false;

  constructor() {
    super();
    this.adaptiveConfig = this.getDefaultConfig();
  }

  private getDefaultConfig(): Required<AdaptiveThresholdConfig> {
    return {
      enabled: false,
      targetPercentile: 80,
      lookbackHours: 24,
      updateIntervalMinutes: 15,
      smoothingFactor: 0.3,
      minThreshold: 1000,
      maxThreshold: 100000,
      maxAdjustmentPercent: 50,
      minSamples: 20,
    };
  }

  /**
   * Initialize or update with new config
   */
  updateConfig(config: Config): void {
    this.config = config;
    
    const ac = config.global.adaptiveThresholds;
    const prev = this.adaptiveConfig;
    
    this.adaptiveConfig = {
      enabled: ac?.enabled ?? false,
      targetPercentile: Math.min(99, Math.max(50, ac?.targetPercentile ?? 80)),
      lookbackHours: Math.min(168, Math.max(1, ac?.lookbackHours ?? 24)),
      updateIntervalMinutes: Math.min(60, Math.max(5, ac?.updateIntervalMinutes ?? 15)),
      smoothingFactor: Math.min(1.0, Math.max(0.1, ac?.smoothingFactor ?? 0.3)),
      minThreshold: ac?.minThreshold ?? 1000,
      maxThreshold: ac?.maxThreshold ?? 100000,
      maxAdjustmentPercent: Math.min(200, Math.max(10, ac?.maxAdjustmentPercent ?? 50)),
      minSamples: ac?.minSamples ?? 20,
    };

    // Initialize symbol states from config
    for (const [symbol, symConfig] of Object.entries(config.symbols)) {
      const longThresh = symConfig.longVolumeThresholdUSDT ?? symConfig.volumeThresholdUSDT ?? 10000;
      const shortThresh = symConfig.shortVolumeThresholdUSDT ?? symConfig.volumeThresholdUSDT ?? 10000;
      
      const existing = this.symbolStates.get(symbol);
      if (existing) {
        // Update config values but keep adaptive state
        existing.configLongThreshold = longThresh;
        existing.configShortThreshold = shortThresh;
      } else {
        this.symbolStates.set(symbol, {
          symbol,
          effectiveLongThreshold: longThresh,
          effectiveShortThreshold: shortThresh,
          rawLongPercentile: longThresh,
          rawShortPercentile: shortThresh,
          configLongThreshold: longThresh,
          configShortThreshold: shortThresh,
          longSamples: 0,
          shortSamples: 0,
          lastUpdated: 0,
          isAdaptive: false,
        });
      }
    }

    // Remove symbols no longer in config
    for (const symbol of this.symbolStates.keys()) {
      if (!config.symbols[symbol]) {
        this.symbolStates.delete(symbol);
      }
    }

    // Start or stop the update timer
    if (this.adaptiveConfig.enabled) {
      this.startUpdateTimer();
      if (prev.enabled !== this.adaptiveConfig.enabled) {
        logWithTimestamp(`[AdaptiveThresholds] ENABLED — target p${this.adaptiveConfig.targetPercentile}, lookback ${this.adaptiveConfig.lookbackHours}h, update every ${this.adaptiveConfig.updateIntervalMinutes}min`);
      }
    } else {
      this.stopUpdateTimer();
      // Reset all to static values
      for (const [_symbol, state] of this.symbolStates) {
        state.effectiveLongThreshold = state.configLongThreshold;
        state.effectiveShortThreshold = state.configShortThreshold;
        state.isAdaptive = false;
      }
    }
  }

  /**
   * Get the effective threshold for a symbol and direction.
   * This is what Hunter should call instead of reading static config.
   */
  getEffectiveThreshold(symbol: string, side: 'long' | 'short'): number {
    const state = this.symbolStates.get(symbol);
    if (!state) return 0;
    
    if (!this.adaptiveConfig.enabled) {
      return side === 'long' ? state.configLongThreshold : state.configShortThreshold;
    }

    return side === 'long' ? state.effectiveLongThreshold : state.effectiveShortThreshold;
  }

  /**
   * Get full status for API/UI consumption
   */
  getStatus(): AdaptiveThresholdStatus {
    const symbols: Record<string, SymbolThresholdState> = {};
    for (const [symbol, state] of this.symbolStates) {
      symbols[symbol] = { ...state };
    }
    return {
      enabled: this.adaptiveConfig.enabled,
      lastUpdate: this.lastUpdateTime,
      nextUpdate: this.nextUpdateTime,
      symbols,
      config: { ...this.adaptiveConfig },
    };
  }

  private startUpdateTimer(): void {
    if (this.updateTimer) return;
    
    const intervalMs = this.adaptiveConfig.updateIntervalMinutes * 60 * 1000;
    
    // Do first update immediately
    this.performUpdate();
    
    this.updateTimer = setInterval(() => {
      this.performUpdate();
    }, intervalMs);

    this.nextUpdateTime = Date.now() + intervalMs;
  }

  private stopUpdateTimer(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Core update logic: query DB, compute percentiles, smooth, emit
   */
  private async performUpdate(): Promise<void> {
    if (this.isUpdating || !this.config) return;
    this.isUpdating = true;

    try {
      const lookbackMs = this.adaptiveConfig.lookbackHours * 60 * 60 * 1000;
      const cutoffTime = Date.now() - lookbackMs;
      const symbols = Object.keys(this.config.symbols);
      
      if (symbols.length === 0) return;

      // Query all liquidation volumes per symbol and direction in one go
      const placeholders = symbols.map(() => '?').join(',');
      
      const rows = await db.all<{
        symbol: string;
        side: string;
        volume_usdt: number;
      }>(
        `SELECT symbol, side, volume_usdt 
         FROM liquidations 
         WHERE symbol IN (${placeholders}) 
           AND event_time >= ?
         ORDER BY symbol, side, volume_usdt`,
        [...symbols, cutoffTime]
      );

      // Group by symbol and direction
      const grouped: Record<string, { long: number[]; short: number[] }> = {};
      for (const symbol of symbols) {
        grouped[symbol] = { long: [], short: [] };
      }
      
      for (const row of rows) {
        if (!grouped[row.symbol]) continue;
        // SELL liquidation = longs getting liquidated = long entry opportunity
        // BUY liquidation = shorts getting liquidated = short entry opportunity
        if (row.side === 'SELL') {
          grouped[row.symbol].long.push(row.volume_usdt);
        } else {
          grouped[row.symbol].short.push(row.volume_usdt);
        }
      }

      const changes: string[] = [];

      // Compute percentiles and update states
      for (const symbol of symbols) {
        const state = this.symbolStates.get(symbol);
        if (!state) continue;

        const data = grouped[symbol];
        
        // Long side
        const longPercentile = this.computePercentile(
          data.long, 
          this.adaptiveConfig.targetPercentile
        );
        state.longSamples = data.long.length;
        
        // Short side
        const shortPercentile = this.computePercentile(
          data.short,
          this.adaptiveConfig.targetPercentile
        );
        state.shortSamples = data.short.length;

        // Check if we have enough samples
        const hasEnoughLong = data.long.length >= this.adaptiveConfig.minSamples;
        const hasEnoughShort = data.short.length >= this.adaptiveConfig.minSamples;

        // Store raw percentiles
        state.rawLongPercentile = longPercentile;
        state.rawShortPercentile = shortPercentile;

        // Apply adaptive thresholds with smoothing and clamping
        const prevLong = state.effectiveLongThreshold;
        const prevShort = state.effectiveShortThreshold;

        if (hasEnoughLong && longPercentile > 0) {
          const clamped = this.clampThreshold(longPercentile, state.configLongThreshold);
          state.effectiveLongThreshold = this.smooth(prevLong, clamped);
          state.isAdaptive = true;
        } else {
          state.effectiveLongThreshold = state.configLongThreshold;
        }

        if (hasEnoughShort && shortPercentile > 0) {
          const clamped = this.clampThreshold(shortPercentile, state.configShortThreshold);
          state.effectiveShortThreshold = this.smooth(prevShort, clamped);
          state.isAdaptive = true;
        } else {
          state.effectiveShortThreshold = state.configShortThreshold;
        }

        // Round to whole numbers
        state.effectiveLongThreshold = Math.round(state.effectiveLongThreshold);
        state.effectiveShortThreshold = Math.round(state.effectiveShortThreshold);
        state.lastUpdated = Date.now();

        // Log significant changes
        const longChange = prevLong > 0 ? ((state.effectiveLongThreshold - prevLong) / prevLong * 100) : 0;
        const shortChange = prevShort > 0 ? ((state.effectiveShortThreshold - prevShort) / prevShort * 100) : 0;

        if (Math.abs(longChange) > 2 || Math.abs(shortChange) > 2) {
          changes.push(
            `${symbol}: L $${prevLong.toLocaleString()}→$${state.effectiveLongThreshold.toLocaleString()} (${longChange > 0 ? '+' : ''}${longChange.toFixed(1)}%), ` +
            `S $${prevShort.toLocaleString()}→$${state.effectiveShortThreshold.toLocaleString()} (${shortChange > 0 ? '+' : ''}${shortChange.toFixed(1)}%) ` +
            `[samples: L=${data.long.length}, S=${data.short.length}]`
          );
        }
      }

      this.lastUpdateTime = Date.now();
      this.nextUpdateTime = Date.now() + this.adaptiveConfig.updateIntervalMinutes * 60 * 1000;

      if (changes.length > 0) {
        logWithTimestamp(`[AdaptiveThresholds] Updated thresholds (${this.adaptiveConfig.lookbackHours}h window, p${this.adaptiveConfig.targetPercentile}):`);
        for (const change of changes) {
          logWithTimestamp(`  ${change}`);
        }
      }

      // Emit update event for UI
      this.emit('thresholds_updated', this.getStatus());

    } catch (error) {
      logWarnWithTimestamp(`[AdaptiveThresholds] Update failed: ${error}`);
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Compute the value at the given percentile from a sorted array of numbers.
   * The data comes pre-sorted from the SQL query.
   */
  private computePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
  }

  /**
   * Clamp a threshold within the allowed range around the config base value.
   */
  private clampThreshold(value: number, configBase: number): number {
    const maxDeviation = configBase * (this.adaptiveConfig.maxAdjustmentPercent / 100);
    const lower = Math.max(this.adaptiveConfig.minThreshold, configBase - maxDeviation);
    const upper = Math.min(this.adaptiveConfig.maxThreshold, configBase + maxDeviation);
    return Math.max(lower, Math.min(upper, value));
  }

  /**
   * Exponential moving average smoothing to prevent threshold whiplash.
   * smoothingFactor = 1.0 means no smoothing (use new value directly)
   * smoothingFactor = 0.1 means very slow adaptation (10% new, 90% old)
   */
  private smooth(previous: number, newValue: number): number {
    const alpha = this.adaptiveConfig.smoothingFactor;
    return alpha * newValue + (1 - alpha) * previous;
  }

  /**
   * Force an immediate recalculation (e.g. when config changes)
   */
  async forceUpdate(): Promise<void> {
    await this.performUpdate();
  }

  /**
   * Clean up timers
   */
  destroy(): void {
    this.stopUpdateTimer();
    this.removeAllListeners();
  }
}

// Singleton instance
export const adaptiveThresholdService = new AdaptiveThresholdService();
