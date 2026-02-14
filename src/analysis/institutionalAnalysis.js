const { pool } = require('../database/connection');

/**
 * 三大法人買賣超趨勢分析
 * @param {string} stockId - 股票代號
 * @param {number} days - 分析天數（預設 20）
 */
async function analyzeInstitutionalTrend(stockId, days = 20) {
  const [rows] = await pool.query(
    `SELECT trade_date, foreign_net, trust_net, dealer_net, total_net
     FROM institutional_trading
     WHERE stock_id = ?
     ORDER BY trade_date DESC LIMIT ?`,
    [stockId, days]
  );

  if (rows.length === 0) return null;

  const data = rows.reverse(); // 由舊到新

  const foreignTotal = data.reduce((s, r) => s + (parseInt(r.foreign_net) || 0), 0);
  const trustTotal = data.reduce((s, r) => s + (parseInt(r.trust_net) || 0), 0);
  const dealerTotal = data.reduce((s, r) => s + (parseInt(r.dealer_net) || 0), 0);
  const totalNet = data.reduce((s, r) => s + (parseInt(r.total_net) || 0), 0);

  const foreignBuyDays = data.filter(r => parseInt(r.foreign_net) > 0).length;
  const trustBuyDays = data.filter(r => parseInt(r.trust_net) > 0).length;
  const dealerBuyDays = data.filter(r => parseInt(r.dealer_net) > 0).length;

  return {
    stock_id: stockId,
    period_days: data.length,
    foreign: {
      net_total: foreignTotal,
      buy_days: foreignBuyDays,
      sell_days: data.length - foreignBuyDays,
      trend: foreignTotal > 0 ? '買超' : '賣超'
    },
    trust: {
      net_total: trustTotal,
      buy_days: trustBuyDays,
      sell_days: data.length - trustBuyDays,
      trend: trustTotal > 0 ? '買超' : '賣超'
    },
    dealer: {
      net_total: dealerTotal,
      buy_days: dealerBuyDays,
      sell_days: data.length - dealerBuyDays,
      trend: dealerTotal > 0 ? '買超' : '賣超'
    },
    total_net: totalNet,
    overall_trend: totalNet > 0 ? '法人買超' : '法人賣超'
  };
}

/**
 * 主力吸籌偵測（連續買超天數 + 累計淨買超）
 */
async function detectAccumulation(stockId, minConsecutiveDays = 3) {
  const [rows] = await pool.query(
    `SELECT trade_date, foreign_net, trust_net, total_net
     FROM institutional_trading
     WHERE stock_id = ?
     ORDER BY trade_date DESC LIMIT 30`,
    [stockId]
  );

  if (rows.length === 0) return null;

  // 計算連續買超天數（外資 + 投信）
  let foreignConsecutive = 0;
  let trustConsecutive = 0;
  let totalConsecutive = 0;

  for (const row of rows) {
    if (parseInt(row.foreign_net) > 0) foreignConsecutive++;
    else break;
  }

  for (const row of rows) {
    if (parseInt(row.trust_net) > 0) trustConsecutive++;
    else break;
  }

  for (const row of rows) {
    if (parseInt(row.total_net) > 0) totalConsecutive++;
    else break;
  }

  const isAccumulating = foreignConsecutive >= minConsecutiveDays || trustConsecutive >= minConsecutiveDays;

  // 計算連續買超期間的累計量
  const accumulationVolume = rows.slice(0, totalConsecutive)
    .reduce((s, r) => s + (parseInt(r.total_net) || 0), 0);

  return {
    stock_id: stockId,
    is_accumulating: isAccumulating,
    foreign_consecutive_buy_days: foreignConsecutive,
    trust_consecutive_buy_days: trustConsecutive,
    total_consecutive_buy_days: totalConsecutive,
    accumulation_volume: accumulationVolume,
    signal: isAccumulating ? '主力吸籌訊號' : null
  };
}

/**
 * 法人共識度分析
 * 三大法人同方向 = 高共識
 */
