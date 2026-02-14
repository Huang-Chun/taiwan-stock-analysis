const axios = require('axios');
const { pool } = require('../database/connection');

/**
 * 抓取指定年度的除權息資料
 * @param {number} year - 西元年
 */
async function fetchDividends(year) {
  try {
    const rocYear = year - 1911;
    console.log(`抓取 ${year} 年除權息資料...`);

    // TWSE 除權息預告表
    const url = `https://www.twse.com.tw/rwd/zh/exRight/TWT49U?response=json&startDate=${year}0101&endDate=${year}1231`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.data.stat !== 'OK' || !response.data.data) {
      console.log(`${year} 年無除權息資料`);
      return [];
    }

    const records = [];
    const seen = new Map(); // 同一年一檔股票可能多次配息，累加

    for (const row of response.data.data) {
      const stockId = row[0].trim();
      if (!/^\d{4}$/.test(stockId)) continue;

      const parseNum = (str) => {
        if (!str || str === '--' || str.trim() === '') return 0;
        return parseFloat(str.replace(/,/g, '')) || 0;
      };

      // 解析民國日期
      const parseDateStr = (str) => {
        if (!str || str === '--') return null;
        const parts = str.trim().split('/');
        if (parts.length !== 3) return null;
        const y = parseInt(parts[0]) + 1911;
        return `${y}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      };

      const cashDividend = parseNum(row[3]);
      const stockDividend = parseNum(row[4]);
      const exDividendDate = parseDateStr(row[1]);
      const exRightDate = parseDateStr(row[2]);

      const key = `${stockId}-${year}`;
      if (seen.has(key)) {
        const existing = seen.get(key);
        existing.cash_dividend += cashDividend;
        existing.stock_dividend += stockDividend;
        existing.total_dividend = existing.cash_dividend + existing.stock_dividend;
      } else {
        const record = {
          stock_id: stockId,
          year: year,
          cash_dividend: cashDividend,
          stock_dividend: stockDividend,
          total_dividend: cashDividend + stockDividend,
          ex_dividend_date: exDividendDate,
          ex_right_date: exRightDate,
          dividend_yield: null,
          payout_ratio: null
        };
        seen.set(key, record);
      }
    }

    return Array.from(seen.values());

  } catch (error) {
    console.error(`抓取 ${year} 年股利資料失敗:`, error.message);
    return [];
  }
}

/**
 * 抓取並存入資料庫
 */
async function fetchAndSaveDividends(year) {
  const records = await fetchDividends(year);

  if (records.length === 0) {
    console.log('無股利資料可寫入');
    return 0;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const r of records) {
      // 嘗試取得殖利率（用除息前一日收盤價計算）
      if (r.ex_dividend_date && r.cash_dividend > 0) {
        const [priceRows] = await connection.query(
          `SELECT close_price FROM daily_prices
           WHERE stock_id = ? AND trade_date <= ? ORDER BY trade_date DESC LIMIT 1`,
          [r.stock_id, r.ex_dividend_date]
        );
        if (priceRows.length > 0) {
          const price = parseFloat(priceRows[0].close_price);
          if (price > 0) {
            r.dividend_yield = ((r.cash_dividend / price) * 100).toFixed(2);
          }
        }
      }

      await connection.query(
        `INSERT INTO dividends
        (stock_id, year, cash_dividend, stock_dividend, total_dividend,
         ex_dividend_date, ex_right_date, dividend_yield, payout_ratio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        cash_dividend = VALUES(cash_dividend), stock_dividend = VALUES(stock_dividend),
        total_dividend = VALUES(total_dividend), ex_dividend_date = VALUES(ex_dividend_date),
        ex_right_date = VALUES(ex_right_date), dividend_yield = VALUES(dividend_yield),
        payout_ratio = VALUES(payout_ratio)`,
        [r.stock_id, r.year, r.cash_dividend, r.stock_dividend, r.total_dividend,
         r.ex_dividend_date, r.ex_right_date, r.dividend_yield, r.payout_ratio]
      );
    }

    await connection.commit();
    console.log(`✓ 成功寫入 ${records.length} 筆股利資料`);
    return records.length;

  } catch (error) {
    await connection.rollback();
    console.error('寫入股利資料失敗:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

async function fetchRecentDividends() {
  const year = new Date().getFullYear();
  return await fetchAndSaveDividends(year);
}

if (require.main === module) {
  const yearArg = process.argv[2] ? parseInt(process.argv[2]) : null;
  const fn = yearArg
    ? () => fetchAndSaveDividends(yearArg)
    : fetchRecentDividends;

  fn()
    .then(() => { console.log('完成！'); process.exit(0); })
    .catch(error => { console.error(error); process.exit(1); });
}

module.exports = {
  fetchDividends,
  fetchAndSaveDividends,
  fetchRecentDividends
};
