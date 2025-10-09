import { buildSignedQuery } from './auth';
import { ApiCredentials } from '../types';
import { getRateLimitedAxios } from './requestInterceptor';

const BASE_URL = 'https://fapi.asterdex.com';

// Simple cache to prevent duplicate API calls
const incomeCache = new Map<string, { data: IncomeRecord[]; timestamp: number }>();

// Different cache TTL based on range - shorter ranges need fresher data
const getCacheTTL = (range: string): number => {
  switch (range) {
    case '24h':
      return 1 * 60 * 1000; // 1 minute for 24h
    case '7d':
      return 2 * 60 * 1000; // 2 minutes for 7d
    case '30d':
      return 5 * 60 * 1000; // 5 minutes for 30d
    default:
      return 10 * 60 * 1000; // 10 minutes for longer ranges
  }
};

// Function to invalidate cache when new trading activity occurs
export function invalidateIncomeCache(): void {
  console.log('[Income Cache] Invalidating all cache due to new trading activity');
  incomeCache.clear();
}

// Temporary function to clear cache for debugging
export function clearIncomeCache(): void {
  console.log('[Income Cache] Clearing all cache for debugging');
  incomeCache.clear();
}

export type IncomeType =
  | 'TRANSFER'
  | 'WELCOME_BONUS'
  | 'REALIZED_PNL'
  | 'FUNDING_FEE'
  | 'COMMISSION'
  | 'INSURANCE_CLEAR'
  | 'MARKET_MERCHANT_RETURN_REWARD';

export interface IncomeRecord {
  symbol: string;
  incomeType: IncomeType;
  income: string;
  asset: string;
  info: string;
  time: number;
  tranId: string;
  tradeId: string;
}

export interface IncomeHistoryParams {
  symbol?: string;
  incomeType?: IncomeType;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export async function getIncomeHistory(
  credentials: ApiCredentials,
  params: IncomeHistoryParams = {}
): Promise<IncomeRecord[]> {
  const query = buildSignedQuery(params, credentials);

  const axios = getRateLimitedAxios();
  const response = await axios.get<IncomeRecord[]>(
    `${BASE_URL}/fapi/v1/income?${query}`,
    {
      headers: {
        'X-MBX-APIKEY': credentials.apiKey,
      },
    }
  );

  return response.data;
}

export interface DailyPnL {
  date: string;
  realizedPnl: number;
  commission: number;
  fundingFee: number;
  insuranceClear: number;
  marketMerchantReward: number;
  netPnl: number;
  tradeCount: number;
}

export function aggregateDailyPnL(records: IncomeRecord[]): DailyPnL[] {
  const dailyMap = new Map<string, DailyPnL>();
  const _todayString = new Date().toISOString().split('T')[0];

  // Track unique trade IDs per day to avoid double-counting
  const dailyTradeIds = new Map<string, Set<string>>();

  records.forEach((record, _index) => {
    const date = new Date(record.time).toISOString().split('T')[0];
    const amount = parseFloat(record.income);

    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        realizedPnl: 0,
        commission: 0,
        fundingFee: 0,
        insuranceClear: 0,
        marketMerchantReward: 0,
        netPnl: 0,
        tradeCount: 0,
      });
      dailyTradeIds.set(date, new Set<string>());
    }

    const daily = dailyMap.get(date)!;
    const tradeIds = dailyTradeIds.get(date)!;

    switch (record.incomeType) {
      case 'REALIZED_PNL':
        daily.realizedPnl += amount;
        // Only count unique trades using tradeId
        if (record.tradeId && !tradeIds.has(record.tradeId)) {
          tradeIds.add(record.tradeId);
          daily.tradeCount++;
        }
        break;
      case 'COMMISSION':
        daily.commission += amount;
        break;
      case 'FUNDING_FEE':
        daily.fundingFee += amount;
        break;
      case 'INSURANCE_CLEAR':
        daily.insuranceClear += amount;
        break;
      case 'MARKET_MERCHANT_RETURN_REWARD':
        daily.marketMerchantReward += amount;
        break;
    }
  });

  // Calculate net PnL for each day including all income types
  dailyMap.forEach((daily, _date) => {
    daily.netPnl = daily.realizedPnl + daily.commission + daily.fundingFee +
                   daily.insuranceClear + daily.marketMerchantReward;
  });

  const result = Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return result;
}

