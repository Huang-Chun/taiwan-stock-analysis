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

/**
 * PEG = PE ÷ EPS成長率。成長率用「TTM EPS 對比一年前的TTM EPS」，不是單季年增率——
 * 單季/單一年度的成長率如果剛好是景氣循環反彈的一次性數字，PEG會被嚴重低估(看起來假便宜)，
 * TTM對TTM至少把季節性跟單季雜訊磨掉一些，但還是要配合稼動率觀察的健康判讀確認這個成長是不是真的可持續。
 */
async function analyzePEG(stockId) {
  const [priceRows] = await pool.query(
    'SELECT close_price FROM daily_prices WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 1', [stockId]
  );
  if (!priceRows.length) return null;
  const price = parseFloat(priceRows[0].close_price);

  const [epsRows] = await pool.query(
    `SELECT year, quarter, eps FROM financial_statements
     WHERE stock_id = ? AND eps IS NOT NULL ORDER BY year DESC, quarter DESC LIMIT 8`,
    [stockId]
  );
  if (epsRows.length < 8) return null; // 湊不出「現在TTM」跟「一年前TTM」兩個完整窗口

  const quartersNow = epsRows.slice(0, 4).map(r => ({ year: r.year, quarter: r.quarter, eps: parseFloat(r.eps) }));
  const quartersYearAgo = epsRows.slice(4, 8).map(r => ({ year: r.year, quarter: r.quarter, eps: parseFloat(r.eps) }));
  const ttmNow = quartersNow.reduce((s, r) => s + r.eps, 0);
  const ttmYearAgo = quartersYearAgo.reduce((s, r) => s + r.eps, 0);
  if (ttmNow <= 0 || ttmYearAgo <= 0) return null; // 虧損期間PE/PEG都沒有意義

  const peRatio = +(price / ttmNow).toFixed(2);
  const epsGrowthPct = +((ttmNow - ttmYearAgo) / ttmYearAgo * 100).toFixed(2);
  const peg = epsGrowthPct > 0 ? +(peRatio / epsGrowthPct).toFixed(2) : null;

  return {
    price, ttm_eps: +ttmNow.toFixed(2), ttm_eps_year_ago: +ttmYearAgo.toFixed(2),
    eps_growth_pct: epsGrowthPct, pe_ratio: peRatio, peg,
    quarters_now: quartersNow, quarters_year_ago: quartersYearAgo,
  };
}

/**
 * 同業比較：同一個產業地圖下所有覆蓋股票的PE，跟中位數/平均比，看這檔股票在同業裡貴不貴
 */
async function analyzePeerValuation(stockId) {
  const [[profile]] = await pool.query('SELECT industry_map_id FROM company_profiles WHERE stock_id=?', [stockId]);
  if (!profile?.industry_map_id) return null;

  const [peers] = await pool.query(
    `SELECT cp.stock_id, s.stock_name FROM company_profiles cp
     JOIN stocks s ON cp.stock_id = s.stock_id
     WHERE cp.industry_map_id = ? AND cp.is_coverage_active = 1
     ORDER BY cp.stock_id`,
    [profile.industry_map_id]
  );
  if (peers.length < 2) return null; // 只有自己一檔，比較沒有意義

  const rows = [];
  for (const p of peers) {
    const v = await calculateValuation(p.stock_id);
    if (!v?.pe_ratio) continue;
    const peg = await analyzePEG(p.stock_id);
    rows.push({
      stock_id: p.stock_id, stock_name: p.stock_name,
      pe_ratio: parseFloat(v.pe_ratio),
      eps_growth_pct: peg?.eps_growth_pct ?? null,
      peg: peg?.peg ?? null,
    });
  }
  if (!rows.length) return null;

  const peValues = rows.map(r => r.pe_ratio).sort((a, b) => a - b);
  const median = peValues[Math.floor(peValues.length / 2)];
  const average = +(peValues.reduce((s, v) => s + v, 0) / peValues.length).toFixed(2);

  const pegValues = rows.map(r => r.peg).filter(v => v != null).sort((a, b) => a - b);
  const pegMedian = pegValues.length ? pegValues[Math.floor(pegValues.length / 2)] : null;
  const pegAverage = pegValues.length ? +(pegValues.reduce((s, v) => s + v, 0) / pegValues.length).toFixed(2) : null;

  const self = rows.find(r => r.stock_id === stockId);

  return {
    peers: rows, median, average, self_pe: self?.pe_ratio ?? null,
    peg_median: pegMedian, peg_average: pegAverage, self_peg: self?.peg ?? null,
  };
}

