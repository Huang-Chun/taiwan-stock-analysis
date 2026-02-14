const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { pool } = require('../database/connection');

/**
 * 抓取指定年月的月營收資料（上市公司）
 * @param {number} year - 西元年
 * @param {number} month - 月份 (1-12)
 */
async function fetchMonthlyRevenue(year, month) {
  try {
    const rocYear = year - 1911;
    console.log(`抓取 ${year}/${month} 月營收資料...`);

    const url = `https://mops.twse.com.tw/nas/t21/sii/t21sc03_${rocYear}_${month}_0.html`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      responseType: 'arraybuffer'
    });

    const html = iconv.decode(Buffer.from(response.data), 'big5');
    const $ = cheerio.load(html);
    const records = [];

    $('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 10) return;

      const stockId = $(cells[0]).text().trim();
      if (!/^\d{4}$/.test(stockId)) return;

      const parseNum = (str) => {
        if (!str || str === 'N/A' || str === '') return null;
        return parseFloat(str.replace(/,/g, '')) || null;
      };

      records.push({
        stock_id: stockId,
        year: year,
        month: month,
        revenue: parseNum($(cells[2]).text().trim()),
        revenue_mom: parseNum($(cells[5]).text().trim()),
        revenue_yoy: parseNum($(cells[6]).text().trim()),
        cumulative_revenue: parseNum($(cells[7]).text().trim()),
        cumulative_yoy: parseNum($(cells[8]).text().trim())
      });
    });

    return records;

  } catch (error) {
    console.error(`抓取 ${year}/${month} 月營收失敗:`, error.message);
    return [];
  }
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