export interface PerformanceMetrics {
  totalPnl: number;
  totalRealizedPnl: number;
  totalCommission: number;
  totalFundingFee: number;
  totalInsuranceClear: number;
  totalMarketMerchantReward: number;
  winRate: number;
  profitableDays: number;
  lossDays: number;
  bestDay: DailyPnL | null;
  worstDay: DailyPnL | null;
  avgDailyPnl: number;
  maxDrawdown: number;
  profitFactor: number;
  sharpeRatio: number;
}

export function calculatePerformanceMetrics(dailyPnL: DailyPnL[]): PerformanceMetrics {
  if (dailyPnL.length === 0) {
    return {
      totalPnl: 0,
      totalRealizedPnl: 0,
      totalCommission: 0,
      totalFundingFee: 0,
      totalInsuranceClear: 0,
      totalMarketMerchantReward: 0,
      winRate: 0,
      profitableDays: 0,
      lossDays: 0,
      bestDay: null,
      worstDay: null,
      avgDailyPnl: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      sharpeRatio: 0,
    };
  }

  let totalPnl = 0;
  let totalRealizedPnl = 0;
  let totalCommission = 0;
  let totalFundingFee = 0;
  let totalInsuranceClear = 0;
  let totalMarketMerchantReward = 0;
  let profitableDays = 0;
  let lossDays = 0;
  let bestDay = dailyPnL[0];
  let worstDay = dailyPnL[0];
  let totalProfit = 0;
  let totalLoss = 0;

  // Calculate cumulative metrics
  let cumulativePnl = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];

  dailyPnL.forEach(day => {
    totalPnl += day.netPnl;
    totalRealizedPnl += day.realizedPnl;
    totalCommission += day.commission;
    totalFundingFee += day.fundingFee;
    totalInsuranceClear += day.insuranceClear || 0;
    totalMarketMerchantReward += day.marketMerchantReward || 0;

    if (day.netPnl > 0) {
      profitableDays++;
      totalProfit += day.netPnl;
    } else if (day.netPnl < 0) {
      lossDays++;
      totalLoss += Math.abs(day.netPnl);
    }

    if (day.netPnl > bestDay.netPnl) {
      bestDay = day;
    }
    if (day.netPnl < worstDay.netPnl) {
      worstDay = day;
    }

    // Track drawdown
    cumulativePnl += day.netPnl;
    if (cumulativePnl > peak) {
      peak = cumulativePnl;
    }
    const drawdown = peak - cumulativePnl;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    // Store absolute PnL for now (will be used for basic volatility)
    dailyReturns.push(day.netPnl);
  });

  const totalDays = dailyPnL.length;
  const winRate = totalDays > 0 ? (profitableDays / totalDays) * 100 : 0;
  const avgDailyPnl = totalDays > 0 ? totalPnl / totalDays : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  // Calculate Sharpe Ratio (simplified - assuming risk-free rate of 0)
  // Note: Ideally this should use percentage returns relative to starting capital,
  // but without knowing the starting capital, we use absolute PnL returns
  // This gives a proxy for risk-adjusted returns
  let sharpeRatio = 0;
  if (dailyReturns.length > 1) {
    const mean = avgDailyPnl;
    const variance = dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      // Annualized Sharpe ratio (assuming 365 trading days in crypto)
      sharpeRatio = (mean / stdDev) * Math.sqrt(365);
    }
  }

  return {
    totalPnl,
    totalRealizedPnl,
    totalCommission,
    totalFundingFee,
    totalInsuranceClear,
    totalMarketMerchantReward,
    winRate,
    profitableDays,
    lossDays,
    bestDay,
    worstDay,
    avgDailyPnl,
    maxDrawdown,
    profitFactor,
    sharpeRatio,
  };
}

