const axios = require('axios');
const { pool } = require('../database/connection');
const { fetchFinMindData } = require('./finmindApi');

/**
 * 抓取指定股票的每日股價資料（TWSE 上市）
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
        const val = parseFloat(str.replace(/,/g, ''));
        return isNaN(val) ? null : val;
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
 * 使用 FinMind 抓取指定股票（上市或上櫃）的每日股價資料
 * @param {string} stockId - 股票代號
 * @param {string} startDate - 開始日期 (YYYY-MM-DD)
 * @param {string} [endDate] - 結束日期 (YYYY-MM-DD)，預設今天
 */
async function fetchOTCDailyPrice(stockId, startDate, endDate) {
  try {
    const params = { data_id: stockId, start_date: startDate };
    if (endDate) params.end_date = endDate;

    const data = await fetchFinMindData('TaiwanStockPrice', params);
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`上櫃股票 ${stockId} 無資料`);
      return null;
    }

    return data.map(row => {
      const closePrice = row.close ?? null;
      const changeAmount = row.spread ?? null;
      let changePercent = null;
      if (closePrice != null && changeAmount != null) {
        const prevClose = closePrice - changeAmount;
        if (prevClose !== 0) {
          changePercent = (changeAmount / prevClose * 100).toFixed(2);
        }
      }
      return {
        stock_id: stockId,
        trade_date: row.date,
        open_price: row.open ?? null,
        high_price: row.max ?? null,
        low_price: row.min ?? null,
        close_price: closePrice,
        volume: row.Trading_Volume ?? null,
        turnover: row.Trading_money ?? null,
        transactions: row.Trading_turnover ?? null,
        change_amount: changeAmount,
        change_percent: changePercent
      };
    });
  } catch (error) {
    console.error(`抓取上櫃股票 ${stockId} 資料失敗:`, error.message);
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

/**
 * 抓取指定股票多個月份的股價資料
 * 先查 DB 最新日期，只補抓缺少的月份
 * @param {string} stockId - 股票代號
 * @param {number} months - 最多往回抓幾個月（預設 1，最大 12）
 */
async function fetchMultiMonthPrices(stockId, months = 1) {
  months = Math.min(Math.max(1, months), 12);

  // 查 DB 最新資料日期，決定實際需要抓幾個月
  const [latestRows] = await pool.query(
    'SELECT MAX(trade_date) AS latest FROM daily_prices WHERE stock_id = ?',
    [stockId]
  );
  const latestDate = latestRows[0].latest;
  const now = new Date();
  let monthsToFetch = months;

  if (latestDate) {
    const latest = new Date(latestDate);
    const gap = (now.getFullYear() - latest.getFullYear()) * 12
              + (now.getMonth() - latest.getMonth());
    // gap=0 → 本月已有資料，僅更新本月最新交易日
    // gap=1 → 上月有資料，只需抓本月
    // gap≥2 → 多個月缺口
    monthsToFetch = Math.min(gap + 1, months);
    monthsToFetch = Math.max(monthsToFetch, 1);
    if (gap === 0) {
      console.log(`[${stockId}] 資料已是本月，更新本月最新資料`);
    } else {
      console.log(`[${stockId}] 資料落後 ${gap} 個月，補抓 ${monthsToFetch} 個月（原請求 ${months} 個月）`);
    }
  } else {
    console.log(`[${stockId}] 無歷史資料，抓取近 ${months} 個月`);
  }

  console.log(`開始抓取 ${stockId} 近 ${monthsToFetch} 個月股價...`);

  const connection = await pool.getConnection();
  let totalRecords = 0;

  try {
    for (let i = 0; i < monthsToFetch; i++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const date = `${year}${month}01`;

      console.log(`  抓取 ${year}/${month} ...`);
      const records = await fetchDailyPrice(stockId, date);

      if (records && records.length > 0) {
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
        totalRecords += records.length;
        console.log(`  ✓ ${year}/${month} - ${records.length} 筆`);
      } else {
        console.log(`  ✗ ${year}/${month} - 無資料`);
      }

      // 每月之間加 3 秒延遲避免被 TWSE 封鎖
      if (i < monthsToFetch - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log(`完成！共抓取 ${totalRecords} 筆資料`);
    return totalRecords;
  } finally {
    connection.release();
  }
}

/**
 * 共用：將股價記錄批次寫入 DB
 */
async function savePricesToDb(connection, records) {
  for (const item of records) {
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
        item.stock_id, item.trade_date,
        item.open_price, item.high_price, item.low_price, item.close_price,
        item.volume, item.turnover, item.transactions,
        item.change_amount, item.change_percent
      ]
    );
  }
}

/**
 * 使用 TPEx Open API 一次抓取上櫃全市場最新交易日股價
 * API: https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes
 */
async function fetchOTCStocksLatestPrices(connection, validIds) {
  const url = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    },
    timeout: 30000
  });

  const data = response.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('TPEx Open API 無資料或格式錯誤');
  }

  const parseNumber = (str) => {
    if (!str || str === '--' || str === '') return null;
    const val = parseFloat(String(str).replace(/,/g, '').replace(/^\+/, ''));
    return isNaN(val) ? null : val;
  };

  // 解析上櫃日期格式（民國年 YYY/MM/DD）
  let tradeDate = null;
  const rawDate = data[0]?.Date;
  if (rawDate) {
    const parts = String(rawDate).split('/');
    if (parts.length === 3) {
      const year = parseInt(parts[0]) + 1911;
      tradeDate = `${year}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
  }
  if (!tradeDate) {
    tradeDate = new Date().toISOString().split('T')[0];
  }

  console.log(`TPEx Open API: 共 ${data.length} 檔，交易日期 ${tradeDate}`);

  const filteredData = data.filter(item => validIds.has(item.SecuritiesCompanyCode));
  console.log(`篩選後: ${filteredData.length} 檔上櫃股票`);

  const records = [];
  for (const item of filteredData) {
    const closePrice = parseNumber(item.Close);
    const changeAmount = parseNumber(item.Change);

    let changePercent = null;
    if (closePrice != null && changeAmount != null) {
      const prevClose = closePrice - changeAmount;
      if (prevClose !== 0) {
        changePercent = (changeAmount / prevClose * 100).toFixed(2);
      }
    }

    // TPEx volume 單位為股（部分端點可能是千股，實測後調整）
    const rawVolume = parseNumber(item.TradingShares);

    records.push({
      stock_id: item.SecuritiesCompanyCode,
      trade_date: tradeDate,
      open_price: parseNumber(item.Open),
      high_price: parseNumber(item.High),
      low_price: parseNumber(item.Low),
      close_price: closePrice,
      volume: rawVolume,
      turnover: parseNumber(item.TransactionAmount),
      transactions: parseNumber(item.Transaction),
      change_amount: changeAmount,
      change_percent: changePercent
    });
  }

  await savePricesToDb(connection, records);
  return { count: records.length, tradeDate };
}

/**
 * 使用 TWSE Open API 一次抓取全市場最新交易日股價
 * 同時抓取上市（TWSE）+ 上櫃（TPEx）
 * API: https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
 */
async function fetchAllStocksLatestPrices() {
  const url = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';

  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    },
    timeout: 30000
  });

  const data = response.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('TWSE Open API 無資料或格式錯誤');
  }

  const parseNumber = (str) => {
    if (!str || str === '--' || str === '') return null;
    const val = parseFloat(String(str).replace(/,/g, '').replace(/^\+/, ''));
    return isNaN(val) ? null : val;
  };

  // 取得交易日期，支援 YYYYMMDD 或 YYY/MM/DD（民國年）或 YYYY/MM/DD 格式
  let tradeDate = null;
  const rawDate = data[0]?.Date;
  if (rawDate) {
    const d = String(rawDate).replace(/\//g, '');
    if (d.length === 8 && parseInt(d.slice(0, 4)) > 1911) {
      // 西元年 YYYYMMDD
      tradeDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    } else if (d.length === 7) {
      // 民國年 YYYMMDD（例如 1150307）
      const year = parseInt(d.slice(0, 3)) + 1911;
      tradeDate = `${year}-${d.slice(3, 5)}-${d.slice(5, 7)}`;
    }
  }
  if (!tradeDate) {
    // 無日期欄位時用今天
    tradeDate = new Date().toISOString().split('T')[0];
  }

  console.log(`TWSE Open API: 共 ${data.length} 檔，交易日期 ${tradeDate}`);

  const connection = await pool.getConnection();
  let twseCount = 0;
  let otcCount = 0;

  try {
    // 只寫入 stocks 表已存在的股票，避免外鍵約束錯誤（ETF、權證等排除）
    const [validRows] = await connection.query('SELECT stock_id FROM stocks');
    const validIds = new Set(validRows.map(r => r.stock_id));
    const filteredData = data.filter(item => validIds.has(item.Code));
    console.log(`篩選後: ${filteredData.length} 檔上市股票（排除 ${data.length - filteredData.length} 檔 ETF/權證等）`);

    // 寫入上市股價
    const twseRecords = filteredData.map(item => {
      const closePrice = parseNumber(item.ClosingPrice);
      const changeAmount = parseNumber(item.Change);

      let changePercent = null;
      if (closePrice != null && changeAmount != null) {
        const prevClose = closePrice - changeAmount;
        if (prevClose !== 0) {
          changePercent = (changeAmount / prevClose * 100).toFixed(2);
        }
      }

      return {
        stock_id: item.Code,
        trade_date: tradeDate,
        open_price: parseNumber(item.OpeningPrice),
        high_price: parseNumber(item.HighestPrice),
        low_price: parseNumber(item.LowestPrice),
        close_price: closePrice,
        volume: parseNumber(item.TradeVolume),
        turnover: parseNumber(item.TradeValue),
        transactions: parseNumber(item.Transaction),
        change_amount: changeAmount,
        change_percent: changePercent
      };
    });

    await savePricesToDb(connection, twseRecords);
    twseCount = twseRecords.length;
    console.log(`完成！上市寫入 ${twseCount} 筆`);

    // 抓取並寫入上櫃股價
    try {
      const otcResult = await fetchOTCStocksLatestPrices(connection, validIds);
      otcCount = otcResult.count;
    } catch (otcError) {
      console.error('⚠ 上櫃股價抓取失敗（上市資料已寫入）:', otcError.message);
    }

    const totalCount = twseCount + otcCount;
    console.log(`全市場共寫入 ${totalCount} 筆（上市 ${twseCount} + 上櫃 ${otcCount}）`);
    return { count: totalCount, tradeDate };
  } finally {
    connection.release();
  }
}

/**
 * 智慧補抓：對全部股票補齊近 N 個月歷史資料
 * - 上市（TWSE）：按月呼叫 TWSE API，當月永遠重抓，舊月份只補缺口
 * - 上櫃（OTC）：每股一次 FinMind API 呼叫取全期間，效率更高
 *
 * @param {number} months - 往回幾個月（預設 6，最大 12）
 * @param {function} onProgress - 進度 callback(done, total, stockId)
 */
async function syncAllStocksHistory(months = 6, onProgress = null) {
  months = Math.min(Math.max(1, months), 12);
  const now = new Date();

  // 上市月份清單
  const monthList = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthList.push({
      yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      dateStr:   `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}01`,
      isCurrent: i === 0
    });
  }

  // 查詢 DB 中已有哪些 (stock_id, year_month) 組合（用於上市跳過判斷）
  const [existing] = await pool.query(
    `SELECT stock_id, DATE_FORMAT(trade_date, '%Y-%m') AS ym
     FROM daily_prices
     WHERE trade_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
     GROUP BY stock_id, ym`,
    [months + 1]
  );
  const existingSet = new Set(existing.map(r => `${r.stock_id}:${r.ym}`));

  // 上櫃 start_date：N 個月前的 1 號
  const startD = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const otcStartDate = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, '0')}-01`;

  // 取得全部股票（含 market_type）
  const [stocks] = await pool.query(
    'SELECT stock_id, market_type FROM stocks WHERE is_active = TRUE ORDER BY stock_id'
  );

  const connection = await pool.getConnection();
  let totalRecords = 0;
  let stocksDone  = 0;

  try {
    for (const { stock_id, market_type } of stocks) {
      if (market_type === '上櫃') {
        // 上櫃：一次 FinMind API 呼叫取全部月份
        const records = await fetchOTCDailyPrice(stock_id, otcStartDate);
        if (records && records.length > 0) {
          await savePricesToDb(connection, records);
          totalRecords += records.length;
        }
        // FinMind 有 rate limit，稍微等一下
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        // 上市：按月呼叫 TWSE API
        for (const { yearMonth, dateStr, isCurrent } of monthList) {
          const key = `${stock_id}:${yearMonth}`;
          if (!isCurrent && existingSet.has(key)) continue;

          const records = await fetchDailyPrice(stock_id, dateStr);
          if (records && records.length > 0) {
            await savePricesToDb(connection, records);
            totalRecords += records.length;
          }
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
      }

      stocksDone++;
      if (onProgress) onProgress(stocksDone, stocks.length, stock_id);

      // 每 20 檔多等 2 秒
      if (stocksDone % 20 === 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } finally {
    connection.release();
  }

  return { stocks: stocksDone, records: totalRecords };
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
  fetchOTCDailyPrice,
  fetchBatchDailyPrices,
  fetchRecentPrices,
  fetchMultiMonthPrices,
  fetchAllStocksLatestPrices,
  fetchOTCStocksLatestPrices,
  syncAllStocksHistory
};
