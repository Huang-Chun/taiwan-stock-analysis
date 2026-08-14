const { pool } = require('../database/connection');
const { fetchFinMindData } = require('./finmindApi');

/**
 * 從 FinMind 抓取指定年月的月營收資料
 * @param {number} year - 西元年
 * @param {number} month - 月份 (1-12)
 */
/**
 * 將 FinMind 原始 rows 轉為月營收 records
 */
function buildRevenueRecords(rows, year, month) {
  const records = [];
  for (const row of rows) {
    if (!/^\d{4}$/.test(row.stock_id)) continue;

    // FinMind revenue_month 是 1-based (1=Jan, 12=Dec)，revenue_year 是實際營收年
    const rowMonth = row.revenue_month;
    const rowYear = row.revenue_year;

    if (rowYear !== year || rowMonth !== month) continue;

    records.push({
      stock_id: row.stock_id,
      year: year,
      month: month,
      revenue: row.revenue || null,
      revenue_mom: null,
      revenue_yoy: null,
      cumulative_revenue: null,
      cumulative_yoy: null,
    });
  }
  return records;
}

/**
 * 計算報告月份（營收在次月公佈，date 欄位為次月 1 日）
 */
function reportingDateRange(year, month) {
  let rYear = year;
  let rMonth = month + 1;
  if (rMonth > 12) { rYear += 1; rMonth = 1; }
  const mm = String(rMonth).padStart(2, '0');
  return {
    start_date: `${rYear}-${mm}-01`,
    end_date: `${rYear}-${mm}-28`,
  };
}

/**
 * 從 FinMind 抓取月營收
 * - 先嘗試批次（不帶 data_id），失敗則逐檔
 * - 可傳入 stockId 只抓單檔
 */
async function fetchMonthlyRevenue(year, month, stockId) {
  try {
    if (!process.env.FINMIND_TOKEN) {
      console.error('錯誤：需要設定 FINMIND_TOKEN 環境變數。');
      console.error('請至 https://finmindtrade.com/ 免費註冊取得 token，並加入 .env 檔案');
      return [];
    }

    console.log(`抓取 ${year}/${month} 月營收資料 (FinMind)...`);

    const dateRange = reportingDateRange(year, month);
    let allRows = [];

    if (stockId) {
      allRows = await fetchFinMindData('TaiwanStockMonthRevenue', { ...dateRange, data_id: stockId });
    } else {
      try {
        allRows = await fetchFinMindData('TaiwanStockMonthRevenue', dateRange);
      } catch (batchErr) {
        console.log(`  批次模式不可用: ${batchErr.message}`);
        console.log(`  免費帳號將逐檔抓取覆蓋清單（company_profiles.is_coverage_active = 1）。升級 FinMind 帳號可一次抓取全部。`);

        const [dbRows] = await pool.query('SELECT stock_id FROM company_profiles WHERE is_coverage_active = 1 ORDER BY stock_id');
        const stockIds = dbRows.map(r => r.stock_id);
        console.log(`  共 ${stockIds.length} 檔（覆蓋清單），開始抓取...`);

        let consecutiveFails = 0;
        for (let i = 0; i < stockIds.length; i++) {
          try {
            const rows = await fetchFinMindData('TaiwanStockMonthRevenue', { ...dateRange, data_id: stockIds[i] });
            allRows.push(...rows);
            consecutiveFails = 0;
          } catch (err) {
            if (err.message && err.message.includes('402')) {
              consecutiveFails++;
              if (consecutiveFails > 5) {
                console.error(`  API 頻率限制，已抓取 ${i} 檔後停止。請稍後再執行。`);
                break;
              }
              console.warn(`  頻率限制，等待 15 秒... (${consecutiveFails}/5)`);
              await new Promise(r => setTimeout(r, 15000));
              i--;
            }
          }
          if ((i + 1) % 100 === 0) console.log(`  進度: ${i + 1}/${stockIds.length}`);
        }
      }
    }

    const records = buildRevenueRecords(allRows, year, month);
    console.log(`  取得 ${records.length} 筆月營收資料`);
    return records;

  } catch (error) {
    console.error(`抓取 ${year}/${month} 月營收失敗:`, error.message);
    return [];
  }
}

