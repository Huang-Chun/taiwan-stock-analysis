const { pool } = require('../database/connection');

/**
 * 偵測黃金交叉/死亡交叉（MA5 vs MA20）
 */
async function detectMACrossover(stockId) {
  const [rows] = await pool.query(
    `SELECT trade_date, ma5, ma20 FROM technical_indicators
     WHERE stock_id = ? AND ma5 IS NOT NULL AND ma20 IS NOT NULL
     ORDER BY trade_date DESC LIMIT 5`,
    [stockId]
  );

  if (rows.length < 2) return null;

  const today = rows[0];
  const yesterday = rows[1];
  const ma5Now = parseFloat(today.ma5);
  const ma20Now = parseFloat(today.ma20);
  const ma5Prev = parseFloat(yesterday.ma5);
  const ma20Prev = parseFloat(yesterday.ma20);

  if (ma5Prev <= ma20Prev && ma5Now > ma20Now) {
    return { signal: 'golden_cross', date: today.trade_date, description: 'MA5 上穿 MA20 黃金交叉' };
  }
  if (ma5Prev >= ma20Prev && ma5Now < ma20Now) {
    return { signal: 'death_cross', date: today.trade_date, description: 'MA5 下穿 MA20 死亡交叉' };
  }
  return null;
}

/**
 * RSI 超賣反彈偵測
 */
async function detectRSIOversold(stockId) {
  const [rows] = await pool.query(
    `SELECT trade_date, rsi FROM technical_indicators
     WHERE stock_id = ? AND rsi IS NOT NULL
     ORDER BY trade_date DESC LIMIT 5`,
    [stockId]
  );

  if (rows.length < 2) return null;

  const rsiNow = parseFloat(rows[0].rsi);
  const rsiPrev = parseFloat(rows[1].rsi);

  if (rsiPrev < 30 && rsiNow >= 30) {
    return { signal: 'rsi_bounce', date: rows[0].trade_date, description: `RSI 從超賣區反彈 (${rsiNow})` };
  }
  if (rsiNow < 30) {
    return { signal: 'rsi_oversold', date: rows[0].trade_date, description: `RSI 處於超賣區 (${rsiNow})` };
  }
  if (rsiNow > 70) {
    return { signal: 'rsi_overbought', date: rows[0].trade_date, description: `RSI 處於超買區 (${rsiNow})` };
  }
  return null;
}

/**
 * MACD 黃金交叉偵測
 */
async function detectMACDCrossover(stockId) {
  const [rows] = await pool.query(
    `SELECT trade_date, macd, macd_signal, macd_histogram FROM technical_indicators
     WHERE stock_id = ? AND macd IS NOT NULL AND macd_signal IS NOT NULL
     ORDER BY trade_date DESC LIMIT 5`,
    [stockId]
  );

  if (rows.length < 2) return null;

  const histNow = parseFloat(rows[0].macd_histogram);
  const histPrev = parseFloat(rows[1].macd_histogram);

  if (histPrev <= 0 && histNow > 0) {
    return { signal: 'macd_golden_cross', date: rows[0].trade_date, description: 'MACD 柱狀圖由負轉正（黃金交叉）' };
  }
  if (histPrev >= 0 && histNow < 0) {
    return { signal: 'macd_death_cross', date: rows[0].trade_date, description: 'MACD 柱狀圖由正轉負（死亡交叉）' };
  }
  return null;
}

/**
 * 量能突破偵測（成交量 > 20日均量 * 2）
 */
async function detectVolumeBreakout(stockId) {
  const [rows] = await pool.query(
    `SELECT trade_date, volume FROM daily_prices
     WHERE stock_id = ?
     ORDER BY trade_date DESC LIMIT 21`,
    [stockId]
  );

  if (rows.length < 21) return null;

  const todayVolume = parseInt(rows[0].volume);
  const avgVolume = rows.slice(1).reduce((sum, r) => sum + parseInt(r.volume), 0) / 20;

  if (todayVolume > avgVolume * 2) {
    const ratio = (todayVolume / avgVolume).toFixed(1);
    return { signal: 'volume_breakout', date: rows[0].trade_date, description: `成交量暴增 (${ratio}x 均量)` };
  }
  return null;
}

/**
 * 布林通道突破偵測
 */
async function detectBollingerBreakout(stockId) {
  const [rows] = await pool.query(
    `SELECT ti.trade_date, dp.close_price, ti.bollinger_upper, ti.bollinger_lower
     FROM technical_indicators ti
     JOIN daily_prices dp ON ti.stock_id = dp.stock_id AND ti.trade_date = dp.trade_date
     WHERE ti.stock_id = ? AND ti.bollinger_upper IS NOT NULL
     ORDER BY ti.trade_date DESC LIMIT 2`,
    [stockId]
  );

  if (rows.length < 1) return null;

  const close = parseFloat(rows[0].close_price);
  const upper = parseFloat(rows[0].bollinger_upper);
  const lower = parseFloat(rows[0].bollinger_lower);

  if (close > upper) {
    return { signal: 'bollinger_breakout_up', date: rows[0].trade_date, description: '股價突破布林通道上軌' };
  }
  if (close < lower) {
    return { signal: 'bollinger_breakout_down', date: rows[0].trade_date, description: '股價跌破布林通道下軌' };
  }
  return null;
}