// 財報法定公佈截止日，跟 fetchFinancialStatements.js 的 DEADLINES 同一套規則：
// 這一季的 EPS 要等到這個日期才「公開可知」，PE河流圖用這個日期決定某一天該套用哪一季的TTM EPS，
// 避免用「當時市場還不知道」的未來財報數字回推PE，造成不存在的look-ahead bias
const REPORT_DEADLINES = { 1: '05-15', 2: '08-14', 3: '11-14', 4: '03-31' };
function quarterKnownDate(year, quarter) {
  const deadlineYear = quarter === 4 ? year + 1 : year;
  return `${deadlineYear}-${REPORT_DEADLINES[quarter]}`;
}

/**
 * 本益比河流圖：用「當時市場已知的TTM EPS」對每個月底股價算歷史PE，
 * 讓你看現在的PE落在自己歷史區間的哪個位置，而不是只看單一個PE數字
 */
async function analyzePEBand(stockId) {
  const [epsRows] = await pool.query(
    `SELECT year, quarter, eps FROM financial_statements
     WHERE stock_id = ? AND eps IS NOT NULL ORDER BY year, quarter`,
    [stockId]
  );
  if (epsRows.length < 4) return null;

  // 每一季算一次「以這季為最新一季」的TTM EPS(近4季加總)，並標記市場從哪一天開始知道這個數字，
  // quarters 留著每一季的明細(哪一季、EPS多少)，前端要能列出「這個PE是哪4季加總算出來的」
  const ttmPoints = [];
  for (let i = 3; i < epsRows.length; i++) {
    const window = epsRows.slice(i - 3, i + 1);
    const ttmEps = window.reduce((s, r) => s + parseFloat(r.eps), 0);
    const latest = window[3];
    ttmPoints.push({
      knownFrom: quarterKnownDate(latest.year, latest.quarter),
      ttmEps,
      quarters: window.map(r => ({ year: r.year, quarter: r.quarter, eps: parseFloat(r.eps) })),
    });
  }
  if (!ttmPoints.length) return null;

  // 每月最後一個交易日的收盤價，跟同期已知的TTM EPS配對算PE
  const [priceRows] = await pool.query(
    `SELECT trade_date, close_price FROM daily_prices
     WHERE stock_id = ? ORDER BY trade_date`,
    [stockId]
  );
  if (!priceRows.length) return null;

  const monthlyLast = new Map(); // 'YYYY-MM' -> 該月最後一筆
  for (const r of priceRows) {
    monthlyLast.set(r.trade_date.slice(0, 7), r);
  }

  const series = [];
  for (const [ym, r] of monthlyLast) {
    const date = r.trade_date;
    // 找出這一天已經知道的最新一筆TTM EPS(knownFrom <= date，取最後一筆)
    let applicable = null;
    for (const p of ttmPoints) {
      if (p.knownFrom <= date) applicable = p; else break;
    }
    if (!applicable || applicable.ttmEps <= 0) continue; // 虧損季不算PE，比率沒有意義
    const price = parseFloat(r.close_price);
    series.push({
      date, price, ttm_eps: +applicable.ttmEps.toFixed(2), pe: +(price / applicable.ttmEps).toFixed(2),
      quarters: applicable.quarters,
    });
  }
  series.sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length) return null;

  const peValues = series.map(s => s.pe).sort((a, b) => a - b);
  const min = peValues[0];
  const max = peValues[peValues.length - 1];
  const median = peValues[Math.floor(peValues.length / 2)];
  const current = series[series.length - 1].pe;
  const percentile = Math.round((peValues.filter(v => v <= current).length / peValues.length) * 100);

  return { series, stats: { min, max, median, current, percentile, count: series.length } };
}

/**
 * 情境推估：不假裝知道下一季實際數字，而是用「這檔股票自己歷史上真的發生過的
 * 營收/COGS落差」當三種情境的依據(樂觀/中性/保守)，套在一個營收假設上，看毛利率
 * 各自會落在哪裡——營收假設可以由使用者自己輸入(例如聽到報價消息後自己的判斷)，
 * 沒給的話預設沿用最新一季自己的營收QoQ。
 * EPS只做粗略換算(用最新一季「毛利轉換成EPS」的比例去等比例推，不重新拆解營業費用/稅率)，
 * 精確度遠低於毛利率情境本身，UI上要跟毛利率情境分開標示信任度。
 */