/**
 * 用 SQL 從 DB 歷史資料計算月增率、年增率、累計營收
 */
async function calculateGrowthRates(connection, year, month) {
  // 月增率 (MoM)：與上個月比較
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth <= 0) { prevYear -= 1; prevMonth = 12; }

  await connection.query(
    `UPDATE monthly_revenue cur
     LEFT JOIN monthly_revenue prev
       ON cur.stock_id = prev.stock_id
       AND prev.year = ? AND prev.month = ?
     SET cur.revenue_mom = CASE
       WHEN prev.revenue IS NOT NULL AND prev.revenue != 0
       THEN ROUND((cur.revenue - prev.revenue) / prev.revenue * 100, 2)
       ELSE NULL END
     WHERE cur.year = ? AND cur.month = ?`,
    [prevYear, prevMonth, year, month]
  );

  // 年增率 (YoY)：與去年同月比較
  await connection.query(
    `UPDATE monthly_revenue cur
     LEFT JOIN monthly_revenue prev
       ON cur.stock_id = prev.stock_id
       AND prev.year = ? AND prev.month = ?
     SET cur.revenue_yoy = CASE
       WHEN prev.revenue IS NOT NULL AND prev.revenue != 0
       THEN ROUND((cur.revenue - prev.revenue) / prev.revenue * 100, 2)
       ELSE NULL END
     WHERE cur.year = ? AND cur.month = ?`,
    [year - 1, month, year, month]
  );

  // 累計營收：當年 1 月到當月的加總
  await connection.query(
    `UPDATE monthly_revenue cur
     SET cur.cumulative_revenue = (
       SELECT SUM(m.revenue)
       FROM (SELECT stock_id, revenue FROM monthly_revenue
             WHERE year = ? AND month <= ?) m
       WHERE m.stock_id = cur.stock_id
     )
     WHERE cur.year = ? AND cur.month = ?`,
    [year, month, year, month]
  );

  // 累計年增率：與去年同期累計比較
  await connection.query(
    `UPDATE monthly_revenue cur
     SET cur.cumulative_yoy = (
       SELECT CASE
         WHEN prev_sum IS NOT NULL AND prev_sum != 0
         THEN ROUND((cur.cumulative_revenue - prev_sum) / prev_sum * 100, 2)
         ELSE NULL END
       FROM (
         SELECT stock_id, SUM(revenue) AS prev_sum
         FROM monthly_revenue
         WHERE year = ? AND month <= ?
         GROUP BY stock_id
       ) prev
       WHERE prev.stock_id = cur.stock_id
     )
     WHERE cur.year = ? AND cur.month = ?`,
    [year - 1, month, year, month]
  );
}

/**
 * 抓取並存入資料庫
 * @param {number} year
 * @param {number} month
 * @param {string} [stockId] - 指定股票代號（可選）
 */
