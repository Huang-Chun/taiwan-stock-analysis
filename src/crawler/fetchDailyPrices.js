const axios = require('axios');
const { pool } = require('../database/connection');

/**
 * 抓取指定股票的每日股價資料
 * @param {string} stockId - 股票代號
 * @param {string} date - 日期 (YYYYMMDD 格式)
 */
async function fetchDailyPrice(stockId, date) {
  try {
    // 台灣證交所個股日成交資訊 API
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${stockId}`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.data.stat !== 'OK') {
      console.log(`股票 ${stockId} 無資料`);
      return null;
    }

    const data = response.data.data;
    const records = [];

    for (const row of data) {
      const [
        dateStr,        // 日期
        volume,         // 成交股數
        turnover,       // 成交金額
        open,           // 開盤價
        high,           // 最高價
        low,            // 最低價
        close,          // 收盤價
        change,         // 漲跌價差
        transactions    // 成交筆數
      ] = row;

      // 轉換日期格式 (民國年/月/日 -> YYYY-MM-DD)
      const [year, month, day] = dateStr.split('/');
      const tradeDate = `${parseInt(year) + 1911}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

      // 處理逗號和轉換數字
      const parseNumber = (str) => {
        if (!str || str === '--') return null;
        return parseFloat(str.replace(/,/g, ''));
      };

      const record = {
        stock_id: stockId,
        trade_date: tradeDate,
        open_price: parseNumber(open),
        high_price: parseNumber(high),
        low_price: parseNumber(low),
        close_price: parseNumber(close),
        volume: parseNumber(volume),
        turnover: parseNumber(turnover),
        transactions: parseNumber(transactions),
        change_amount: parseNumber(change),
        change_percent: null // 需要計算
      };

      // 計算漲跌幅
      if (record.close_price && record.change_amount) {
        const prevClose = record.close_price - record.change_amount;
        if (prevClose !== 0) {
          record.change_percent = (record.change_amount / prevClose * 100).toFixed(2);
        }
      }

      records.push(record);
    }

    return records;

  } catch (error) {
    console.error(`抓取股票 ${stockId} 資料失敗:`, error.message);
    return null;
  }
}

/**
 * 批次抓取多檔股票的資料
 * @param {Array} stockIds - 股票代號陣列
 * @param {string} date - 日期 (YYYYMMDD)
 */
async function fetchBatchDailyPrices(stockIds, date) {
  console.log(`開始抓取 ${stockIds.length} 檔股票的 ${date} 資料...`);
  
  const connection = await pool.getConnection();
  let successCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < stockIds.length; i++) {
      const stockId = stockIds[i];
      
      // 避免請求太快被擋，加入延遲
      if (i > 0 && i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      const records = await fetchDailyPrice(stockId, date);
      
      if (records && records.length > 0) {
        // 寫入資料庫
        for (const record of records) {
          await connection.query(
            `INSERT INTO daily_prices 
            (stock_id, trade_date, open_price, high_price, low_price, close_price, 
             volume, turnover, transactions, change_amount, change_percent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            open_price = VALUES(open_price),
            high_price = VALUES(high_price),
            low_price = VALUES(low_price),
            close_price = VALUES(close_price),
            volume = VALUES(volume),
            turnover = VALUES(turnover),
            transactions = VALUES(transactions),
            change_amount = VALUES(change_amount),
            change_percent = VALUES(change_percent)`,
            [
              record.stock_id, record.trade_date, record.open_price, 
              record.high_price, record.low_price, record.close_price,
              record.volume, record.turnover, record.transactions,
              record.change_amount, record.change_percent
            ]
          );
        }
        successCount++;
        console.log(`✓ [${i + 1}/${stockIds.length}] ${stockId} - 成功 (${records.length} 筆)`);
      } else {
        failCount++;
        console.log(`✗ [${i + 1}/${stockIds.length}] ${stockId} - 無資料`);
      }
    }

    console.log(`\n完成！成功: ${successCount}, 失敗: ${failCount}`);

  } catch (error) {
    console.error('批次抓取失敗:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 抓取最近一個月的資料（示範用）
 */
async function fetchRecentPrices() {
  try {
    const connection = await pool.getConnection();
    
    // 取得前 10 檔股票（示範用，可改成全部）
    const [stocks] = await connection.query(
      'SELECT stock_id FROM stocks WHERE is_active = TRUE LIMIT 10'
    );
    connection.release();

    const stockIds = stocks.map(s => s.stock_id);
    
    // 取得當前年月（YYYYMM 格式）
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = `${year}${month}01`;

    await fetchBatchDailyPrices(stockIds, date);

  } catch (error) {
    console.error('抓取資料失敗:', error);
    throw error;
  }
}

// 如果直接執行此檔案
if (require.main === module) {
  fetchRecentPrices()
    .then(() => {
      console.log('完成！');
      process.exit(0);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  fetchDailyPrice,
  fetchBatchDailyPrices,
  fetchRecentPrices
};
