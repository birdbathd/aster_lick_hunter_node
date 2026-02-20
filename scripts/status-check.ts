import { getPositionRisk, getOpenOrders, getBalance, getAccountInfo } from '../src/lib/api/market';
import { loadConfig } from '../src/lib/bot/config';
import { buildSignedQuery } from '../src/lib/api/auth';
import { getRateLimitedAxios } from '../src/lib/api/requestInterceptor';

const BASE_URL = 'https://fapi.asterdex.com';

async function main() {
  const config = await loadConfig();
  const creds = config.api;
  
  // Account info
  const account = await getAccountInfo(creds);
  console.log('=== ACCOUNT ===');
  console.log('Balance:', parseFloat(account.totalWalletBalance).toFixed(2), 'USDT');
  console.log('Unrealized PnL:', parseFloat(account.totalUnrealizedProfit).toFixed(2), 'USDT');
  console.log('Margin Balance:', parseFloat(account.totalMarginBalance).toFixed(2), 'USDT');
  console.log('Available:', parseFloat(account.availableBalance).toFixed(2), 'USDT');
  
  // Positions
  const positions = await getPositionRisk(undefined, creds);
  const open = positions.filter((p: any) => Math.abs(parseFloat(p.positionAmt)) > 0);
  console.log('\n=== OPEN POSITIONS (' + open.length + ') ===');
  for (const p of open) {
    const entry = parseFloat(p.entryPrice);
    const mark = parseFloat(p.markPrice);
    const isLong = parseFloat(p.positionAmt) > 0;
    const pnlPct = isLong ? ((mark - entry) / entry * 100) : ((entry - mark) / entry * 100);
    const notional = Math.abs(parseFloat(p.positionAmt) * mark);
    console.log(`  ${p.symbol} ${isLong ? 'LONG' : 'SHORT'} | Size: ${p.positionAmt} | Entry: ${entry.toFixed(4)} | Mark: ${mark.toFixed(4)} | PnL: $${parseFloat(p.unRealizedProfit).toFixed(2)} (${pnlPct.toFixed(2)}%) | Lev: ${p.leverage}x | Notional: $${notional.toFixed(2)} | Liq: ${parseFloat(p.liquidationPrice).toFixed(2)}`);
  }
  
  // Orders
  const orders = await getOpenOrders(undefined, creds);
  console.log('\n=== OPEN ORDERS (' + orders.length + ') ===');
  for (const o of orders) {
    const price = o.stopPrice !== '0' ? o.stopPrice : o.price;
    console.log(`  ${o.symbol} ${o.side} ${o.positionSide} ${o.type} | Price: ${price} | Qty: ${o.origQty} | ID: ${o.orderId}`);
  }
  
  // Recent trades (last 24h)
  console.log('\n=== RECENT TRADES (last 24h) ===');
  const symbols = Object.keys(config.symbols);
  let allTrades: any[] = [];
  const axios = getRateLimitedAxios();
  
  for (const symbol of symbols) {
    try {
      const query = buildSignedQuery({
        symbol,
        limit: 50,
        startTime: Date.now() - 24 * 60 * 60 * 1000,
      }, creds);
      const resp = await axios.get(`${BASE_URL}/fapi/v1/userTrades?${query}`, {
        headers: { 'X-MBX-APIKEY': creds.apiKey }
      });
      const trades = resp.data;
      if (trades.length > 0) {
        allTrades.push(...trades.map((t: any) => ({ ...t, symbol })));
      }
    } catch (e) {}
  }
  
  allTrades.sort((a, b) => b.time - a.time);
  
  let totalRealized = 0;
  let totalCommission = 0;
  
  for (const t of allTrades) {
    const pnl = parseFloat(t.realizedPnl);
    const commission = parseFloat(t.commission);
    totalRealized += pnl;
    totalCommission += commission;
    const time = new Date(t.time).toISOString().slice(0, 19).replace('T', ' ');
    if (pnl !== 0) {
      console.log(`  ${time} | ${t.symbol} ${t.side} ${t.positionSide} | Qty: ${t.qty} @ ${parseFloat(t.price).toFixed(4)} | PnL: $${pnl.toFixed(4)} | Fee: $${commission.toFixed(4)}`);
    }
  }
  
  console.log(`\n=== 24h SUMMARY ===`);
  console.log(`Total Trades: ${allTrades.length}`);
  console.log(`Realized PnL: $${totalRealized.toFixed(4)}`);
  console.log(`Total Fees: $${totalCommission.toFixed(4)}`);
  console.log(`Net PnL: $${(totalRealized + totalCommission).toFixed(4)}`);
  
  // Income history for funding
  try {
    const fquery = buildSignedQuery({
      incomeType: 'FUNDING_FEE',
      startTime: Date.now() - 24 * 60 * 60 * 1000,
      limit: 50,
    }, creds);
    const fresp = await axios.get(`${BASE_URL}/fapi/v1/income?${fquery}`, {
      headers: { 'X-MBX-APIKEY': creds.apiKey }
    });
    const income = fresp.data;
    if (income.length > 0) {
      let totalFunding = 0;
      console.log(`\n=== FUNDING FEES (24h) ===`);
      for (const f of income) {
        const amt = parseFloat(f.income);
        totalFunding += amt;
        const time = new Date(f.time).toISOString().slice(0, 19).replace('T', ' ');
        console.log(`  ${time} | ${f.symbol} | $${amt.toFixed(4)}`);
      }
      console.log(`Total Funding: $${totalFunding.toFixed(4)}`);
    }
  } catch (e) {}
}

main().catch(console.error);
