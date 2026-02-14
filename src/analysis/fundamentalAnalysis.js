const { pool } = require('../database/connection');

/**
 * 營收成長趨勢分析（MoM / YoY）
 */
async function analyzeRevenueTrend(stockId, months = 12) {
  const [rows] = await pool.query(
    `SELECT year, month, revenue, revenue_mom, revenue_yoy, cumulative_revenue, cumulative_yoy
     FROM monthly_revenue
     WHERE stock_id = ?
     ORDER BY year DESC, month DESC LIMIT ?`,
    [stockId, months]
  );

  if (rows.length === 0) return null;

  const data = rows.reverse();
  const latest = data[data.length - 1];

  // 計算平均年增率
  const yoyValues = data.filter(r => r.revenue_yoy !== null).map(r => parseFloat(r.revenue_yoy));
  const avgYoY = yoyValues.length > 0 ? (yoyValues.reduce((a, b) => a + b, 0) / yoyValues.length).toFixed(2) : null;

  // 營收成長動能
  let momentum = '持平';
  if (yoyValues.length >= 3) {
    const recent3 = yoyValues.slice(-3);
    const allPositive = recent3.every(v => v > 0);
    const allNegative = recent3.every(v => v < 0);
    const increasing = recent3[2] > recent3[1] && recent3[1] > recent3[0];
    const decreasing = recent3[2] < recent3[1] && recent3[1] < recent3[0];

    if (allPositive && increasing) momentum = '強勁成長';
    else if (allPositive) momentum = '穩定成長';
    else if (allNegative && decreasing) momentum = '加速衰退';
    else if (allNegative) momentum = '持續衰退';
    else if (recent3[2] > 0 && recent3[0] < 0) momentum = '轉正成長';
  }

  return {
    stock_id: stockId,
    latest_month: `${latest.year}/${latest.month}`,
    latest_revenue: latest.revenue,
    latest_mom: latest.revenue_mom,
    latest_yoy: latest.revenue_yoy,
    avg_yoy: avgYoY,
    momentum,
    history: data
  };
}

/**
 * 估值指標計算（PE/PB/殖利率）
 */
async function calculateValuation(stockId) {
  // 取得最新股價
  const [priceRows] = await pool.query(
    `SELECT close_price, trade_date FROM daily_prices
     WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 1`,
    [stockId]
  );

  if (priceRows.length === 0) return null;

  const price = parseFloat(priceRows[0].close_price);
  const result = {
    stock_id: stockId,
    price,
    trade_date: priceRows[0].trade_date,
    pe_ratio: null,
    pb_ratio: null,
    dividend_yield: null,
    eps_ttm: null,
    book_value: null
  };

  // 計算近四季 EPS (TTM)
  const [epsRows] = await pool.query(
    `SELECT eps FROM financial_statements
     WHERE stock_id = ? AND eps IS NOT NULL
     ORDER BY year DESC, quarter DESC LIMIT 4`,
    [stockId]
  );

  if (epsRows.length > 0) {
    const epsTTM = epsRows.reduce((sum, r) => sum + (parseFloat(r.eps) || 0), 0);
    result.eps_ttm = epsTTM.toFixed(2);
    if (epsTTM > 0) {
      result.pe_ratio = (price / epsTTM).toFixed(2);
    }
  }

  // 每股淨值 (PB)
  const [bvRows] = await pool.query(
    `SELECT book_value_per_share FROM financial_ratios
     WHERE stock_id = ? AND book_value_per_share IS NOT NULL
     ORDER BY year DESC, quarter DESC LIMIT 1`,
    [stockId]
  );

  if (bvRows.length > 0) {
    const bv = parseFloat(bvRows[0].book_value_per_share);
    result.book_value = bv;
    if (bv > 0) {
      result.pb_ratio = (price / bv).toFixed(2);
    }
  }

  // 殖利率
  const [divRows] = await pool.query(
    `SELECT cash_dividend FROM dividends
     WHERE stock_id = ?
     ORDER BY year DESC LIMIT 1`,
    [stockId]
  );

  if (divRows.length > 0) {
    const cashDiv = parseFloat(divRows[0].cash_dividend) || 0;
    if (cashDiv > 0 && price > 0) {
      result.dividend_yield = (cashDiv / price * 100).toFixed(2);
    }
  }

  return result;
}

