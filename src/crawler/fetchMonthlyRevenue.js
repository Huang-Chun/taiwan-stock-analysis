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
        console.log(`  免費帳號將逐檔抓取。升級 FinMind 帳號可一次抓取全部。`);

        const [dbRows] = await pool.query('SELECT stock_id FROM stocks WHERE is_active = 1 ORDER BY stock_id');
        const stockIds = dbRows.map(r => r.stock_id);
        console.log(`  共 ${stockIds.length} 檔，開始抓取...`);

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
 */
async function fetchAndSaveMonthlyRevenue(year, month) {
  const records = await fetchMonthlyRevenue(year, month);

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
 * 抓取最近月份的月營收
 */
async function fetchRecentMonthlyRevenue() {
  // 月營收通常在次月 10 號後公佈，抓前一個月
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-based, 所以就是上個月
  if (month === 0) {
    year -= 1;
    month = 12;
  }
  return await fetchAndSaveMonthlyRevenue(year, month);
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

module.exports = {
  fetchMonthlyRevenue,
  fetchAndSaveMonthlyRevenue,
  fetchRecentMonthlyRevenue
};
