const { pool } = require('../database/connection');

/**
 * 計算移動平均線 (MA)
 */
function calculateMA(prices, period) {
  if (prices.length < period) return null;
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return (sum / period).toFixed(2);
}

/**
 * 計算 EMA 陣列（回傳每日 EMA）
 */
function calculateEMASeries(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  // 初始值用前 period 天的 SMA
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = new Array(period - 1).fill(null);
  result.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

/**
 * 計算 RSI（Wilder 平滑法）
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // 第一組：用簡單平均
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder 平滑
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return (100 - 100 / (1 + rs)).toFixed(2);
}

/**
 * 計算 MACD（正確的 EMA12 - EMA26，signal = 9-period EMA of MACD）
 */
function calculateMACD(prices) {
  if (prices.length < 35) return { macd: null, signal: null, histogram: null };

  const ema12 = calculateEMASeries(prices, 12);
  const ema26 = calculateEMASeries(prices, 26);

  // 從第 26 天開始才有 MACD 值
  const macdSeries = [];
  for (let i = 0; i < prices.length; i++) {
    if (ema12[i] !== null && ema12[i] !== undefined &&
        ema26[i] !== null && ema26[i] !== undefined) {
      macdSeries.push(ema12[i] - ema26[i]);
    }
  }

  if (macdSeries.length < 9) return { macd: null, signal: null, histogram: null };

  // signal = 9-period EMA of MACD series
  const signalSeries = calculateEMASeries(macdSeries, 9);
  const macdVal = macdSeries[macdSeries.length - 1];
  const signalVal = signalSeries[signalSeries.length - 1];
  const histogram = macdVal - signalVal;

  return {
    macd: macdVal.toFixed(4),
    signal: signalVal.toFixed(4),
    histogram: histogram.toFixed(4)
  };
}

/**
 * 計算 KD 指標（正確遞推公式）
 * K = 2/3 * prevK + 1/3 * RSV
 * D = 2/3 * prevD + 1/3 * K
 */
function calculateKD(highs, lows, closes, period = 9) {
  if (closes.length < period) return { k: null, d: null };

  let k = 50;
  let d = 50;

  // 從可計算 RSV 的第一天開始遞推
  for (let i = period - 1; i < closes.length; i++) {
    const windowHighs = highs.slice(i - period + 1, i + 1);
    const windowLows = lows.slice(i - period + 1, i + 1);
    const highest = Math.max(...windowHighs);
    const lowest = Math.min(...windowLows);

    let rsv = 50;
    if (highest !== lowest) {
      rsv = ((closes[i] - lowest) / (highest - lowest)) * 100;
    }

    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }

  return {
    k: k.toFixed(2),
    d: d.toFixed(2)
  };
}

/**
 * 計算布林通道
 */
function calculateBollinger(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return { upper: null, middle: null, lower: null };

  const recentPrices = prices.slice(-period);
  const middle = recentPrices.reduce((a, b) => a + b, 0) / period;
  const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
  const sd = Math.sqrt(variance);

  return {
    upper: (middle + stdDev * sd).toFixed(2),
    middle: middle.toFixed(2),
    lower: (middle - stdDev * sd).toFixed(2)
  };
}

/**
 * 計算 VWAP（成交量加權平均價）
 * 使用最近 period 天
 */
function calculateVWAP(highs, lows, closes, volumes, period = 20) {
  if (closes.length < period) return null;

  let sumPV = 0;
  let sumV = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    sumPV += typicalPrice * volumes[i];
    sumV += volumes[i];
  }

  if (sumV === 0) return null;
  return (sumPV / sumV).toFixed(2);
}

/**
 * 計算 ATR（平均真實區間，Wilder 平滑）
 */
function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;

  // True Range 陣列
  const trSeries = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trSeries.push(tr);
  }

  // 初始 ATR = 前 period 天 TR 的 SMA
  let atr = trSeries.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilder 平滑
  for (let i = period; i < trSeries.length; i++) {
    atr = (atr * (period - 1) + trSeries[i]) / period;
  }

  return atr.toFixed(4);
}

/**
 * 計算 DMI/ADX（方向移動指標）
 */
function calculateDMI(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return { adx: null, plusDI: null, minusDI: null };

  const trSeries = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trSeries.push(tr);

    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  if (trSeries.length < period) return { adx: null, plusDI: null, minusDI: null };

  // Wilder smoothing for TR, +DM, -DM
  let smoothTR = trSeries.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxSeries = [];

  for (let i = period; i < trSeries.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trSeries[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];

    const pdi = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const mdi = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = pdi + mdi;
    const dx = diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0;
    dxSeries.push({ dx, pdi, mdi });
  }

  if (dxSeries.length < period) return { adx: null, plusDI: null, minusDI: null };

  // ADX = Wilder smoothing of DX
  let adx = dxSeries.slice(0, period).reduce((a, b) => a + b.dx, 0) / period;
  for (let i = period; i < dxSeries.length; i++) {
    adx = (adx * (period - 1) + dxSeries[i].dx) / period;
  }

  const last = dxSeries[dxSeries.length - 1];

  return {
    adx: adx.toFixed(2),
    plusDI: last.pdi.toFixed(2),
    minusDI: last.mdi.toFixed(2)
  };
}

