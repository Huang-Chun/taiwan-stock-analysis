const axios = require('axios');
const { pool } = require('../database/connection');
const { fetchFinMindData } = require('./finmindApi');

/**
 * 用 Yahoo Finance 抓取任意日期區間的股價（上市用 .TW，上櫃用 .TWO）
 * @param {string} stockId - 股票代號
 * @param {string} startDate - 開始日期 YYYY-MM-DD
 * @param {string} endDate - 結束日期 YYYY-MM-DD
 * @param {string} marketType - '上市' | '上櫃'
 */
async function fetchYahooPrice(stockId, startDate, endDate, marketType) {
  const suffix = marketType === '上櫃' ? '.TWO' : '.TW';
  const symbol = stockId + suffix;
  const period1 = Math.floor(new Date(startDate).getTime() / 1000);
  const period2 = Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000);

  const response = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,
    {
      params: { interval: '1d', period1, period2 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com',
      },
      timeout: 15000,
    }
  );

  const result = response.data?.chart?.result?.[0];
  if (!result?.timestamp?.length) return [];

  const timestamps = result.timestamp;
  const q = result.indicators.quote[0];

  const records = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = q.close?.[i];
    if (close == null) continue;

    // 轉換為台灣日期（UTC+8）
    const tradeDate = new Date((timestamps[i] + 8 * 3600) * 1000)
      .toISOString().slice(0, 10);

    const open  = q.open?.[i]   != null ? parseFloat(q.open[i].toFixed(2))  : null;
    const high  = q.high?.[i]   != null ? parseFloat(q.high[i].toFixed(2))  : null;
    const low   = q.low?.[i]    != null ? parseFloat(q.low[i].toFixed(2))   : null;
    const closeParsed = parseFloat(close.toFixed(2));
    const volume = q.volume?.[i] ?? null;

    // 計算漲跌（與前一筆比較）
    let changeAmount = null;
    let changePercent = null;
    if (records.length > 0) {
      const prevClose = records[records.length - 1].close_price;
      if (prevClose) {
        changeAmount = parseFloat((closeParsed - prevClose).toFixed(2));
        changePercent = parseFloat((changeAmount / prevClose * 100).toFixed(2));
      }
    }

    records.push({
      stock_id: stockId,
      trade_date: tradeDate,
      open_price: open,
      high_price: high,
      low_price: low,
      close_price: closeParsed,
      volume,
      turnover: null,   // Yahoo 無成交金額
      transactions: null,
      change_amount: changeAmount,
      change_percent: changePercent,
    });
  }
  return records;
}

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

  // 查 DB 最新資料日期與市場類型
  const [[latestRow], [stockRow]] = await Promise.all([
    pool.query('SELECT MAX(trade_date) AS latest FROM daily_prices WHERE stock_id = ?', [stockId]),
    pool.query('SELECT market_type FROM stocks WHERE stock_id = ?', [stockId])
  ]);
  const latestDate = latestRow[0].latest;
  const marketType = stockRow[0]?.market_type || '上市';
  const now = new Date();
  let monthsToFetch = months;

  if (latestDate) {
    const latest = new Date(latestDate);
    const gap = (now.getFullYear() - latest.getFullYear()) * 12
              + (now.getMonth() - latest.getMonth());
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

  console.log(`開始抓取 ${stockId}（${marketType}）近 ${monthsToFetch} 個月股價...`);

  const startD = new Date(now.getFullYear(), now.getMonth() - monthsToFetch + 1, 1);
  const startDate = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, '0')}-01`;
  const endDate = now.toISOString().slice(0, 10);

  const connection = await pool.getConnection();
  let totalRecords = 0;

  try {
    const records = await fetchYahooPrice(stockId, startDate, endDate, marketType);
    if (records && records.length > 0) {
      await savePricesToDb(connection, records);
      totalRecords = records.length;
      console.log(`  ✓ Yahoo Finance ${records.length} 筆（${startDate} ~ ${endDate}）`);
    } else {
      console.log(`  ✗ Yahoo Finance 無資料，嘗試原始 API...`);
      // 備援：上市用 TWSE，上櫃用 FinMind
      if (marketType === '上櫃') {
        const r = await fetchOTCDailyPrice(stockId, startDate);
        if (r?.length) { await savePricesToDb(connection, r); totalRecords = r.length; }
      } else {
        for (let i = 0; i < monthsToFetch; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}01`;
          const r = await fetchDailyPrice(stockId, dateStr);
          if (r?.length) { await savePricesToDb(connection, r); totalRecords += r.length; }
          if (i < monthsToFetch - 1) await new Promise(res => setTimeout(res, 1200));
        }
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

  const startD = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const startDate = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, '0')}-01`;
  const endDate = now.toISOString().slice(0, 10);

  // 查詢哪些股票在該區間有缺口（latest_date < endDate 或完全無資料）
  const [stockRows] = await pool.query(
    `SELECT s.stock_id, s.market_type,
            MAX(dp.trade_date) AS latest_date
     FROM stocks s
     LEFT JOIN daily_prices dp
       ON s.stock_id = dp.stock_id
       AND dp.trade_date >= ?
     WHERE s.is_active = TRUE
     GROUP BY s.stock_id, s.market_type
     HAVING latest_date IS NULL OR latest_date < ?
     ORDER BY s.stock_id`,
    [startDate, endDate]
  );

  console.log(`需要補抓的股票：${stockRows.length} 支（${startDate} ~ ${endDate}）`);

  const connection = await pool.getConnection();
  let totalRecords = 0;
  let stocksDone = 0;
  let yahooFails = 0;

  try {
    for (const { stock_id, market_type, latest_date } of stockRows) {
      // 若已有部分資料，從最新日期的次日開始補
      const fetchStart = latest_date
        ? new Date(new Date(latest_date).getTime() + 86400000).toISOString().slice(0, 10)
        : startDate;

      let records = null;
      try {
        records = await fetchYahooPrice(stock_id, fetchStart, endDate, market_type);
      } catch (e) {
        yahooFails++;
      }

      if (records && records.length > 0) {
        await savePricesToDb(connection, records);
        totalRecords += records.length;
      } else if (!records) {
        // Yahoo 失敗：備援
        try {
          if (market_type === '上櫃') {
            const r = await fetchOTCDailyPrice(stock_id, fetchStart);
            if (r?.length) { await savePricesToDb(connection, r); totalRecords += r.length; }
          } else {
            const dateStr = fetchStart.replace(/-/g, '').slice(0, 6) + '01';
            const r = await fetchDailyPrice(stock_id, dateStr);
            if (r?.length) { await savePricesToDb(connection, r); totalRecords += r.length; }
          }
        } catch (_) {}
      }

      stocksDone++;
      if (onProgress) onProgress(stocksDone, stockRows.length, stock_id);

      // Yahoo Finance 較寬鬆，300ms 即可
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } finally {
    connection.release();
  }

  console.log(`完成！補抓 ${stocksDone} 支，共 ${totalRecords} 筆，Yahoo 失敗 ${yahooFails} 支`);
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
  fetchYahooPrice,
  fetchBatchDailyPrices,
  fetchRecentPrices,
  fetchMultiMonthPrices,
  fetchAllStocksLatestPrices,
  fetchOTCStocksLatestPrices,
  syncAllStocksHistory
};