async function fetchAndSaveMonthlyRevenue(year, month, stockId) {
  const records = await fetchMonthlyRevenue(year, month, stockId);

  if (records.length === 0) {
    console.log('無資料可寫入');
    return 0;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const r of records) {
      await connection.query(
        `INSERT INTO monthly_revenue
        (stock_id, year, month, revenue, revenue_mom, revenue_yoy, cumulative_revenue, cumulative_yoy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        revenue = VALUES(revenue), revenue_mom = VALUES(revenue_mom),
        revenue_yoy = VALUES(revenue_yoy), cumulative_revenue = VALUES(cumulative_revenue),
        cumulative_yoy = VALUES(cumulative_yoy)`,
        [r.stock_id, r.year, r.month, r.revenue, r.revenue_mom, r.revenue_yoy,
         r.cumulative_revenue, r.cumulative_yoy]
      );
    }

    await connection.commit();
    console.log(`✓ 成功寫入 ${records.length} 筆月營收資料`);

    // 寫入後計算增率
    console.log('計算月增率/年增率/累計營收...');
    await calculateGrowthRates(connection, year, month);
    console.log('✓ 增率計算完成');

    return records.length;

  } catch (error) {
    await connection.rollback();
    console.error('寫入月營收資料失敗:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 計算兩個 [year, month] 之間相差幾個月
 */
function monthDiff(fromYear, fromMonth, toYear, toMonth) {
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * 從 [year, month] 往前推 n 個月，回傳 [year, month]
 */
function subtractMonths(year, month, n) {
  let m = month - n;
  let y = year + Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return [y, m];
}

/**
 * 抓取月營收，自動偵測歷史缺口並循序補抓
 *
 * - 指定 stockId：偵測 [起始月, 目標月] 範圍內「實際缺哪些月份」並補抓——不是只看最新月份，
 *   避免只往未來延伸、永遠不會回頭補中間或最前面缺口的問題（例如某檔股票只有近期資料、
 *   更早的歷史完全沒有，YoY 會因此永遠算不出來，之前就是這樣被抓到）
 * - 全新股票（DB完全沒有這檔的月營收）會多抓 12 個月當基期，讓範圍內最早的月份也有
 *   去年同期資料可以算YoY，不然新加入覆蓋清單的股票，前一整年的YoY都會是空值
 * - 補完缺口後，範圍內每個月的成長率一律重算一次（不管是不是這次新抓的）——
 *   因為抓取當下鄰月/去年同月可能還沒進資料庫，算出來的MoM/YoY/累計會卡在null，
 *   只重算「新抓的那個月」不夠，要連同已存在但可能因此變得可算的鄰近月份一起重算
 * - 不指定 stockId：對框架覆蓋清單（company_profiles.is_coverage_active=1）逐檔重用單股邏輯，
 *   確保每一檔都各自補到最新，不會被其他檔的完整度掩蓋
 *
 * @param {string} [stockId] - 指定股票代號（可選）
 * @param {number} [backfillMonths=14] - 最多往回補幾個月（預設 14 個月，全新股票會再多抓 12 個月當YoY基期）
 */
async function fetchRecentMonthlyRevenue(stockId, backfillMonths = 14) {
  // 目標月份：上個月（月營收在次月公佈）
  const now = new Date();
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth(); // 0-based = 上個月
  if (targetMonth === 0) { targetYear -= 1; targetMonth = 12; }

  if (stockId) {
    // --- 單股模式：偵測範圍內實際缺口，循序補抓，再整段重算成長率 ---
    // 「需不需要多抓12個月當YoY基期」不能只看有沒有資料（count=0），也不能只比對到
    // 一般範圍的起點——範圍內「最舊」那個月要有YoY，資料要回溯到「範圍起點再往前12個月」，
    // 不然一般 backfillMonths 範圍裡只有最後2個月能算出YoY，其餘全是空值（實測發現的）
    const normalStart = subtractMonths(targetYear, targetMonth, backfillMonths - 1);
    const baselineNeededFrom = subtractMonths(normalStart[0], normalStart[1], 12);
    const [[{ earliest }]] = await pool.query(
      'SELECT MIN(year * 100 + month) AS earliest FROM monthly_revenue WHERE stock_id = ?', [stockId]
    );
    const needsBaseline = earliest == null || earliest > baselineNeededFrom[0] * 100 + baselineNeededFrom[1];
    const depth = backfillMonths + (needsBaseline ? 12 : 0);
    const [startYear, startMonth] = subtractMonths(targetYear, targetMonth, depth - 1);

    const [existingRows] = await pool.query(
      `SELECT year, month FROM monthly_revenue WHERE stock_id = ?
       AND (year > ? OR (year = ? AND month >= ?))
       AND (year < ? OR (year = ? AND month <= ?))`,
      [stockId, startYear, startYear, startMonth, targetYear, targetYear, targetMonth]
    );
    const existing = new Set(existingRows.map(r => `${r.year}-${r.month}`));

    const missing = [];
    for (let y = startYear, m = startMonth; y < targetYear || (y === targetYear && m <= targetMonth); m++) {
      if (m > 12) { y++; m = 1; if (y > targetYear || (y === targetYear && m > targetMonth)) break; }
      if (!existing.has(`${y}-${m}`)) missing.push([y, m]);
    }

    if (!missing.length) {
      console.log(`${stockId} 月營收在補抓範圍內（${startYear}/${startMonth}~${targetYear}/${targetMonth}）已完整，跳過`);
      return 0;
    }

    console.log(`${stockId} 月營收缺 ${missing.length} 個月（範圍 ${startYear}/${startMonth}~${targetYear}/${targetMonth}），循序補抓...`);

    let total = 0;
    for (const [y, m] of missing) {
      total += await fetchAndSaveMonthlyRevenue(y, m, stockId);
    }

    // 整段範圍重算一次成長率，修掉抓取順序造成的殘留空值
    const connection = await pool.getConnection();
    try {
      for (let y = startYear, m = startMonth; y < targetYear || (y === targetYear && m <= targetMonth); m++) {
        if (m > 12) { y++; m = 1; if (y > targetYear || (y === targetYear && m > targetMonth)) break; }
        await calculateGrowthRates(connection, y, m);
      }
    } finally {
      connection.release();
    }

    return total;

  } else {
    // --- 覆蓋清單模式：逐檔重用單股邏輯，各自偵測缺口並補抓 ---
    // （原本用「整體 80% 完整度」判斷有沒有缺口，會被其他檔的完整度掩蓋個別股票的缺口——
    // 例如 20 檔裡只有 1 檔缺當月資料，其餘 19 檔已達 80% 門檻，就永遠不會補到那 1 檔）
    const [stockRows] = await pool.query(
      'SELECT stock_id FROM company_profiles WHERE is_coverage_active = 1 ORDER BY stock_id'
    );
    let total = 0;
    for (const { stock_id } of stockRows) {
      total += await fetchRecentMonthlyRevenue(stock_id, backfillMonths);
    }
    return total;
  }
}

if (require.main === module) {
  const yearArg = process.argv[2] ? parseInt(process.argv[2]) : null;
  const monthArg = process.argv[3] ? parseInt(process.argv[3]) : null;

  const fn = (yearArg && monthArg)
    ? () => fetchAndSaveMonthlyRevenue(yearArg, monthArg)
    : fetchRecentMonthlyRevenue;

  fn()
    .then(() => { console.log('完成！'); process.exit(0); })
    .catch(error => { console.error(error); process.exit(1); });
}

/**
 * 給定某股票目前已有資料的最新月份，推算「下一個月」營收的公告截止日
 * 月營收公告期限：次月10日前
 * @param {number|null} latestYear
 * @param {number|null} latestMonth
 */
function getNextRevenueDeadline(latestYear, latestMonth) {
  let year, month;
  if (!latestYear || !latestMonth) {
    // 尚無資料：以上個月當基準
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth(); // 0-based = 上個月
    if (month === 0) { year -= 1; month = 12; }
  } else {
    year = latestYear; month = latestMonth + 1;
    if (month > 12) { year += 1; month = 1; }
  }

  let dueYear = year, dueMonth = month + 1;
  if (dueMonth > 12) { dueYear += 1; dueMonth = 1; }
  return { year, month, expected_date: `${dueYear}-${String(dueMonth).padStart(2, '0')}-10` };
}

module.exports = {
  fetchMonthlyRevenue,
  fetchAndSaveMonthlyRevenue,
  fetchRecentMonthlyRevenue,
  getNextRevenueDeadline
};