/**
 * 偵測所有交易訊號
 */
async function detectAllSignals(stockId) {
  const signals = [];
  const detectors = [
    detectMACrossover,
    detectRSIOversold,
    detectMACDCrossover,
    detectVolumeBreakout,
    detectBollingerBreakout
  ];

  for (const detector of detectors) {
    const result = await detector(stockId);
    if (result) signals.push(result);
  }

  return signals;
}

/**
 * 綜合評分系統 (0-100)
 * 技術面各指標加權計算
 */
async function scoreStock(stockId) {
  const [tiRows] = await pool.query(
    `SELECT * FROM technical_indicators
     WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 1`,
    [stockId]
  );

  const [dpRows] = await pool.query(
    `SELECT close_price, volume FROM daily_prices
     WHERE stock_id = ? ORDER BY trade_date DESC LIMIT 21`,
    [stockId]
  );

  if (tiRows.length === 0 || dpRows.length === 0) return null;

  const ti = tiRows[0];
  const close = parseFloat(dpRows[0].close_price);
  let score = 50; // 基礎分

  // RSI (權重 20%)
  const rsi = parseFloat(ti.rsi);
  if (!isNaN(rsi)) {
    if (rsi >= 30 && rsi <= 50) score += 10;       // 低檔反彈區
    else if (rsi > 50 && rsi <= 70) score += 5;     // 正常多頭
    else if (rsi > 70) score -= 5;                   // 超買
    else if (rsi < 30) score -= 5;                   // 超賣（風險）
  }

  // 均線排列 (權重 20%)
  const ma5 = parseFloat(ti.ma5);
  const ma20 = parseFloat(ti.ma20);
  const ma60 = parseFloat(ti.ma60);
  if (!isNaN(ma5) && !isNaN(ma20)) {
    if (close > ma5 && ma5 > ma20) score += 10;     // 多頭排列
    else if (close < ma5 && ma5 < ma20) score -= 10; // 空頭排列
  }
  if (!isNaN(ma60) && close > ma60) score += 5;

  // MACD (權重 15%)
  const macdHist = parseFloat(ti.macd_histogram);
  if (!isNaN(macdHist)) {
    if (macdHist > 0) score += 8;
    else score -= 8;
  }

  // KD (權重 15%)
  const kd_k = parseFloat(ti.kd_k);
  const kd_d = parseFloat(ti.kd_d);
  if (!isNaN(kd_k) && !isNaN(kd_d)) {
    if (kd_k > kd_d && kd_k < 80) score += 8;
    else if (kd_k < kd_d && kd_k > 20) score -= 5;
    if (kd_k > 80) score -= 3; // 超買
    if (kd_k < 20) score += 3; // 超賣機會
  }

  // 成交量 (權重 10%)
  if (dpRows.length >= 21) {
    const todayVol = parseInt(dpRows[0].volume);
    const avgVol = dpRows.slice(1).reduce((s, r) => s + parseInt(r.volume), 0) / 20;
    if (avgVol > 0) {
      const volRatio = todayVol / avgVol;
      if (volRatio > 1.5 && close > ma5) score += 5;  // 帶量上攻
      else if (volRatio > 2 && close < ma5) score -= 5; // 帶量下殺
    }
  }

  // ADX 趨勢強度 (權重 10%)
  const adx = parseFloat(ti.adx);
  const plusDI = parseFloat(ti.plus_di);
  const minusDI = parseFloat(ti.minus_di);
  if (!isNaN(adx) && !isNaN(plusDI) && !isNaN(minusDI)) {
    if (adx > 25 && plusDI > minusDI) score += 5;    // 強勢多頭趨勢
    else if (adx > 25 && minusDI > plusDI) score -= 5; // 強勢空頭趨勢
  }

  // 布林通道位置 (權重 10%)
  const bUpper = parseFloat(ti.bollinger_upper);
  const bLower = parseFloat(ti.bollinger_lower);
  const bMiddle = parseFloat(ti.bollinger_middle);
  if (!isNaN(bUpper) && !isNaN(bLower)) {
    const bWidth = bUpper - bLower;
    const pos = bWidth > 0 ? (close - bLower) / bWidth : 0.5;
    if (pos > 0.5 && pos < 0.8) score += 3;
    else if (pos >= 0.8) score -= 2;
    else if (pos <= 0.2) score += 2; // 低檔
  }

  return {
    stock_id: stockId,
    score: Math.max(0, Math.min(100, Math.round(score))),
    indicators: {
      rsi, ma5, ma20, ma60, kd_k, kd_d,
      macd: parseFloat(ti.macd),
      macd_histogram: macdHist,
      adx, bollinger_position: !isNaN(bUpper) && !isNaN(bLower) && (bUpper - bLower) > 0
        ? ((close - bLower) / (bUpper - bLower) * 100).toFixed(1)
        : null
    }
  };
}

/**
 * 依策略篩選股票
 */