// Helper function to get income for a specific time range with pagination to fetch all records
export async function getTimeRangeIncome(
  credentials: ApiCredentials,
  range: '24h' | '7d' | '30d' | '90d' | '1y' | 'all'
): Promise<IncomeRecord[]> {
  // Check cache first with range-specific TTL
  const cacheKey = `${range}_${credentials.apiKey.slice(-8)}`;
  const cached = incomeCache.get(cacheKey);
  const cacheTTL = getCacheTTL(range);
  const cacheAge = cached ? Date.now() - cached.timestamp : 0;

  if (cached && cacheAge < cacheTTL) {
    console.log(`[Income API] Using cached data for ${range} (age: ${Math.floor(cacheAge / 1000)}s)`);
    return cached.data;
  }

  const now = Date.now();
  let startTime: number | undefined;

  switch (range) {
    case '24h':
      startTime = now - 24 * 60 * 60 * 1000;
      break;
    case '7d':
      startTime = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case '30d':
      startTime = now - 30 * 24 * 60 * 60 * 1000;
      break;
    case '90d':
      startTime = now - 90 * 24 * 60 * 60 * 1000;
      break;
    case '1y':
      startTime = now - 365 * 24 * 60 * 60 * 1000;
      break;
    case 'all':
      // For 'all', limit to last 2 years to prevent excessive data
      startTime = now - 2 * 365 * 24 * 60 * 60 * 1000;
      break;
  }

  try {
    const allRecords: IncomeRecord[] = [];
    let currentEndTime = now;
    let batchCount = 0;
    const maxBatches = 10; // Safety limit to prevent infinite loops

    console.log(`[Income API] Fetching income history for ${range}...`);

    // Pagination: Keep fetching until we get less than 1000 records or hit the startTime
    while (batchCount < maxBatches) {
      batchCount++;

      const params: IncomeHistoryParams = {
        startTime: startTime,
        endTime: currentEndTime,
        limit: 1000,
      };

      const batch = await getIncomeHistory(credentials, params);

      if (batch.length === 0) {
        console.log(`[Income API] Batch ${batchCount}: No more records found`);
        break;
      }

      console.log(`[Income API] Batch ${batchCount}: Fetched ${batch.length} records`);

      // Add to our collection
      allRecords.push(...batch);

      // If we got less than 1000 records, we've reached the end
      if (batch.length < 1000) {
        console.log(`[Income API] Completed: Got ${batch.length} records (less than limit). All data fetched.`);
        break;
      }

      // Update endTime to the oldest record's time minus 1ms for next batch
      // This ensures we don't re-fetch the same records
      const oldestRecord = batch[batch.length - 1];
      currentEndTime = oldestRecord.time - 1;

      // Safety check: if we've gone past our startTime, stop
      if (startTime && currentEndTime < startTime) {
        console.log(`[Income API] Reached startTime boundary. Stopping pagination.`);
        break;
      }
    }

    if (batchCount >= maxBatches) {
      console.warn(`[Income API] Warning: Hit maximum batch limit (${maxBatches}). There may be more data available.`);
    }

    // Remove duplicates based on tranId (transaction ID is unique)
    const uniqueRecords = Array.from(
      new Map(allRecords.map(record => [record.tranId, record])).values()
    );

    // Sort by time ascending (oldest first)
    uniqueRecords.sort((a, b) => a.time - b.time);

    console.log(`[Income API] Total unique records fetched: ${uniqueRecords.length} (from ${batchCount} batches)`);

    // Cache the result
    incomeCache.set(cacheKey, { data: uniqueRecords, timestamp: now });

    // Clean up old cache entries
    for (const [key, value] of incomeCache.entries()) {
      const keyRange = key.split('_')[0];
      const keyTTL = getCacheTTL(keyRange);
      if (now - value.timestamp > keyTTL) {
        incomeCache.delete(key);
      }
    }

    return uniqueRecords;
  } catch (error) {
    console.error(`[Income API] Error fetching data for ${range}:`, error);
    return [];
  }
}