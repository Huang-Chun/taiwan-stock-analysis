const { pool } = require('../database/connection');

/**
 * 計算距今天數（以日曆天為準）
 */
function daysSince(date) {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * 查詢以 trade_date 欄位為基準的資料表最新日期
 */
async function latestTradeDate(table, stockId) {
  const sql = stockId
    ? `SELECT MAX(trade_date) AS latest FROM ${table} WHERE stock_id = ?`
    : `SELECT MAX(trade_date) AS latest FROM ${table}`;
  const [rows] = await pool.query(sql, stockId ? [stockId] : []);
  return rows[0]?.latest ?? null;
}

/**
 * 產生 _meta 物件
 * @param {object} params
 * @param {string|null} params.latest_date  - ISO 日期字串
 * @param {number}      params.stale_days   - 超過幾天視為過期
 * @param {string}      params.frequency    - 資料更新頻率說明
 * @param {string}      params.sync_api     - 建議呼叫的 sync API
 */
function buildMeta({ latest_date, stale_days, frequency, sync_api }) {
  if (!latest_date) {
    return {
      has_data: false,
      latest_date: null,
      days_since_update: null,
      is_stale: true,
      update_frequency: frequency,
      suggestion: `無資料，請先呼叫 ${sync_api}`,
    };
  }
  const days = daysSince(latest_date);
  const is_stale = days > stale_days;
  return {
    has_data: true,
    latest_date: typeof latest_date === 'string'
      ? latest_date.slice(0, 10)
      : new Date(latest_date).toISOString().slice(0, 10),
    days_since_update: days,
    is_stale,
    update_frequency: frequency,
    suggestion: is_stale ? `資料已 ${days} 天未更新，建議呼叫 ${sync_api}` : null,
  };
}

/**
 * 股價 / 技術指標 / 三大法人 / 融資融券（trade_date 類）
 */
async function getPriceFreshness(stockId) {
  const latest = await latestTradeDate('daily_prices', stockId);
  return buildMeta({
    latest_date: latest,
    stale_days: 5,
    frequency: '每個交易日',
    sync_api: 'sync_daily_prices',
  });
}

async function getIndicatorFreshness(stockId) {
  const latest = await latestTradeDate('technical_indicators', stockId);
  return buildMeta({
    latest_date: latest,
    stale_days: 5,
    frequency: '每個交易日（依賴 daily_prices）',
    sync_api: 'calculate_indicators',
  });
}

async function getInstitutionalFreshness(stockId) {
  const latest = await latestTradeDate('institutional_trading', stockId);
  return buildMeta({
    latest_date: latest,
    stale_days: 5,
    frequency: '每個交易日',
    sync_api: 'sync_institutional_trading',
  });
}

async function getMarginFreshness(stockId) {
  const latest = await latestTradeDate('margin_trading', stockId);
  return buildMeta({
    latest_date: latest,
    stale_days: 5,
    frequency: '每個交易日',
    sync_api: 'sync_margin_trading',
  });
}

/**
 * 月營收（year + month 欄位）
 */
async function getRevenueFreshness(stockId) {
  const sql = stockId
    ? 'SELECT year, month FROM monthly_revenue WHERE stock_id = ? ORDER BY year DESC, month DESC LIMIT 1'
    : 'SELECT year, month FROM monthly_revenue ORDER BY year DESC, month DESC LIMIT 1';
  const [rows] = await pool.query(sql, stockId ? [stockId] : []);

  let latest_date = null;
  if (rows[0]) {
    // 月營收以當月 1 號作為日期基準
    latest_date = `${rows[0].year}-${String(rows[0].month).padStart(2, '0')}-01`;
  }
  return buildMeta({
    latest_date,
    stale_days: 45,
    frequency: '每月（次月 10 號後公佈）',
    sync_api: 'sync_monthly_revenue',
  });
}

/**
 * 季度財報（year + quarter 欄位）
 */
async function getFinancialFreshness(stockId) {
  const sql = stockId
    ? 'SELECT year, quarter FROM financial_statements WHERE stock_id = ? ORDER BY year DESC, quarter DESC LIMIT 1'
    : 'SELECT year, quarter FROM financial_statements ORDER BY year DESC, quarter DESC LIMIT 1';
  const [rows] = await pool.query(sql, stockId ? [stockId] : []);

  let latest_date = null;
  if (rows[0]) {
    // 季末月份：Q1=3, Q2=6, Q3=9, Q4=12
    const endMonth = rows[0].quarter * 3;
    latest_date = `${rows[0].year}-${String(endMonth).padStart(2, '0')}-01`;
  }
  return buildMeta({
    latest_date,
    stale_days: 100,
    frequency: '每季（季末後約 45 天公佈）',
    sync_api: 'sync_financial_statements',
  });
}

/**
 * 股利（dividends）
 */
async function getDividendFreshness(stockId) {
  const sql = stockId
    ? 'SELECT MAX(ex_dividend_date) AS latest FROM dividends WHERE stock_id = ?'
    : 'SELECT MAX(ex_dividend_date) AS latest FROM dividends';
  const [rows] = await pool.query(sql, stockId ? [stockId] : []);
  return buildMeta({
    latest_date: rows[0]?.latest ?? null,
    stale_days: 90,
    frequency: '每年（除息日為基準）',
    sync_api: 'sync_dividends',
  });
}

module.exports = {
  getPriceFreshness,
  getIndicatorFreshness,
  getInstitutionalFreshness,
  getMarginFreshness,
  getRevenueFreshness,
  getFinancialFreshness,
  getDividendFreshness,
};
