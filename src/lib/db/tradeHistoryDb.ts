/**
 * Trade History Database
 * 
 * Persists all order fills and trade events to local SQLite for:
 * - Deep history in Recent Orders (beyond exchange API limits)
 * - Trade markers on TradingView chart going back months
 * - Performance analytics without hitting exchange rate limits
 * - Offline access to trade history
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DB_PATH = path.join(dataDir, 'trade_history.db');

export interface TradeHistoryRecord {
  id?: number;
  symbol: string;
  orderId: number;
  clientOrderId?: string;
  side: string;         // BUY or SELL
  positionSide: string; // BOTH, LONG, SHORT
  orderType: string;    // MARKET, LIMIT, STOP_MARKET, TAKE_PROFIT_MARKET, etc.
  origType?: string;    // Original order type (for SL/TP orders)
  status: string;       // FILLED, PARTIALLY_FILLED, CANCELED, etc.
  price: string;        // Order price (may be "0" for MARKET orders)
  avgPrice: string;     // Actual fill price
  origQty: string;      // Original quantity
  executedQty: string;  // Filled quantity
  lastFilledQty?: string;
  lastFilledPrice?: string;
  quoteQty?: string;    // Quote asset volume (notional)
  commission?: string;
  commissionAsset?: string;
  realizedPnl: string;  // Realized profit/loss for this fill
  reduceOnly: boolean;
  closePosition: boolean;
  isMaker: boolean;
  tradeId?: number;
  orderTime: number;    // When the order was placed
  updateTime: number;   // When this status update happened
  // Source of the record
  source: 'websocket' | 'api_backfill';
}

export interface TradeHistoryFilter {
  symbol?: string;
  side?: string;
  status?: string | string[];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
  orderType?: string | string[];
  reduceOnly?: boolean;
}

class TradeHistoryDb {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trade_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        order_id INTEGER NOT NULL,
        client_order_id TEXT,
        side TEXT NOT NULL,
        position_side TEXT DEFAULT 'BOTH',
        order_type TEXT NOT NULL,
        orig_type TEXT,
        status TEXT NOT NULL,
        price TEXT DEFAULT '0',
        avg_price TEXT DEFAULT '0',
        orig_qty TEXT DEFAULT '0',
        executed_qty TEXT DEFAULT '0',
        last_filled_qty TEXT,
        last_filled_price TEXT,
        quote_qty TEXT,
        commission TEXT DEFAULT '0',
        commission_asset TEXT,
        realized_pnl TEXT DEFAULT '0',
        reduce_only INTEGER DEFAULT 0,
        close_position INTEGER DEFAULT 0,
        is_maker INTEGER DEFAULT 0,
        trade_id INTEGER,
        order_time INTEGER NOT NULL,
        update_time INTEGER NOT NULL,
        source TEXT DEFAULT 'websocket',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(symbol, order_id)
      );

      CREATE INDEX IF NOT EXISTS idx_trade_history_symbol ON trade_history(symbol);
      CREATE INDEX IF NOT EXISTS idx_trade_history_update_time ON trade_history(update_time);
      CREATE INDEX IF NOT EXISTS idx_trade_history_status ON trade_history(status);
      CREATE INDEX IF NOT EXISTS idx_trade_history_order_id ON trade_history(order_id);
      CREATE INDEX IF NOT EXISTS idx_trade_history_symbol_time ON trade_history(symbol, update_time);

      -- Income history table for PnL, commissions, funding fees
      CREATE TABLE IF NOT EXISTS income_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tran_id INTEGER UNIQUE,
        symbol TEXT,
        income_type TEXT NOT NULL,
        income TEXT NOT NULL,
        asset TEXT DEFAULT 'USDT',
        info TEXT,
        trade_id TEXT,
        time INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_income_time ON income_history(time);
      CREATE INDEX IF NOT EXISTS idx_income_type ON income_history(income_type);
      CREATE INDEX IF NOT EXISTS idx_income_symbol ON income_history(symbol);

      -- Metadata table for tracking backfill progress
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      -- Funding rate snapshots for correlation analysis
      CREATE TABLE IF NOT EXISTS funding_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        funding_rate TEXT NOT NULL,
        mark_price TEXT,
        next_funding_time INTEGER,
        snapshot_time INTEGER NOT NULL,
        source TEXT DEFAULT 'poll',
        UNIQUE(symbol, snapshot_time)
      );

      CREATE INDEX IF NOT EXISTS idx_funding_symbol ON funding_rates(symbol);
      CREATE INDEX IF NOT EXISTS idx_funding_time ON funding_rates(snapshot_time);
      CREATE INDEX IF NOT EXISTS idx_funding_symbol_time ON funding_rates(symbol, snapshot_time);
    `);

    // Add funding_rate_at_entry column to trade_history if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE trade_history ADD COLUMN funding_rate_at_entry TEXT`);
    } catch (_) {
      // Column already exists — ignore
    }

    // Migration: Fix unique constraint from (symbol, order_id, update_time) to (symbol, order_id)
    // The old constraint allowed duplicates when update_time differed by a few ms between websocket and API backfill
    this.migrateUniqueConstraint();
  }

  /**
   * Migrate the unique constraint on trade_history from (symbol, order_id, update_time)
   * to (symbol, order_id). This requires rebuilding the table since SQLite cannot alter constraints.
   * Also deduplicates existing records, keeping the websocket source (or latest) for each order.
   */
  private migrateUniqueConstraint(): void {
    // Check if migration is needed by looking for the old constraint
    const indexInfo = this.db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='trade_history'`
    ).get() as { sql: string } | undefined;
    
    if (!indexInfo || !indexInfo.sql.includes('order_id, update_time')) {
      return; // Already migrated or new table
    }

    console.log('[TradeHistoryDb] Migrating unique constraint: (symbol, order_id, update_time) → (symbol, order_id)');
    
    const transaction = this.db.transaction(() => {
      // 1. Create new table with correct constraint
      this.db.exec(`
        CREATE TABLE trade_history_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          order_id INTEGER NOT NULL,
          client_order_id TEXT,
          side TEXT NOT NULL,
          position_side TEXT DEFAULT 'BOTH',
          order_type TEXT NOT NULL,
          orig_type TEXT,
          status TEXT NOT NULL,
          price TEXT DEFAULT '0',
          avg_price TEXT DEFAULT '0',
          orig_qty TEXT DEFAULT '0',
          executed_qty TEXT DEFAULT '0',
          last_filled_qty TEXT,
          last_filled_price TEXT,
          quote_qty TEXT,
          commission TEXT DEFAULT '0',
          commission_asset TEXT,
          realized_pnl TEXT DEFAULT '0',
          reduce_only INTEGER DEFAULT 0,
          close_position INTEGER DEFAULT 0,
          is_maker INTEGER DEFAULT 0,
          trade_id INTEGER,
          order_time INTEGER NOT NULL,
          update_time INTEGER NOT NULL,
          source TEXT DEFAULT 'websocket',
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          funding_rate_at_entry TEXT,
          UNIQUE(symbol, order_id)
        )
      `);

      // 2. Copy deduplicated data — prefer websocket source, keep latest update_time
      this.db.exec(`
        INSERT INTO trade_history_new (
          symbol, order_id, client_order_id, side, position_side,
          order_type, orig_type, status, price, avg_price,
          orig_qty, executed_qty, last_filled_qty, last_filled_price,
          quote_qty, commission, commission_asset, realized_pnl,
          reduce_only, close_position, is_maker, trade_id,
          order_time, update_time, source, created_at, funding_rate_at_entry
        )
        SELECT 
          symbol, order_id, client_order_id, side, position_side,
          order_type, orig_type, status, price, avg_price,
          orig_qty, executed_qty, last_filled_qty, last_filled_price,
          quote_qty, commission, commission_asset, realized_pnl,
          reduce_only, close_position, is_maker, trade_id,
          order_time, MAX(update_time), 
          CASE WHEN SUM(CASE WHEN source = 'websocket' THEN 1 ELSE 0 END) > 0 THEN 'websocket' ELSE 'api_backfill' END,
          MIN(created_at), funding_rate_at_entry
        FROM trade_history
        GROUP BY symbol, order_id
      `);

      // Count deduplication results
      const oldCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM trade_history').get() as { cnt: number }).cnt;
      const newCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM trade_history_new').get() as { cnt: number }).cnt;

      // 3. Swap tables
      this.db.exec('DROP TABLE trade_history');
      this.db.exec('ALTER TABLE trade_history_new RENAME TO trade_history');

      // 4. Recreate indexes
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_trade_history_symbol ON trade_history(symbol);
        CREATE INDEX IF NOT EXISTS idx_trade_history_update_time ON trade_history(update_time);
        CREATE INDEX IF NOT EXISTS idx_trade_history_status ON trade_history(status);
        CREATE INDEX IF NOT EXISTS idx_trade_history_order_id ON trade_history(order_id);
        CREATE INDEX IF NOT EXISTS idx_trade_history_symbol_time ON trade_history(symbol, update_time);
      `);

      console.log(`[TradeHistoryDb] Migration complete: ${oldCount} → ${newCount} records (${oldCount - newCount} duplicates removed)`);
    });

    transaction();
  }

  /**
   * Insert or update a trade/order event
   * Uses UPSERT to handle duplicate WebSocket events
   */
  upsertTrade(record: TradeHistoryRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO trade_history (
        symbol, order_id, client_order_id, side, position_side,
        order_type, orig_type, status, price, avg_price,
        orig_qty, executed_qty, last_filled_qty, last_filled_price,
        quote_qty, commission, commission_asset, realized_pnl,
        reduce_only, close_position, is_maker, trade_id,
        order_time, update_time, source
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(symbol, order_id) DO UPDATE SET
        status = excluded.status,
        avg_price = CASE WHEN excluded.avg_price != '0' THEN excluded.avg_price ELSE trade_history.avg_price END,
        executed_qty = excluded.executed_qty,
        last_filled_qty = COALESCE(excluded.last_filled_qty, trade_history.last_filled_qty),
        last_filled_price = COALESCE(excluded.last_filled_price, trade_history.last_filled_price),
        quote_qty = COALESCE(excluded.quote_qty, trade_history.quote_qty),
        commission = CASE WHEN excluded.commission != '0' THEN excluded.commission ELSE trade_history.commission END,
        commission_asset = COALESCE(excluded.commission_asset, trade_history.commission_asset),
        realized_pnl = CASE WHEN excluded.realized_pnl != '0' THEN excluded.realized_pnl ELSE trade_history.realized_pnl END,
        is_maker = excluded.is_maker,
        trade_id = COALESCE(excluded.trade_id, trade_history.trade_id),
        update_time = MAX(excluded.update_time, trade_history.update_time),
        source = CASE WHEN excluded.source = 'websocket' THEN 'websocket' ELSE trade_history.source END
    `);

    stmt.run(
      record.symbol,
      record.orderId,
      record.clientOrderId || null,
      record.side,
      record.positionSide || 'BOTH',
      record.orderType,
      record.origType || null,
      record.status,
      record.price || '0',
      record.avgPrice || '0',
      record.origQty || '0',
      record.executedQty || '0',
      record.lastFilledQty || null,
      record.lastFilledPrice || null,
      record.quoteQty || null,
      record.commission || '0',
      record.commissionAsset || null,
      record.realizedPnl || '0',
      record.reduceOnly ? 1 : 0,
      record.closePosition ? 1 : 0,
      record.isMaker ? 1 : 0,
      record.tradeId || null,
      record.orderTime,
      record.updateTime,
      record.source
    );
  }

  /**
   * Batch insert for backfill operations
   */
  batchUpsertTrades(records: TradeHistoryRecord[]): void {
    const transaction = this.db.transaction((recs: TradeHistoryRecord[]) => {
      for (const rec of recs) {
        this.upsertTrade(rec);
      }
    });
    transaction(records);
  }

  /**
   * Insert income record (PnL, commission, funding)
   */
  upsertIncome(record: {
    tranId: number;
    symbol: string;
    incomeType: string;
    income: string;
    asset: string;
    info?: string;
    tradeId?: string;
    time: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO income_history (
        tran_id, symbol, income_type, income, asset, info, trade_id, time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.tranId,
      record.symbol || null,
      record.incomeType,
      record.income,
      record.asset || 'USDT',
      record.info || null,
      record.tradeId || null,
      record.time
    );
  }

  /**
   * Batch insert income records
   */
  batchUpsertIncome(records: Array<{
    tranId: number;
    symbol: string;
    incomeType: string;
    income: string;
    asset: string;
    info?: string;
    tradeId?: string;
    time: number;
  }>): void {
    const transaction = this.db.transaction((recs: typeof records) => {
      for (const rec of recs) {
        this.upsertIncome(rec);
      }
    });
    transaction(records);
  }

  /**
   * Query trade history with flexible filtering
   */
  queryTrades(filter: TradeHistoryFilter = {}): TradeHistoryRecord[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.symbol) {
      conditions.push('symbol = ?');
      params.push(filter.symbol);
    }
    if (filter.side) {
      conditions.push('side = ?');
      params.push(filter.side);
    }
    if (filter.status) {
      if (Array.isArray(filter.status)) {
        conditions.push(`status IN (${filter.status.map(() => '?').join(',')})`);
        params.push(...filter.status);
      } else {
        conditions.push('status = ?');
        params.push(filter.status);
      }
    }
    if (filter.startTime) {
      conditions.push('update_time >= ?');
      params.push(filter.startTime);
    }
    if (filter.endTime) {
      conditions.push('update_time <= ?');
      params.push(filter.endTime);
    }
    if (filter.orderType) {
      if (Array.isArray(filter.orderType)) {
        conditions.push(`order_type IN (${filter.orderType.map(() => '?').join(',')})`);
        params.push(...filter.orderType);
      } else {
        conditions.push('order_type = ?');
        params.push(filter.orderType);
      }
    }
    if (filter.reduceOnly !== undefined) {
      conditions.push('reduce_only = ?');
      params.push(filter.reduceOnly ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 200;
    const offset = filter.offset || 0;

    const sql = `
      SELECT * FROM trade_history
      ${where}
      ORDER BY update_time DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as any[];
  }

  /**
   * Get the most recent FILLED trades (for Recent Orders display)
   * Returns in the Order format expected by the UI
   */
  getRecentFilledOrders(options: {
    symbol?: string;
    limit?: number;
    startTime?: number;
  } = {}): any[] {
    const conditions = ["status = 'FILLED'"];
    const params: any[] = [];

    if (options.symbol) {
      conditions.push('symbol = ?');
      params.push(options.symbol);
    }
    if (options.startTime) {
      conditions.push('update_time >= ?');
      params.push(options.startTime);
    }

    const limit = options.limit || 100;
    const where = conditions.join(' AND ');

    const rows = this.db.prepare(`
      SELECT * FROM trade_history
      WHERE ${where}
      ORDER BY update_time DESC
      LIMIT ?
    `).all(...params, limit) as any[];

    // Convert to Order format for UI compatibility
    return rows.map(row => ({
      symbol: row.symbol,
      orderId: row.order_id,
      clientOrderId: row.client_order_id,
      price: row.price,
      origQty: row.orig_qty,
      executedQty: row.executed_qty,
      status: row.status,
      timeInForce: 'GTC',
      type: row.order_type,
      side: row.side,
      stopPrice: '0',
      time: row.order_time,
      updateTime: row.update_time,
      positionSide: row.position_side,
      closePosition: !!row.close_position,
      reduceOnly: !!row.reduce_only,
      avgPrice: row.avg_price,
      origType: row.orig_type,
      realizedProfit: row.realized_pnl,
      commission: row.commission,
      commissionAsset: row.commission_asset,
      isMaker: !!row.is_maker,
      lastFilledQty: row.last_filled_qty,
      lastFilledPrice: row.last_filled_price,
      tradeId: row.trade_id,
    }));
  }

  /**
   * Get trade markers for TradingView chart
   * Returns simplified records optimized for chart markers
   */
  getChartMarkers(symbol: string, startTime: number, endTime?: number): Array<{
    time: number;
    side: string;
    price: number;
    qty: number;
    pnl: number;
    reduceOnly: boolean;
    orderType: string;
  }> {
    const conditions = ["symbol = ?", "status = 'FILLED'"];
    const params: any[] = [symbol];

    conditions.push('update_time >= ?');
    params.push(startTime);

    if (endTime) {
      conditions.push('update_time <= ?');
      params.push(endTime);
    }

    const rows = this.db.prepare(`
      SELECT update_time, side, avg_price, executed_qty, realized_pnl, reduce_only, order_type
      FROM trade_history
      WHERE ${conditions.join(' AND ')}
      ORDER BY update_time ASC
    `).all(...params) as any[];

    return rows.map(row => ({
      time: row.update_time,
      side: row.side,
      price: parseFloat(row.avg_price),
      qty: parseFloat(row.executed_qty),
      pnl: parseFloat(row.realized_pnl || '0'),
      reduceOnly: !!row.reduce_only,
      orderType: row.order_type,
    }));
  }

  /**
   * Get income breakdown for analytics
   */
  getIncomeBreakdown(options: {
    startTime?: number;
    endTime?: number;
    symbol?: string;
  } = {}): {
    realizedPnl: number;
    commission: number;
    funding: number;
    netProfit: number;
  } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.startTime) {
      conditions.push('time >= ?');
      params.push(options.startTime);
    }
    if (options.endTime) {
      conditions.push('time <= ?');
      params.push(options.endTime);
    }
    if (options.symbol) {
      conditions.push('symbol = ?');
      params.push(options.symbol);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db.prepare(`
      SELECT income_type, SUM(CAST(income AS REAL)) as total
      FROM income_history
      ${where}
      GROUP BY income_type
    `).all(...params) as any[];

    const result = {
      realizedPnl: 0,
      commission: 0,
      funding: 0,
      netProfit: 0,
    };

    for (const row of rows) {
      switch (row.income_type) {
        case 'REALIZED_PNL':
          result.realizedPnl = row.total;
          break;
        case 'COMMISSION':
          result.commission = row.total;
          break;
        case 'FUNDING_FEE':
          result.funding = row.total;
          break;
      }
    }

    result.netProfit = result.realizedPnl + result.commission + result.funding;
    return result;
  }

  /**
   * Per-symbol income breakdown within a time window (for leaderboard)
   */
  getSymbolLeaderboard(startTime: number, endTime?: number): Array<{
    symbol: string;
    realizedPnl: number;
    commission: number;
    funding: number;
    netProfit: number;
    tradeCount: number;
  }> {
    const params: any[] = [startTime];
    const endClause = endTime ? 'AND time <= ?' : '';
    if (endTime) params.push(endTime);

    const rows = this.db.prepare(`
      SELECT
        symbol,
        SUM(CASE WHEN income_type = 'REALIZED_PNL' THEN CAST(income AS REAL) ELSE 0 END) AS realized_pnl,
        SUM(CASE WHEN income_type = 'COMMISSION' THEN CAST(income AS REAL) ELSE 0 END) AS commission,
        SUM(CASE WHEN income_type = 'FUNDING_FEE' THEN CAST(income AS REAL) ELSE 0 END) AS funding,
        COUNT(DISTINCT CASE WHEN income_type = 'REALIZED_PNL' THEN trade_id END) AS trade_count
      FROM income_history
      WHERE time >= ? ${endClause}
        AND symbol IS NOT NULL AND symbol != ''
      GROUP BY symbol
      ORDER BY (
        SUM(CASE WHEN income_type = 'REALIZED_PNL' THEN CAST(income AS REAL) ELSE 0 END) +
        SUM(CASE WHEN income_type = 'COMMISSION' THEN CAST(income AS REAL) ELSE 0 END) +
        SUM(CASE WHEN income_type = 'FUNDING_FEE' THEN CAST(income AS REAL) ELSE 0 END)
      ) DESC
    `).all(...params) as any[];

    return rows.map(r => ({
      symbol: r.symbol,
      realizedPnl: r.realized_pnl ?? 0,
      commission: r.commission ?? 0,
      funding: r.funding ?? 0,
      netProfit: (r.realized_pnl ?? 0) + (r.commission ?? 0) + (r.funding ?? 0),
      tradeCount: r.trade_count ?? 0,
    }));
  }

  /**
   * Daily net P&L from income_history for the last N days (for balance trend chart)
   */
  getDailyTrend(cutoffMs: number): Array<{
    date: string;
    realizedPnl: number;
    commission: number;
    funding: number;
    rebates: number;
    net: number;
    tradeCount: number;
  }> {
    const rows = this.db.prepare(`
      SELECT
        date(time / 1000, 'unixepoch') AS day,
        SUM(CASE WHEN income_type = 'REALIZED_PNL'      THEN CAST(income AS REAL) ELSE 0 END) AS realized_pnl,
        SUM(CASE WHEN income_type = 'COMMISSION'         THEN CAST(income AS REAL) ELSE 0 END) AS commission,
        SUM(CASE WHEN income_type = 'FUNDING_FEE'        THEN CAST(income AS REAL) ELSE 0 END) AS funding,
        SUM(CASE WHEN income_type = 'APOLLOX_DEX_REBATE' THEN CAST(income AS REAL) ELSE 0 END) AS rebates,
        SUM(CAST(income AS REAL))                                                               AS net,
        COUNT(DISTINCT CASE WHEN income_type = 'REALIZED_PNL' THEN trade_id END)               AS trade_count
      FROM income_history
      WHERE asset = 'USDT' AND time >= ?
      GROUP BY day
      ORDER BY day ASC
    `).all(cutoffMs) as any[];

    return rows.map(r => ({
      date: r.day as string,
      realizedPnl: r.realized_pnl ?? 0,
      commission: r.commission ?? 0,
      funding: r.funding ?? 0,
      rebates: r.rebates ?? 0,
      net: r.net ?? 0,
      tradeCount: r.trade_count ?? 0,
    }));
  }

  /**
   * Get total trade count (for stats)
   */
  getTradeCount(filter?: { symbol?: string; status?: string }): number {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.symbol) {
      conditions.push('symbol = ?');
      params.push(filter.symbol);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM trade_history ${where}`).get(...params) as any;
    return row?.count || 0;
  }

  /**
   * Get sync metadata (for tracking backfill progress)
   */
  getSyncMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get(key) as any;
    return row?.value || null;
  }

  /**
   * Set sync metadata
   */
  setSyncMeta(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO sync_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now());
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ---- Funding Rate Methods ----

  /**
   * Insert a funding rate snapshot
   */
  insertFundingRate(record: { symbol: string; fundingRate: string; markPrice?: string; nextFundingTime?: number; snapshotTime: number; source?: string }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO funding_rates (symbol, funding_rate, mark_price, next_funding_time, snapshot_time, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(record.symbol, record.fundingRate, record.markPrice || null, record.nextFundingTime || null, record.snapshotTime, record.source || 'poll');
  }

  /**
   * Batch insert funding rate snapshots
   */
  batchInsertFundingRates(records: Array<{ symbol: string; fundingRate: string; markPrice?: string; nextFundingTime?: number; snapshotTime: number; source?: string }>): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO funding_rates (symbol, funding_rate, mark_price, next_funding_time, snapshot_time, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const transaction = this.db.transaction((recs: typeof records) => {
      for (const r of recs) {
        stmt.run(r.symbol, r.fundingRate, r.markPrice || null, r.nextFundingTime || null, r.snapshotTime, r.source || 'poll');
      }
    });
    transaction(records);
  }

  /**
   * Get funding rates for a symbol within a time range
   */
  getFundingRates(symbol: string, startTime?: number, endTime?: number, limit?: number): Array<{ symbol: string; funding_rate: string; mark_price: string; snapshot_time: number; source: string }> {
    let sql = 'SELECT symbol, funding_rate, mark_price, snapshot_time, source FROM funding_rates WHERE symbol = ?';
    const params: any[] = [symbol];
    if (startTime) { sql += ' AND snapshot_time >= ?'; params.push(startTime); }
    if (endTime) { sql += ' AND snapshot_time <= ?'; params.push(endTime); }
    sql += ' ORDER BY snapshot_time DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(limit); }
    return this.db.prepare(sql).all(...params) as any[];
  }

  /**
   * Get the latest funding rate for a symbol
   */
  getLatestFundingRate(symbol: string): { symbol: string; funding_rate: string; mark_price: string; snapshot_time: number } | undefined {
    return this.db.prepare(`
      SELECT symbol, funding_rate, mark_price, snapshot_time
      FROM funding_rates WHERE symbol = ?
      ORDER BY snapshot_time DESC LIMIT 1
    `).get(symbol) as any;
  }

  /**
   * Get latest funding rates for all symbols
   */
  getLatestFundingRates(): Array<{ symbol: string; funding_rate: string; mark_price: string; snapshot_time: number }> {
    return this.db.prepare(`
      SELECT f.symbol, f.funding_rate, f.mark_price, f.snapshot_time
      FROM funding_rates f
      INNER JOIN (
        SELECT symbol, MAX(snapshot_time) as max_time
        FROM funding_rates GROUP BY symbol
      ) latest ON f.symbol = latest.symbol AND f.snapshot_time = latest.max_time
      ORDER BY CAST(f.funding_rate AS REAL) ASC
    `).all() as any[];
  }

  /**
   * Update funding_rate_at_entry on a trade record
   */
  updateTradeFundingRate(symbol: string, orderId: number, fundingRate: string): void {
    this.db.prepare(`
      UPDATE trade_history SET funding_rate_at_entry = ?
      WHERE symbol = ? AND order_id = ? AND funding_rate_at_entry IS NULL
    `).run(fundingRate, symbol, orderId);
  }

  /**
   * Get funding rate stats for correlation analysis
   */
  getFundingRateStats(symbol: string, lookbackHours: number = 24): { avg: number; min: number; max: number; current: number; count: number } | null {
    const since = Date.now() - (lookbackHours * 60 * 60 * 1000);
    const result = this.db.prepare(`
      SELECT 
        AVG(CAST(funding_rate AS REAL)) as avg_rate,
        MIN(CAST(funding_rate AS REAL)) as min_rate,
        MAX(CAST(funding_rate AS REAL)) as max_rate,
        COUNT(*) as count
      FROM funding_rates WHERE symbol = ? AND snapshot_time >= ?
    `).get(symbol, since) as any;

    if (!result || result.count === 0) return null;

    const latest = this.getLatestFundingRate(symbol);
    return {
      avg: result.avg_rate,
      min: result.min_rate,
      max: result.max_rate,
      current: latest ? parseFloat(latest.funding_rate) : 0,
      count: result.count,
    };
  }
}

// Singleton export
export const tradeHistoryDb = new TradeHistoryDb();
