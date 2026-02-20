const axios = require('axios');
const { pool } = require('../database/connection');

/**
 * 抓取指定日期的三大法人買賣超資料
 * @param {string} date - YYYYMMDD 格式
 */
async function fetchInstitutionalTrading(date) {
  try {
    console.log(`抓取 ${date} 三大法人買賣超資料...`);

    const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${date}&selectType=ALL`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.data.stat !== 'OK' || !response.data.data) {
      console.log(`${date} 無三大法人資料（可能非交易日）`);
      return [];
    }

    const records = [];
    const tradeDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

    for (const row of response.data.data) {
      const stockId = row[0].trim();

      // 只處理 4 碼股票代號
      if (!/^\d{4}$/.test(stockId)) continue;

      const parseNum = (str) => {
        if (!str || str === '--') return 0;
        return parseInt(str.replace(/,/g, ''), 10) || 0;
      };

      // T86 欄位格式（19欄）:
      // [0]代號 [1]名稱
      // [2]外陸資買進 [3]外陸資賣出 [4]外陸資買賣超（不含外資自營商）
      // [5]外資自營商買進 [6]外資自營商賣出 [7]外資自營商買賣超
      // [8]投信買進 [9]投信賣出 [10]投信買賣超
      // [11]自營商買賣超合計 [12]自營商買進(自行) [13]自營商賣出(自行) [14]自營商買賣超(自行)
      // [15]自營商買進(避險) [16]自營商賣出(避險) [17]自營商買賣超(避險)
      // [18]三大法人買賣超合計
      records.push({
        stock_id: stockId,
        trade_date: tradeDate,
        foreign_buy: parseNum(row[2]),
        foreign_sell: parseNum(row[3]),
        foreign_net: parseNum(row[4]),
        trust_buy: parseNum(row[8]),
        trust_sell: parseNum(row[9]),
        trust_net: parseNum(row[10]),
        dealer_net: parseNum(row[11]),  // 自營商合計買賣超
        dealer_buy: parseNum(row[12]),  // 自營商自行買進
        dealer_sell: parseNum(row[13]), // 自營商自行賣出
        total_net: parseNum(row[18])    // 三大法人買賣超合計
      });
    }

    return records;

  } catch (error) {
    console.error(`抓取 ${date} 法人資料失敗:`, error.message);
    return [];
  }
}

/**
 * 抓取並存入資料庫
 * @param {string} date - YYYYMMDD 格式
 */
async function fetchAndSaveInstitutionalTrading(date) {
  const records = await fetchInstitutionalTrading(date);

  if (records.length === 0) {
    console.log('無資料可寫入');
    return 0;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 2026-02-20: 過濾掉 stocks 表不存在的 stock_id，避免 Foreign Key 錯誤
    const [stockRows] = await connection.query('SELECT stock_id FROM stocks');
    const validIds = new Set(stockRows.map(r => r.stock_id));
    const filteredRecords = records.filter(r => validIds.has(r.stock_id));
    console.log(`過濾後剩 ${filteredRecords.length}/${records.length} 筆（排除非上市股票）`);

    for (const r of filteredRecords) {
      await connection.query(
        `INSERT INTO institutional_trading
        (stock_id, trade_date, foreign_buy, foreign_sell, foreign_net,
         trust_buy, trust_sell, trust_net, dealer_buy, dealer_sell, dealer_net, total_net)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        foreign_buy = VALUES(foreign_buy), foreign_sell = VALUES(foreign_sell),
        foreign_net = VALUES(foreign_net), trust_buy = VALUES(trust_buy),
        trust_sell = VALUES(trust_sell), trust_net = VALUES(trust_net),
        dealer_buy = VALUES(dealer_buy), dealer_sell = VALUES(dealer_sell),
        dealer_net = VALUES(dealer_net), total_net = VALUES(total_net)`,
        [r.stock_id, r.trade_date, r.foreign_buy, r.foreign_sell, r.foreign_net,
         r.trust_buy, r.trust_sell, r.trust_net, r.dealer_buy, r.dealer_sell,
         r.dealer_net, r.total_net]
      );
    }

    await connection.commit();
    console.log(`✓ 成功寫入 ${filteredRecords.length} 筆法人買賣超資料`);
    return filteredRecords.length;

  } catch (error) {
    await connection.rollback();
    console.error('寫入法人資料失敗:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 抓取最近交易日的法人資料
 * 先查 DB 是否已有今日資料，有則跳過
 */
async function fetchRecentInstitutionalTrading() {
  const now = new Date();
  const date = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const tradeDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

  const [rows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM institutional_trading WHERE trade_date = ?',
    [tradeDate]
  );
  if (rows[0].cnt > 0) {
    console.log(`${tradeDate} 三大法人資料已存在，跳過`);
    return 0;
  }

  return await fetchAndSaveInstitutionalTrading(date);
}

if (require.main === module) {
  const dateArg = process.argv[2];
  const fn = dateArg
    ? () => fetchAndSaveInstitutionalTrading(dateArg)
    : fetchRecentInstitutionalTrading;

  fn()
    .then(() => { console.log('完成！'); process.exit(0); })
    .catch(error => { console.error(error); process.exit(1); });
}

module.exports = {
  fetchInstitutionalTrading,
  fetchAndSaveInstitutionalTrading,
  fetchRecentInstitutionalTrading
};