async function analyzeScenarios(stockId, revenueQoqOverride) {
  const [rows] = await pool.query(
    `SELECT year, quarter, revenue, operating_cost, gross_profit, net_income, eps FROM financial_statements
     WHERE stock_id = ? AND revenue IS NOT NULL AND operating_cost IS NOT NULL
     ORDER BY year, quarter`,
    [stockId]
  );
  if (rows.length < 5) return null; // 至少要4組QoQ才能歸納出情境

  const data = rows.map(r => ({
    ...r,
    revenue: parseFloat(r.revenue), operating_cost: parseFloat(r.operating_cost),
    gross_profit: r.gross_profit != null ? parseFloat(r.gross_profit) : null,
    net_income: r.net_income != null ? parseFloat(r.net_income) : null,
    eps: r.eps != null ? parseFloat(r.eps) : null,
  }));

  // 每一季算「營收QoQ 減 COGS QoQ」的落差(正值=COGS漲得比營收慢，對毛利率有利)，
  // 這是情境的唯一依據，每個數字都對應到這檔股票自己真實發生過的某一季
  const gaps = [];
  for (let i = 1; i < data.length; i++) {
    const cur = data[i], prev = data[i - 1];
    if (prev.revenue === 0 || prev.operating_cost === 0) continue;
    const revenueQoq = (cur.revenue - prev.revenue) / Math.abs(prev.revenue) * 100;
    const cogsQoq = (cur.operating_cost - prev.operating_cost) / Math.abs(prev.operating_cost) * 100;
    gaps.push({ year: cur.year, quarter: cur.quarter, gap: +(revenueQoq - cogsQoq).toFixed(2) });
  }
  if (gaps.length < 3) return null;

  const sorted = [...gaps].sort((a, b) => a.gap - b.gap);
  const best = sorted[sorted.length - 1];   // 落差最大 = 對毛利率最有利的一季
  const worst = sorted[0];                   // 落差最小(甚至負) = 對毛利率最不利的一季
  const medianIdx = Math.floor(sorted.length / 2);
  const median = sorted[medianIdx];

  const latest = data[data.length - 1];
  if (latest.revenue <= 0 || latest.operating_cost <= 0 || latest.gross_profit == null) return null;
  const prev = data[data.length - 2];
  const latestRevenueQoq = prev.revenue !== 0 ? (latest.revenue - prev.revenue) / Math.abs(prev.revenue) * 100 : 0;
  const revenueQoqAssumed = revenueQoqOverride != null ? revenueQoqOverride : +latestRevenueQoq.toFixed(2);

  // 毛利轉EPS的粗略比例：用最新一季「淨利/毛利」當固定係數，不重新拆解營業費用跟稅率，
  // 只是等比例縮放，精確度遠低於毛利率情境本身
  const epsPerGrossProfit = (latest.net_income != null && latest.eps != null && latest.gross_profit > 0)
    ? latest.eps / latest.gross_profit : null;

  const buildScenario = (label, source) => {
    const cogsQoq = +(revenueQoqAssumed - source.gap).toFixed(2);
    const revenueNext = latest.revenue * (1 + revenueQoqAssumed / 100);
    const cogsNext = latest.operating_cost * (1 + cogsQoq / 100);
    const grossProfitNext = revenueNext - cogsNext;
    const grossMarginNext = revenueNext !== 0 ? +(grossProfitNext / revenueNext * 100).toFixed(2) : null;
    const epsNext = epsPerGrossProfit != null ? +(grossProfitNext * epsPerGrossProfit).toFixed(2) : null;
    return {
      label, based_on: `${source.year}Q${source.quarter}`, gap_used: source.gap,
      revenue_qoq: revenueQoqAssumed, cogs_qoq: cogsQoq,
      revenue_next: Math.round(revenueNext), gross_profit_next: Math.round(grossProfitNext),
      gross_margin_next: grossMarginNext, eps_next: epsNext,
    };
  };

  return {
    latest_period: `${latest.year}Q${latest.quarter}`,
    latest_revenue: Math.round(latest.revenue), latest_gross_margin: +(latest.gross_profit / latest.revenue * 100).toFixed(2),
    revenue_qoq_assumed: revenueQoqAssumed, revenue_qoq_is_default: revenueQoqOverride == null,
    scenarios: [
      buildScenario('樂觀（報價驅動再現）', best),
      buildScenario('中性（維持現狀）', median),
      buildScenario('保守（成本壓力）', worst),
    ],
  };
}

/**
 * 財務體質：負債比/流動比率/ROE/ROA/營業利益率/淨利率——都是 financial_ratios 早就算好、
 * 但目前沒有任何頁面顯示出來的欄位，這裡只是把現成資料端出來，不是新計算。
 * 只看損益表(毛利率/COGS)看不到的東西：有沒有負債風險、賺錢效率好不好、短期償債能力夠不夠。
 */