/**
 * EPS 成長趨勢
 */
async function analyzeEPSTrend(stockId) {
  const [rows] = await pool.query(
    `SELECT year, quarter, eps, revenue, net_income FROM financial_statements
     WHERE stock_id = ? AND eps IS NOT NULL
     ORDER BY year DESC, quarter DESC LIMIT 8`,
    [stockId]
  );

  if (rows.length === 0) return null;

  const data = rows.reverse();

  // 計算 YoY 同季比較
  const epsGrowth = [];
  for (let i = 4; i < data.length; i++) {
    const current = parseFloat(data[i].eps);
    const prev = parseFloat(data[i - 4].eps);
    if (prev !== 0) {
      epsGrowth.push({
        period: `${data[i].year}Q${data[i].quarter}`,
        eps: current,
        yoy_growth: (((current - prev) / Math.abs(prev)) * 100).toFixed(2)
      });
    }
  }

  // 近四季 EPS
  const recentEPS = data.slice(-4).map(r => ({
    period: `${r.year}Q${r.quarter}`,
    eps: parseFloat(r.eps)
  }));

  const epsTTM = recentEPS.reduce((s, r) => s + r.eps, 0);

  return {
    stock_id: stockId,
    eps_ttm: epsTTM.toFixed(2),
    quarterly_eps: recentEPS,
    yoy_growth: epsGrowth,
    trend: epsGrowth.length > 0 && parseFloat(epsGrowth[epsGrowth.length - 1].yoy_growth) > 0
      ? '成長' : '衰退'
  };
}

/**
 * 基本面綜合評分 (0-100)
 */
async function scoreFundamental(stockId) {
  let score = 50;
  const details = {};

  // 營收趨勢
  const revenue = await analyzeRevenueTrend(stockId, 6);
  if (revenue) {
    const yoy = parseFloat(revenue.latest_yoy);
    if (!isNaN(yoy)) {
      if (yoy > 20) score += 15;
      else if (yoy > 10) score += 10;
      else if (yoy > 0) score += 5;
      else if (yoy > -10) score -= 5;
      else score -= 10;
    }
    details.revenue_yoy = yoy;
    details.revenue_momentum = revenue.momentum;
  }

  // EPS
  const eps = await analyzeEPSTrend(stockId);
  if (eps) {
    const epsTTM = parseFloat(eps.eps_ttm);
    if (epsTTM > 0) score += 5;
    if (eps.yoy_growth.length > 0) {
      const lastGrowth = parseFloat(eps.yoy_growth[eps.yoy_growth.length - 1].yoy_growth);
      if (lastGrowth > 20) score += 10;
      else if (lastGrowth > 0) score += 5;
      else score -= 5;
    }
    details.eps_ttm = epsTTM;
    details.eps_trend = eps.trend;
  }

  // 估值
  const valuation = await calculateValuation(stockId);
  if (valuation) {
    const pe = parseFloat(valuation.pe_ratio);
    if (!isNaN(pe)) {
      if (pe > 0 && pe < 12) score += 10;      // 低本益比
      else if (pe >= 12 && pe < 20) score += 5; // 合理
      else if (pe >= 30) score -= 5;             // 偏高
    }

    const dy = parseFloat(valuation.dividend_yield);
    if (!isNaN(dy) && dy > 5) score += 5;

    details.pe_ratio = pe;
    details.dividend_yield = dy;
  }

  return {
    stock_id: stockId,
    score: Math.max(0, Math.min(100, Math.round(score))),
    details
  };
}

/**
 * 取得財報摘要
 */
async function getFinancialSummary(stockId) {
  const [fsRows] = await pool.query(
    `SELECT * FROM financial_statements
     WHERE stock_id = ? ORDER BY year DESC, quarter DESC LIMIT 4`,
    [stockId]
  );

  const [frRows] = await pool.query(
    `SELECT * FROM financial_ratios
     WHERE stock_id = ? ORDER BY year DESC, quarter DESC LIMIT 4`,
    [stockId]
  );

  const valuation = await calculateValuation(stockId);

  return {
    stock_id: stockId,
    financial_statements: fsRows,
    financial_ratios: frRows,
    valuation
  };
}

module.exports = {
  analyzeRevenueTrend,
  calculateValuation,
  analyzeEPSTrend,
  scoreFundamental,
  getFinancialSummary
};
