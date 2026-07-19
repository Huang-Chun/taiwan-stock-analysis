require('dotenv').config();
const { fetchYahooPrice, fetchDailyPrice, fetchOTCDailyPrice } = require('../src/crawler/fetchDailyPrices');
const { pool } = require('../src/database/connection');

const START_DATE = '2026-04-11';
const END_DATE = '2026-05-03';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function saveRecords(connection, records) {
  for (const r of records) {
    await connection.query(
      `INSERT INTO daily_prices
      (stock_id, trade_date, open_price, high_price, low_price, close_price,
       volume, turnover, transactions, change_amount, change_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      open_price = VALUES(open_price), high_price = VALUES(high_price),
      low_price = VALUES(low_price), close_price = VALUES(close_price),
      volume = VALUES(volume), turnover = VALUES(turnover),
      transactions = VALUES(transactions), change_amount = VALUES(change_amount),
      change_percent = VALUES(change_percent)`,
      [r.stock_id, r.trade_date, r.open_price, r.high_price, r.low_price, r.close_price,
       r.volume, r.turnover, r.transactions, r.change_amount, r.change_percent]
    );
  }
}

async function main() {
  const [stocks] = await pool.query(
    'SELECT stock_id, market_type FROM stocks WHERE is_active = TRUE ORDER BY stock_id'
  );
  console.log(`共 ${stocks.length} 檔股票，回補 ${START_DATE} ~ ${END_DATE}`);

  const connection = await pool.getConnection();
  let done = 0, totalRecords = 0, yahooFails = 0, fallbackFails = 0;

  try {
    for (const { stock_id, market_type } of stocks) {
      let records = null;
      try {
        records = await fetchYahooPrice(stock_id, START_DATE, END_DATE, market_type);
      } catch (e) {
        yahooFails++;
      }

      if (records && records.length > 0) {
        await saveRecords(connection, records);
        totalRecords += records.length;
      } else {
        try {
          if (market_type === '上櫃') {
            const r = await fetchOTCDailyPrice(stock_id, START_DATE, END_DATE);
            if (r?.length) { await saveRecords(connection, r); totalRecords += r.length; }
          } else {
            const r = await fetchDailyPrice(stock_id, START_DATE.replace(/-/g, '').slice(0, 6) + '01');
            const filtered = (r || []).filter(x => x.trade_date >= START_DATE && x.trade_date <= END_DATE);
            if (filtered.length) { await saveRecords(connection, filtered); totalRecords += filtered.length; }
          }
        } catch (e) {
          fallbackFails++;
        }
      }

      done++;
      if (done % 100 === 0 || done === stocks.length) {
        console.log(`  進度 ${done}/${stocks.length} (最新: ${stock_id}, 累計 ${totalRecords} 筆)`);
      }
      await sleep(300);
    }
  } finally {
    connection.release();
  }

  console.log(`完成！${stocks.length} 檔股票，共補 ${totalRecords} 筆，Yahoo 失敗 ${yahooFails}，備援也失敗 ${fallbackFails}`);
  await pool.end();
}

main()
  .then(() => { console.log('全部完成！'); process.exit(0); })
  .catch(e => { console.error('腳本執行失敗:', e); process.exit(1); });
