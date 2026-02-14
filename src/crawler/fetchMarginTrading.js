const axios = require('axios');
const { pool } = require('../database/connection');

/**
 * 抓取指定日期的融資融券資料
 * @param {string} date - YYYYMMDD 格式
 */
async function fetchMarginTrading(date) {
  try {
    console.log(`抓取 ${date} 融資融券資料...`);

    const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${date}&selectType=ALL`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.data.stat !== 'OK' || !response.data.tables) {
      console.log(`${date} 無融資融券資料（可能非交易日）`);
      return [];
    }

    // MI_MARGN 回傳的 tables 陣列，個股資料通常在 tables[1]
    const table = response.data.tables.find(t => t.data && t.data.length > 0 && t.fields && t.fields.length >= 12);
    if (!table) {
      console.log(`${date} 融資融券資料格式不符`);
      return [];
    }

    const records = [];
    const tradeDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

    for (const row of table.data) {
      const stockId = row[0].trim();
      if (!/^\d{4}$/.test(stockId)) continue;

      const parseNum = (str) => {
        if (!str || str === '--' || str === '') return 0;
        return parseInt(str.replace(/,/g, ''), 10) || 0;
      };

      records.push({
        stock_id: stockId,
        trade_date: tradeDate,
        margin_buy: parseNum(row[1]),
        margin_sell: parseNum(row[2]),
        margin_balance: parseNum(row[4]),
        margin_limit: parseNum(row[6]),
        short_sell: parseNum(row[7]),
        short_buy: parseNum(row[8]),
        short_balance: parseNum(row[10]),
        short_limit: parseNum(row[12]),
        offset_volume: parseNum(row[13])
      });
    }

    return records;

  } catch (error) {
    console.error(`抓取 ${date} 融資融券資料失敗:`, error.message);
    return [];
  }
}

/**
 * 抓取並存入資料庫
 */
async function fetchAndSaveMarginTrading(date) {
  const records = await fetchMarginTrading(date);

  if (records.length === 0) {
    console.log('無資料可寫入');
    return 0;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const r of records) {
      await connection.query(
        `INSERT INTO margin_trading
        (stock_id, trade_date, margin_buy, margin_sell, margin_balance, margin_limit,
         short_buy, short_sell, short_balance, short_limit, offset_volume)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        margin_buy = VALUES(margin_buy), margin_sell = VALUES(margin_sell),
        margin_balance = VALUES(margin_balance), margin_limit = VALUES(margin_limit),
        short_buy = VALUES(short_buy), short_sell = VALUES(short_sell),
        short_balance = VALUES(short_balance), short_limit = VALUES(short_limit),
        offset_volume = VALUES(offset_volume)`,
        [r.stock_id, r.trade_date, r.margin_buy, r.margin_sell, r.margin_balance,
         r.margin_limit, r.short_buy, r.short_sell, r.short_balance, r.short_limit,
         r.offset_volume]
      );
    }

    await connection.commit();
    console.log(`✓ 成功寫入 ${records.length} 筆融資融券資料`);
    return records.length;

  } catch (error) {
    await connection.rollback();
    console.error('寫入融資融券資料失敗:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

async function fetchRecentMarginTrading() {
  const now = new Date();
  const date = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  return await fetchAndSaveMarginTrading(date);
}

if (require.main === module) {
  const dateArg = process.argv[2];
  const fn = dateArg
    ? () => fetchAndSaveMarginTrading(dateArg)
    : fetchRecentMarginTrading;

  fn()
    .then(() => { console.log('完成！'); process.exit(0); })
    .catch(error => { console.error(error); process.exit(1); });
}

module.exports = {
  fetchMarginTrading,
  fetchAndSaveMarginTrading,
  fetchRecentMarginTrading
};
