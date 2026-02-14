const axios = require('axios');
const { pool } = require('../database/connection');

/**
 * 從 MOPS 抓取指定年/季的綜合損益表資料（上市公司）
 * @param {number} year - 西元年
 * @param {number} quarter - 季度 (1-4)
 */
async function fetchFinancialStatements(year, quarter) {
  try {
    const rocYear = year - 1911;
    console.log(`抓取 ${year} Q${quarter} 財報資料...`);

    // MOPS AJAX API - 綜合損益表
    const url = 'https://mops.twse.com.tw/mops/web/ajax_t163sb04';

    const response = await axios.post(url,
      `encodeURIComponent=1&step=1&firstin=1&off=1&isQuery=Y&TYPEK=sii&year=${rocYear}&season=0${quarter}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const records = parseFinancialHTML(response.data, year, quarter);
    return records;

  } catch (error) {
    console.error(`抓取 ${year} Q${quarter} 財報失敗:`, error.message);
    return [];
  }
}

/**
 * 解析 MOPS 回傳的 HTML 表格
 */
function parseFinancialHTML(html, year, quarter) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const records = [];

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 8) return;

    const stockId = $(cells[0]).text().trim();
    if (!/^\d{4}$/.test(stockId)) return;

    const parseNum = (str) => {
      if (!str || str === 'N/A' || str.trim() === '') return null;
      const cleaned = str.replace(/,/g, '').replace(/\(/g, '-').replace(/\)/g, '');
      const val = parseFloat(cleaned);
      return isNaN(val) ? null : val;
    };

    records.push({
      stock_id: stockId,
      year: year,
      quarter: quarter,
      report_type: '合併',
      revenue: parseNum($(cells[2]).text()),
      operating_cost: parseNum($(cells[3]).text()),
      gross_profit: parseNum($(cells[4]).text()),
      operating_expense: parseNum($(cells[5]).text()),
      operating_income: parseNum($(cells[6]).text()),
      non_operating_income: parseNum($(cells[7]).text()),
      pretax_income: parseNum($(cells[8]).text()),
      net_income: parseNum($(cells[9]).text()),
      eps: parseNum($(cells[10]).text())
    });
  });

  return records;
}

/**
 * 抓取並存入資料庫
 */
async function fetchAndSaveFinancialStatements(year, quarter) {
  const records = await fetchFinancialStatements(year, quarter);

  if (records.length === 0) {
    console.log('無財報資料可寫入');
    return 0;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const r of records) {
      // 寫入 financial_statements
      await connection.query(
        `INSERT INTO financial_statements
        (stock_id, year, quarter, report_type, revenue, operating_cost, gross_profit,
         operating_expense, operating_income, non_operating_income, pretax_income,
         net_income, eps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        report_type = VALUES(report_type), revenue = VALUES(revenue),
        operating_cost = VALUES(operating_cost), gross_profit = VALUES(gross_profit),
        operating_expense = VALUES(operating_expense), operating_income = VALUES(operating_income),
        non_operating_income = VALUES(non_operating_income), pretax_income = VALUES(pretax_income),
        net_income = VALUES(net_income), eps = VALUES(eps)`,
        [r.stock_id, r.year, r.quarter, r.report_type, r.revenue, r.operating_cost,
         r.gross_profit, r.operating_expense, r.operating_income, r.non_operating_income,
         r.pretax_income, r.net_income, r.eps]
      );

      // 計算並寫入 financial_ratios
      if (r.revenue && r.revenue !== 0) {
        const grossMargin = r.gross_profit ? (r.gross_profit / r.revenue * 100) : null;
        const operatingMargin = r.operating_income ? (r.operating_income / r.revenue * 100) : null;
        const netMargin = r.net_income ? (r.net_income / r.revenue * 100) : null;

        await connection.query(
          `INSERT INTO financial_ratios
          (stock_id, year, quarter, gross_margin, operating_margin, net_margin)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
          gross_margin = VALUES(gross_margin), operating_margin = VALUES(operating_margin),
          net_margin = VALUES(net_margin)`,
          [r.stock_id, r.year, r.quarter, grossMargin, operatingMargin, netMargin]
        );
      }
    }

    await connection.commit();
    console.log(`✓ 成功寫入 ${records.length} 筆財報資料`);
    return records.length;

  } catch (error) {
    await connection.rollback();
    console.error('寫入財報資料失敗:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 抓取最近季度的財報
 */
async function fetchRecentFinancialStatements() {
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.ceil(now.getMonth() / 3); // 當前季度
  // 財報通常延後一季公佈
  quarter -= 1;
  if (quarter <= 0) {
    year -= 1;
    quarter = 4;
  }
  return await fetchAndSaveFinancialStatements(year, quarter);
}

if (require.main === module) {
  const yearArg = process.argv[2] ? parseInt(process.argv[2]) : null;
  const quarterArg = process.argv[3] ? parseInt(process.argv[3]) : null;

  const fn = (yearArg && quarterArg)
    ? () => fetchAndSaveFinancialStatements(yearArg, quarterArg)
    : fetchRecentFinancialStatements;

  fn()
    .then(() => { console.log('完成！'); process.exit(0); })
    .catch(error => { console.error(error); process.exit(1); });
}

module.exports = {
  fetchFinancialStatements,
  fetchAndSaveFinancialStatements,
  fetchRecentFinancialStatements
};