async function analyzeConsensus(stockId) {
  const [rows] = await pool.query(
    `SELECT trade_date, foreign_net, trust_net, dealer_net, total_net
     FROM institutional_trading
     WHERE stock_id = ?
     ORDER BY trade_date DESC LIMIT 1`,
    [stockId]
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  const foreignDir = parseInt(r.foreign_net) > 0 ? 1 : parseInt(r.foreign_net) < 0 ? -1 : 0;
  const trustDir = parseInt(r.trust_net) > 0 ? 1 : parseInt(r.trust_net) < 0 ? -1 : 0;
  const dealerDir = parseInt(r.dealer_net) > 0 ? 1 : parseInt(r.dealer_net) < 0 ? -1 : 0;

  const sameDirection = (foreignDir === trustDir && trustDir === dealerDir && foreignDir !== 0);
  let consensus = '分歧';
  if (sameDirection && foreignDir > 0) consensus = '三大法人同步買超（強烈看多）';
  else if (sameDirection && foreignDir < 0) consensus = '三大法人同步賣超（強烈看空）';
  else if (foreignDir === trustDir && foreignDir !== 0) consensus = foreignDir > 0 ? '外資投信同步買超（看多）' : '外資投信同步賣超（看空）';

  return {
    stock_id: stockId,
    trade_date: r.trade_date,
    foreign_net: parseInt(r.foreign_net),
    trust_net: parseInt(r.trust_net),
    dealer_net: parseInt(r.dealer_net),
    total_net: parseInt(r.total_net),
    consensus,
    consensus_score: sameDirection ? (foreignDir > 0 ? 100 : 0) : 50
  };
}

/**
 * 融資融券趨勢分析
 */
async function analyzeMarginTrend(stockId, days = 20) {
  const [rows] = await pool.query(
    `SELECT trade_date, margin_balance, short_balance, offset_volume
     FROM margin_trading
     WHERE stock_id = ?
     ORDER BY trade_date DESC LIMIT ?`,
    [stockId, days]
  );

  if (rows.length < 2) return null;

  const data = rows.reverse();
  const first = data[0];
  const last = data[data.length - 1];

  const marginChange = (parseInt(last.margin_balance) || 0) - (parseInt(first.margin_balance) || 0);
  const shortChange = (parseInt(last.short_balance) || 0) - (parseInt(first.short_balance) || 0);

  const lastMargin = parseInt(last.margin_balance) || 0;
  const lastShort = parseInt(last.short_balance) || 0;

  // 券資比
  const shortMarginRatio = lastMargin > 0 ? (lastShort / lastMargin * 100).toFixed(2) : 0;

  let interpretation = '';
  if (marginChange > 0 && shortChange < 0) interpretation = '融資增加、融券減少 → 散戶偏多';
  else if (marginChange < 0 && shortChange > 0) interpretation = '融資減少、融券增加 → 可能有軋空機會';
  else if (marginChange > 0 && shortChange > 0) interpretation = '融資融券雙增 → 多空分歧';
  else if (marginChange < 0 && shortChange < 0) interpretation = '融資融券雙減 → 觀望態勢';

  return {
    stock_id: stockId,
    period_days: data.length,
    margin_balance: lastMargin,
    margin_change: marginChange,
    short_balance: lastShort,
    short_change: shortChange,
    short_margin_ratio: shortMarginRatio,
    interpretation
  };
}

/**
 * 依籌碼面篩選股票
 */
async function screenByInstitutional(criteria = {}) {
  const {
    foreign_net_min,       // 外資淨買超最低
    trust_net_min,         // 投信淨買超最低
    consecutive_buy_days,  // 連續買超天數
    days = 5              // 累計天數
  } = criteria;

  let query = `
    SELECT it.stock_id, s.stock_name,
      SUM(it.foreign_net) as foreign_total,
      SUM(it.trust_net) as trust_total,
      SUM(it.dealer_net) as dealer_total,
      SUM(it.total_net) as total_net,
      COUNT(*) as data_days
    FROM institutional_trading it
    JOIN stocks s ON it.stock_id = s.stock_id
    WHERE it.trade_date >= (
      SELECT MAX(trade_date) FROM institutional_trading
    ) - INTERVAL ? DAY
    GROUP BY it.stock_id, s.stock_name
    HAVING 1=1
  `;
  const params = [days];

  if (foreign_net_min !== undefined) {
    query += ' AND SUM(it.foreign_net) >= ?';
    params.push(foreign_net_min);
  }
  if (trust_net_min !== undefined) {
    query += ' AND SUM(it.trust_net) >= ?';
    params.push(trust_net_min);
  }

  query += ' ORDER BY total_net DESC LIMIT 50';

  const [rows] = await pool.query(query, params);
  return { count: rows.length, data: rows };
}

module.exports = {
  analyzeInstitutionalTrend,
  detectAccumulation,
  analyzeConsensus,
  analyzeMarginTrend,
  screenByInstitutional
};