async function screenByStrategy(strategy, options = {}) {
  const connection = await pool.getConnection();
  try {
    let query = '';
    const params = [];

    switch (strategy) {
      case 'golden_cross':
        // 最近 MA5 上穿 MA20
        query = `
          SELECT t1.stock_id, s.stock_name, dp.close_price, t1.ma5, t1.ma20, t1.trade_date
          FROM technical_indicators t1
          JOIN technical_indicators t2 ON t1.stock_id = t2.stock_id
          JOIN stocks s ON t1.stock_id = s.stock_id
          JOIN daily_prices dp ON t1.stock_id = dp.stock_id AND t1.trade_date = dp.trade_date
          WHERE t1.trade_date = (SELECT MAX(trade_date) FROM technical_indicators WHERE stock_id = t1.stock_id)
            AND t2.trade_date = (SELECT MAX(trade_date) FROM technical_indicators WHERE stock_id = t1.stock_id AND trade_date < t1.trade_date)
            AND t1.ma5 > t1.ma20
            AND t2.ma5 <= t2.ma20
          ORDER BY dp.close_price DESC LIMIT 50`;
        break;

      case 'rsi_oversold':
        query = `
          SELECT ti.stock_id, s.stock_name, dp.close_price, ti.rsi, ti.trade_date
          FROM technical_indicators ti
          JOIN stocks s ON ti.stock_id = s.stock_id
          JOIN daily_prices dp ON ti.stock_id = dp.stock_id AND ti.trade_date = dp.trade_date
          WHERE ti.trade_date = (SELECT MAX(trade_date) FROM technical_indicators WHERE stock_id = ti.stock_id)
            AND ti.rsi < ?
          ORDER BY ti.rsi ASC LIMIT 50`;
        params.push(options.rsi_threshold || 30);
        break;

      case 'macd_golden_cross':
        query = `
          SELECT t1.stock_id, s.stock_name, dp.close_price, t1.macd, t1.macd_signal, t1.macd_histogram, t1.trade_date
          FROM technical_indicators t1
          JOIN technical_indicators t2 ON t1.stock_id = t2.stock_id
          JOIN stocks s ON t1.stock_id = s.stock_id
          JOIN daily_prices dp ON t1.stock_id = dp.stock_id AND t1.trade_date = dp.trade_date
          WHERE t1.trade_date = (SELECT MAX(trade_date) FROM technical_indicators WHERE stock_id = t1.stock_id)
            AND t2.trade_date = (SELECT MAX(trade_date) FROM technical_indicators WHERE stock_id = t1.stock_id AND trade_date < t1.trade_date)
            AND t1.macd_histogram > 0
            AND t2.macd_histogram <= 0
          ORDER BY t1.macd_histogram DESC LIMIT 50`;
        break;

      case 'volume_breakout':
        query = `
          SELECT dp1.stock_id, s.stock_name, dp1.close_price, dp1.volume, dp1.trade_date,
            (SELECT AVG(volume) FROM daily_prices dp2
             WHERE dp2.stock_id = dp1.stock_id AND dp2.trade_date < dp1.trade_date
             ORDER BY dp2.trade_date DESC LIMIT 20) as avg_volume
          FROM daily_prices dp1
          JOIN stocks s ON dp1.stock_id = s.stock_id
          WHERE dp1.trade_date = (SELECT MAX(trade_date) FROM daily_prices WHERE stock_id = dp1.stock_id)
            AND dp1.volume > (
              SELECT AVG(volume) * 2 FROM daily_prices dp3
              WHERE dp3.stock_id = dp1.stock_id AND dp3.trade_date < dp1.trade_date
              ORDER BY dp3.trade_date DESC LIMIT 20
            )
          ORDER BY dp1.volume DESC LIMIT 50`;
        break;

      case 'bollinger_squeeze':
        query = `
          SELECT ti.stock_id, s.stock_name, dp.close_price, ti.bollinger_upper, ti.bollinger_lower,
            ((ti.bollinger_upper - ti.bollinger_lower) / ti.bollinger_middle * 100) as bandwidth
          FROM technical_indicators ti
          JOIN stocks s ON ti.stock_id = s.stock_id
          JOIN daily_prices dp ON ti.stock_id = dp.stock_id AND ti.trade_date = dp.trade_date
          WHERE ti.trade_date = (SELECT MAX(trade_date) FROM technical_indicators WHERE stock_id = ti.stock_id)
            AND ti.bollinger_upper IS NOT NULL
          ORDER BY bandwidth ASC LIMIT 50`;
        break;

      default:
        return { error: '不支援的策略，可用: golden_cross, rsi_oversold, macd_golden_cross, volume_breakout, bollinger_squeeze' };
    }

    const [rows] = await connection.query(query, params);
    return { strategy, count: rows.length, data: rows };

  } finally {
    connection.release();
  }
}

module.exports = {
  detectMACrossover,
  detectRSIOversold,
  detectMACDCrossover,
  detectVolumeBreakout,
  detectBollingerBreakout,
  detectAllSignals,
  scoreStock,
  screenByStrategy
};