// 判讀標準：常見經驗法則，不是放諸四海皆準的真理，資本密集/景氣循環產業本身水位會偏離這些門檻，
// 重點是「知道自己在哪個區間、知道趨勢往哪走」，不是把單一門檻當成鐵律
const HEALTH_THRESHOLDS = {
  roe: { good: 15, ok: 8, unit: '%', note: '年化(TTM)股東權益報酬率——≥15%優異，8~15%中等，<8%偏弱。景氣循環股本身波動大，看趨勢比看單一數字重要' },
  roa: { good: 8, ok: 4, unit: '%', note: '年化(TTM)資產報酬率——≥8%優異，4~8%中等，<4%偏弱。天生比ROE低(分母含負債)，重資產產業偏低不代表公司不好' },
  current_ratio: { good: 200, ok: 100, unit: '%', note: '流動資產÷流動負債——≥200%寬鬆，100~200%健康，<100%短期償債能力吃緊需要留意' },
  debt_ratio: { good: 40, ok: 60, unit: '%', reverse: true, note: '總負債÷總資產——<40%保守，40~60%常見，>60%槓桿偏高。資本密集產業(例如半導體)因為要蓋廠買設備，負債比天生偏高不算異常，重點是有沒有持續往上衝' },
};
function assessMetric(key, value) {
  const t = HEALTH_THRESHOLDS[key];
  if (!t || value == null) return null;
  if (t.reverse) return value <= t.good ? 'healthy' : value <= t.ok ? 'neutral' : 'unhealthy';
  return value >= t.good ? 'healthy' : value >= t.ok ? 'neutral' : 'unhealthy';
}

async function getFinancialHealth(stockId, quarters = 8) {
  const [ratioRows] = await pool.query(
    `SELECT year, quarter, operating_margin, net_margin, current_ratio, debt_ratio
     FROM financial_ratios WHERE stock_id = ? ORDER BY year DESC, quarter DESC LIMIT ?`,
    [stockId, quarters]
  );
  if (!ratioRows.length) return null;

  // ROE/ROA 官方沒有現成的年化(TTM)版本，只有單季——自己拉近4季淨利加總，除以當期期末權益/資產算出來
  const [fsRows] = await pool.query(
    `SELECT year, quarter, net_income, equity, total_assets FROM financial_statements
     WHERE stock_id = ? AND net_income IS NOT NULL ORDER BY year, quarter`,
    [stockId]
  );
  const fsMap = new Map(fsRows.map(r => [`${r.year}Q${r.quarter}`, r]));
  const fsList = fsRows; // 已經是年季正序

  function ttmRoeRoa(year, quarter) {
    const idx = fsList.findIndex(r => r.year === year && r.quarter === quarter);
    if (idx < 3) return { ttm_roe: null, ttm_roa: null };
    const window = fsList.slice(idx - 3, idx + 1);
    const ttmNetIncome = window.reduce((s, r) => s + parseFloat(r.net_income), 0);
    const cur = fsMap.get(`${year}Q${quarter}`);
    const equity = cur?.equity != null ? parseFloat(cur.equity) : null;
    const assets = cur?.total_assets != null ? parseFloat(cur.total_assets) : null;
    return {
      ttm_roe: equity ? +(ttmNetIncome / equity * 100).toFixed(2) : null,
      ttm_roa: assets ? +(ttmNetIncome / assets * 100).toFixed(2) : null,
    };
  }

  const series = ratioRows.reverse().map(r => ({
    period: `${r.year}Q${r.quarter}`,
    ...ttmRoeRoa(r.year, r.quarter),
    operating_margin: r.operating_margin != null ? parseFloat(r.operating_margin) : null,
    net_margin: r.net_margin != null ? parseFloat(r.net_margin) : null,
    current_ratio: r.current_ratio != null ? parseFloat(r.current_ratio) : null,
    debt_ratio: r.debt_ratio != null ? parseFloat(r.debt_ratio) : null,
  }));

  const latest = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const trend = (field) => prev && latest[field] != null && prev[field] != null
    ? +(latest[field] - prev[field]).toFixed(2) : null;

  return {
    series, latest,
    trend: {
      ttm_roe: trend('ttm_roe'), ttm_roa: trend('ttm_roa'), operating_margin: trend('operating_margin'),
      net_margin: trend('net_margin'), current_ratio: trend('current_ratio'), debt_ratio: trend('debt_ratio'),
    },
    assessment: {
      roe: assessMetric('roe', latest.ttm_roe), roa: assessMetric('roa', latest.ttm_roa),
      current_ratio: assessMetric('current_ratio', latest.current_ratio),
      debt_ratio: assessMetric('debt_ratio', latest.debt_ratio),
    },
    thresholds: HEALTH_THRESHOLDS,
  };
}

module.exports = {
  analyzeRevenueTrend,
  calculateValuation,
  analyzeEPSTrend,
  getFinancialSummary,
  analyzeCostStructure,
  analyzePEBand,
  analyzePEG,
  analyzePeerValuation,
  analyzeScenarios,
  getFinancialHealth
};