/**
 * 計算 Williams %R
 */
function calculateWilliamsR(highs, lows, closes, period = 14) {
  if (closes.length < period) return null;

  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const currentClose = closes[closes.length - 1];

  const highest = Math.max(...recentHighs);
  const lowest = Math.min(...recentLows);

  if (highest === lowest) return -50;
  const wr = ((highest - currentClose) / (highest - lowest)) * -100;
  return wr.toFixed(2);
}

/**
 * 計算 OBV（能量潮）
 */
function calculateOBV(closes, volumes) {
  if (closes.length < 2) return null;

  let obv = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      obv += volumes[i];
    } else if (closes[i] < closes[i - 1]) {
      obv -= volumes[i];
    }
  }
  return obv;
}

/**
 * 為指定股票計算所有技術指標
 */
async function calculateIndicatorsForStock(stockId) {
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.query(
      `SELECT trade_date, open_price, high_price, low_price, close_price, volume
       FROM daily_prices
       WHERE stock_id = ?
       ORDER BY trade_date ASC
       LIMIT 250`,
      [stockId]
    );

    if (rows.length < 20) {
      console.log(`股票 ${stockId} 資料不足，無法計算指標`);
      return;
    }

    const closes = rows.map(r => parseFloat(r.close_price));
    const highs = rows.map(r => parseFloat(r.high_price));
    const lows = rows.map(r => parseFloat(r.low_price));
    const volumes = rows.map(r => parseInt(r.volume) || 0);
    const latestDate = rows[rows.length - 1].trade_date;

    const macd = calculateMACD(closes);
    const kd = calculateKD(highs, lows, closes);
    const bollinger = calculateBollinger(closes);
    const dmi = calculateDMI(highs, lows, closes);

    const indicators = {
      stock_id: stockId,
      trade_date: latestDate,
      ma5: calculateMA(closes, 5),
      ma10: calculateMA(closes, 10),
      ma20: calculateMA(closes, 20),
      ma60: calculateMA(closes, 60),
      rsi: calculateRSI(closes, 14),
      macd: macd.macd,
      macd_signal: macd.signal,
      macd_histogram: macd.histogram,
      kd_k: kd.k,
      kd_d: kd.d,
      bollinger_upper: bollinger.upper,
      bollinger_middle: bollinger.middle,
      bollinger_lower: bollinger.lower,
      vwap: calculateVWAP(highs, lows, closes, volumes),
      atr: calculateATR(highs, lows, closes),
      adx: dmi.adx,
      plus_di: dmi.plusDI,
      minus_di: dmi.minusDI,
      williams_r: calculateWilliamsR(highs, lows, closes),
      obv: calculateOBV(closes, volumes)
    };

    await connection.query(
      `INSERT INTO technical_indicators
      (stock_id, trade_date, ma5, ma10, ma20, ma60, rsi, macd, macd_signal,
       macd_histogram, kd_k, kd_d, bollinger_upper, bollinger_middle, bollinger_lower,
       vwap, atr, adx, plus_di, minus_di, williams_r, obv)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      ma5 = VALUES(ma5), ma10 = VALUES(ma10), ma20 = VALUES(ma20), ma60 = VALUES(ma60),
      rsi = VALUES(rsi), macd = VALUES(macd), macd_signal = VALUES(macd_signal),
      macd_histogram = VALUES(macd_histogram), kd_k = VALUES(kd_k), kd_d = VALUES(kd_d),
      bollinger_upper = VALUES(bollinger_upper), bollinger_middle = VALUES(bollinger_middle),
      bollinger_lower = VALUES(bollinger_lower),
      vwap = VALUES(vwap), atr = VALUES(atr), adx = VALUES(adx),
      plus_di = VALUES(plus_di), minus_di = VALUES(minus_di),
      williams_r = VALUES(williams_r), obv = VALUES(obv)`,
      [
        indicators.stock_id, indicators.trade_date, indicators.ma5, indicators.ma10,
        indicators.ma20, indicators.ma60, indicators.rsi, indicators.macd,
        indicators.macd_signal, indicators.macd_histogram, indicators.kd_k,
        indicators.kd_d, indicators.bollinger_upper, indicators.bollinger_middle,
        indicators.bollinger_lower, indicators.vwap, indicators.atr, indicators.adx,
        indicators.plus_di, indicators.minus_di, indicators.williams_r, indicators.obv
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
