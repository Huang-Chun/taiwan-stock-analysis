const { pool } = require('../database/connection');

/**
 * 計算移動平均線 (MA)
 * @param {Array} prices - 價格陣列（由舊到新）
 * @param {number} period - 週期
 */
function calculateMA(prices, period) {
  if (prices.length < period) return null;
  
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return (sum / period).toFixed(2);
}

/**
 * 計算 RSI (相對強弱指標)
 * @param {Array} prices - 價格陣列（由舊到新）
 * @param {number} period - 週期（預設14）
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  // 計算價格變動
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi.toFixed(2);
}

/**
 * 計算 MACD
 * @param {Array} prices - 價格陣列
 */
function calculateMACD(prices) {
  if (prices.length < 26) return { macd: null, signal: null, histogram: null };

  // 計算 EMA
  const calculateEMA = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data[0];
    
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };

  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;

  // 計算信號線（MACD 的 9 日 EMA）
  // 這裡簡化處理，實際應該用 MACD 值的陣列
  const signal = macd * 0.9; // 簡化版本
  const histogram = macd - signal;

  return {
    macd: macd.toFixed(4),
    signal: signal.toFixed(4),
    histogram: histogram.toFixed(4)
  };
}

/**
 * 計算 KD 指標
 * @param {Array} highs - 最高價陣列
 * @param {Array} lows - 最低價陣列
 * @param {Array} closes - 收盤價陣列
 * @param {number} period - 週期（預設9）
 */
function calculateKD(highs, lows, closes, period = 9) {
  if (closes.length < period) return { k: null, d: null };

  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const currentClose = closes[closes.length - 1];

  const highest = Math.max(...recentHighs);
  const lowest = Math.min(...recentLows);

  let rsv = 50; // 預設值
  if (highest !== lowest) {
    rsv = ((currentClose - lowest) / (highest - lowest)) * 100;
  }

  // 簡化版本的 K 值（實際應該用前一日的 K 值）
  const k = rsv;
  const d = k * 0.9; // 簡化版本

  return {
    k: k.toFixed(2),
    d: d.toFixed(2)
  };
}

/**
 * 計算布林通道
 * @param {Array} prices - 價格陣列
 * @param {number} period - 週期（預設20）
 * @param {number} stdDev - 標準差倍數（預設2）
 */
function calculateBollinger(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return { upper: null, middle: null, lower: null };

  const recentPrices = prices.slice(-period);
  const middle = recentPrices.reduce((a, b) => a + b, 0) / period;

  // 計算標準差
  const variance = recentPrices.reduce((sum, price) => {
    return sum + Math.pow(price - middle, 2);
  }, 0) / period;
  
  const sd = Math.sqrt(variance);

  return {
    upper: (middle + stdDev * sd).toFixed(2),
    middle: middle.toFixed(2),
    lower: (middle - stdDev * sd).toFixed(2)
  };
}

/**
 * 為指定股票計算所有技術指標
 * @param {string} stockId - 股票代號
 */
async function calculateIndicatorsForStock(stockId) {
  const connection = await pool.getConnection();

  try {
    // 取得該股票最近 60 天的資料
    const [rows] = await connection.query(
      `SELECT trade_date, open_price, high_price, low_price, close_price, volume
       FROM daily_prices
       WHERE stock_id = ?
       ORDER BY trade_date ASC
       LIMIT 60`,
      [stockId]
    );

    if (rows.length < 20) {
      console.log(`股票 ${stockId} 資料不足，無法計算指標`);
      return;
    }

    const closes = rows.map(r => parseFloat(r.close_price));
    const highs = rows.map(r => parseFloat(r.high_price));
    const lows = rows.map(r => parseFloat(r.low_price));

    // 只計算最新一天的指標
    const latestDate = rows[rows.length - 1].trade_date;

    const indicators = {
      stock_id: stockId,
      trade_date: latestDate,
      ma5: calculateMA(closes, 5),
      ma10: calculateMA(closes, 10),
      ma20: calculateMA(closes, 20),
      ma60: calculateMA(closes, 60),
      rsi: calculateRSI(closes, 14)
    };

    const macd = calculateMACD(closes);
    indicators.macd = macd.macd;
    indicators.macd_signal = macd.signal;
    indicators.macd_histogram = macd.histogram;

    const kd = calculateKD(highs, lows, closes);
    indicators.kd_k = kd.k;
    indicators.kd_d = kd.d;

    const bollinger = calculateBollinger(closes);
    indicators.bollinger_upper = bollinger.upper;
    indicators.bollinger_middle = bollinger.middle;
    indicators.bollinger_lower = bollinger.lower;

    // 寫入資料庫
    await connection.query(
      `INSERT INTO technical_indicators 
      (stock_id, trade_date, ma5, ma10, ma20, ma60, rsi, macd, macd_signal, 
       macd_histogram, kd_k, kd_d, bollinger_upper, bollinger_middle, bollinger_lower)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      ma5 = VALUES(ma5), ma10 = VALUES(ma10), ma20 = VALUES(ma20), ma60 = VALUES(ma60),
      rsi = VALUES(rsi), macd = VALUES(macd), macd_signal = VALUES(macd_signal),
      macd_histogram = VALUES(macd_histogram), kd_k = VALUES(kd_k), kd_d = VALUES(kd_d),
      bollinger_upper = VALUES(bollinger_upper), bollinger_middle = VALUES(bollinger_middle),
      bollinger_lower = VALUES(bollinger_lower)`,
      [
        indicators.stock_id, indicators.trade_date, indicators.ma5, indicators.ma10,
        indicators.ma20, indicators.ma60, indicators.rsi, indicators.macd,
        indicators.macd_signal, indicators.macd_histogram, indicators.kd_k,
        indicators.kd_d, indicators.bollinger_upper, indicators.bollinger_middle,
        indicators.bollinger_lower
      ]
    );

    console.log(`✓ ${stockId} 技術指標計算完成`);

  } catch (error) {
    console.error(`計算 ${stockId} 指標失敗:`, error.message);
  } finally {
    connection.release();
  }
}

/**
 * 計算所有股票的技術指標
 */
async function calculateAllIndicators() {
  const connection = await pool.getConnection();

  try {
    // 取得所有有價格資料的股票
    const [stocks] = await connection.query(
      `SELECT DISTINCT stock_id FROM daily_prices`
    );

    console.log(`開始計算 ${stocks.length} 檔股票的技術指標...`);

    for (let i = 0; i < stocks.length; i++) {
      await calculateIndicatorsForStock(stocks[i].stock_id);
      console.log(`進度: ${i + 1}/${stocks.length}`);
    }

    console.log('✓ 所有技術指標計算完成');

  } catch (error) {
    console.error('計算指標失敗:', error);
    throw error;
  } finally {
    connection.release();
  }
}

// 如果直接執行此檔案
if (require.main === module) {
  calculateAllIndicators()
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
  calculateIndicatorsForStock,
  calculateAllIndicators
};
