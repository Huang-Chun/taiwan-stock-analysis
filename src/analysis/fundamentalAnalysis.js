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
 * 估值指標計算（PE/PB，僅供參考，框架不以此為結論依據）
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

// 營收/毛利率的九宮格分類：3(營收方向) x 3(毛利率方向)。毛利率有沒有惡化是唯一的健康紅線，
// 營收方向只負責解釋「為什麼」（報價/量增/成本），不影響健不健康的判定。
const FLAT_REVENUE = 1.5; // 百分點，營收QoQ小於這個視為持平
const FLAT_MARGIN = 0.5;  // 百分點，毛利率變動小於這個視為持平
const TREND_LABELS = {
  up:   { up: '量增/稼動率提升', flat: '量增但毛利率沒跟上（假性成長，留意是否被成本抵銷或純轉嫁）', down: '營收成長但單位成本侵蝕毛利' },
  flat: { up: '成本改善，量未明顯變化', flat: '持平，無明顯訊號', down: '單位成本上升，量沒動' },
  down: { up: '量縮但守住價格（防禦性）', flat: '量縮，成本同步收縮', down: '量縮＋固定成本僵固（最需留意）' },
};

function classifyTrend(revenue_qoq, operating_cost_qoq, margin_change) {
  if (revenue_qoq == null || margin_change == null) return null;
  const revenue_direction = revenue_qoq > FLAT_REVENUE ? 'up' : revenue_qoq < -FLAT_REVENUE ? 'down' : 'flat';
  const margin_direction = margin_change > FLAT_MARGIN ? 'up' : margin_change < -FLAT_MARGIN ? 'down' : 'flat';
  const health = margin_direction === 'up' ? 'healthy' : margin_direction === 'down' ? 'unhealthy' : 'neutral';

  // 「營收漲、毛利率也漲」這一格是唯一報價/量增分不出來的情況（兩者都會讓這兩個方向同時是up），
  // 只有這一格需要另外檢查 COGS 自己有沒有動，其他格子用 revenue_direction/margin_direction 就夠判斷
  let trend_label;
  if (revenue_direction === 'up' && margin_direction === 'up') {
    const cogsMoved = operating_cost_qoq != null && Math.abs(operating_cost_qoq) > FLAT_REVENUE;
    trend_label = cogsMoved ? '量增/稼動率提升' : '報價驅動（COGS幾乎沒動，量沒有明顯增加）';
  } else {
    trend_label = TREND_LABELS[revenue_direction][margin_direction];
  }
  return { revenue_direction, margin_direction, health, trend_label };
}

/**
 * 每季的營收/COGS/毛利率結構，加上自動分類（報價 vs 量增 vs 成本 vs 混合）
 * 毛利只有季資料（財報揭露頻率），跟月營收的月頻率不同，這裡固定用季度
 */
async function analyzeCostStructure(stockId, quarters = 8) {
  const [rows] = await pool.query(
    `SELECT year, quarter, revenue, gross_profit, operating_cost FROM financial_statements
     WHERE stock_id = ? AND revenue IS NOT NULL AND gross_profit IS NOT NULL
     ORDER BY year DESC, quarter DESC LIMIT ?`,
    [stockId, quarters + 1] // 多抓一季，才能算出最舊那一季的 QoQ
  );

  if (rows.length < 2) return null;

  const data = rows.reverse().map(r => ({
    ...r, revenue: parseFloat(r.revenue), gross_profit: parseFloat(r.gross_profit),
    operating_cost: r.operating_cost != null ? parseFloat(r.operating_cost) : null,
  }));

  const result = [];
  let prevMargin = data[0].revenue !== 0 ? (data[0].gross_profit / data[0].revenue * 100) : null;

  for (let i = 1; i < data.length; i++) {
    const cur = data[i], prev = data[i - 1];
    const gross_margin = cur.revenue !== 0 ? (cur.gross_profit / cur.revenue * 100) : null;
    const revenue_qoq = prev.revenue !== 0 ? ((cur.revenue - prev.revenue) / Math.abs(prev.revenue) * 100) : null;
    // COGS 只受出貨量影響、不受售價影響——這是唯一能把「量」單獨拆出來看的乾淨訊號
    const operating_cost_qoq = (cur.operating_cost != null && prev.operating_cost != null && prev.operating_cost !== 0)
      ? ((cur.operating_cost - prev.operating_cost) / Math.abs(prev.operating_cost) * 100) : null;
    const margin_change = (gross_margin != null && prevMargin != null) ? gross_margin - prevMargin : null;

    result.push({
      year: cur.year, quarter: cur.quarter,
      revenue: cur.revenue, gross_profit: cur.gross_profit,
      gross_margin: gross_margin != null ? +gross_margin.toFixed(2) : null,
      revenue_qoq: revenue_qoq != null ? +revenue_qoq.toFixed(2) : null,
      operating_cost_qoq: operating_cost_qoq != null ? +operating_cost_qoq.toFixed(2) : null,
      margin_change: margin_change != null ? +margin_change.toFixed(2) : null,
      ...classifyTrend(revenue_qoq, operating_cost_qoq, margin_change),
    });
    prevMargin = gross_margin;
  }
  return result;
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
  getFinancialSummary,
  analyzeCostStructure
};
