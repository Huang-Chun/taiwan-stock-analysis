const { pool } = require('../database/connection');

const STRATEGY_NAMES = {
  ma_bullish:          '多頭排列',
  ma20_breakout:       '突破MA20',
  ma60_breakout:       '突破MA60',
  golden_cross:        '黃金交叉',
  strong_candle:       '強勢長紅K',
  bullish_engulfing:   '看漲吞噬',
  hammer:              '長下影線',
  ma_volume_breakout:  '帶量突破MA20',
  golden_cross_volume: '金叉放量',
  volume_breakout:     '爆量(>2x)',
  macd_golden_cross:   'MACD金叉',
};

// ── 指標計算（在記憶體中對整個序列計算）────────────────────

function calcMASeries(closes, n) {
  return closes.map((_, i) =>
    i < n - 1 ? null : closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n
  );
}

function calcEMASeries(closes, n) {
  const k = 2 / (n + 1);
  const result = new Array(closes.length).fill(null);
  let ema = null;
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) continue;
    if (ema === null) {
      ema = closes.slice(0, n).reduce((a, b) => a + b, 0) / n;
    } else {
      ema = closes[i] * k + ema * (1 - k);
    }
    result[i] = ema;
  }
  return result;
}

function calcMACDHistSeries(closes) {
  const ema12 = calcEMASeries(closes, 12);
  const ema26 = calcEMASeries(closes, 26);
  const macdLine = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null
  );
  // EMA9 of macd line（只對非 null 值計算）
  const macdVals = macdLine.map(v => v ?? 0);
  const signal9  = calcEMASeries(macdVals, 9);
  return macdLine.map((m, i) =>
    m != null && signal9[i] != null ? m - signal9[i] : null
  );
}

function calcRSISeries(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d);
  }
  avgGain /= period; avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ── 逐日判斷策略 ──────────────────────────────────────────

function checkStrategy(s, today, prev, avgVol20, ind, prevInd) {
  const { close: c, open: o, high: h, low: l, volume: vol, change_percent: chg } = today;
  const { close: pc, open: po } = prev;
  const { ma5, ma20, ma60, macdHist, rsi } = ind;
  const { ma5: pma5, ma20: pma20, ma60: pma60, macdHist: pHist } = prevInd;

  switch (s) {
    case 'ma_bullish':
      return ma5 != null && ma20 != null && ma60 != null
        && c > ma5 && ma5 > ma20 && ma20 > ma60;

    case 'ma20_breakout':
      return ma20 != null && pma20 != null
        && c > ma20 && pc <= pma20;

    case 'ma60_breakout':
      return ma60 != null && pma60 != null
        && c > ma60 && pc <= pma60;

    case 'golden_cross':
      return ma5 != null && ma20 != null && pma5 != null && pma20 != null
        && ma5 > ma20 && pma5 <= pma20;

    case 'strong_candle': {
      const range = h - l;
      return chg >= 3 && range > 0 && (c - l) / range >= 0.7;
    }

    case 'bullish_engulfing':
      return c > o && pc < po && o <= pc && c >= po;

    case 'hammer': {
      const body        = Math.abs(c - o);
      const lowerShadow = Math.min(o, c) - l;
      const upperShadow = h - Math.max(o, c);
      return body > 0 && lowerShadow > 2 * body && upperShadow < body;
    }

    case 'ma_volume_breakout':
      return ma20 != null && pma20 != null
        && c > ma20 && pc <= pma20
        && avgVol20 > 0 && vol > avgVol20 * 1.5;

    case 'golden_cross_volume':
      return ma5 != null && ma20 != null && pma5 != null && pma20 != null
        && ma5 > ma20 && pma5 <= pma20
        && avgVol20 > 0 && vol > avgVol20 * 1.3;

    case 'volume_breakout':
      return avgVol20 > 0 && vol > avgVol20 * 2;

    case 'macd_golden_cross':
      return macdHist != null && pHist != null && macdHist > 0 && pHist <= 0;

    default:
      return false;
  }
}

// ── 統計工具 ──────────────────────────────────────────────

function calcMedian(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function calcStats(returns) {
  if (returns.length === 0) return null;
  const wins = returns.filter(r => r > 0);
  const sum  = returns.reduce((s, r) => s + r, 0);
  return {
    count:    returns.length,
    win_rate: parseFloat((wins.length / returns.length * 100).toFixed(1)),
    avg_ret:  parseFloat((sum / returns.length).toFixed(2)),
    median:   parseFloat(calcMedian(returns).toFixed(2)),
    max_ret:  parseFloat(Math.max(...returns).toFixed(2)),
    min_ret:  parseFloat(Math.min(...returns).toFixed(2)),
  };
}

// ── 主回測函式 ────────────────────────────────────────────

async function backtestStock(stockId, strategies, logic = 'AND') {
  if (!strategies || strategies.length === 0)
    return { error: '請至少選擇一個策略' };

  const [rows] = await pool.query(
    `SELECT
       trade_date,
       CAST(open_price    AS DECIMAL(10,2)) AS open,
       CAST(high_price    AS DECIMAL(10,2)) AS high,
       CAST(low_price     AS DECIMAL(10,2)) AS low,
       CAST(close_price   AS DECIMAL(10,2)) AS close,
       CAST(volume        AS UNSIGNED)       AS volume,
       CAST(change_percent AS DECIMAL(8,2)) AS change_percent
     FROM daily_prices
     WHERE stock_id = ?
     ORDER BY trade_date ASC`,
    [stockId]
  );

  if (rows.length < 5) return { error: '資料不足，無法回測' };

  // MySQL2 DECIMAL 欄位為字串，需要先 parseFloat
  rows.forEach(r => {
    r.open   = parseFloat(r.open);
    r.high   = parseFloat(r.high);
    r.low    = parseFloat(r.low);
    r.close  = parseFloat(r.close);
    r.volume = parseInt(r.volume) || 0;
    r.change_percent = parseFloat(r.change_percent) || 0;
  });

  // 計算所有技術指標序列（在記憶體中）
  const closes  = rows.map(r => r.close);
  const ma5s    = calcMASeries(closes, 5);
  const ma20s   = calcMASeries(closes, 20);
  const ma60s   = calcMASeries(closes, 60);
  const macdH   = calcMACDHistSeries(closes);
  const rsis    = calcRSISeries(closes);

  const signals = [];

  for (let i = 1; i < rows.length; i++) {
    const today = rows[i];
    const prev  = rows[i - 1];

    // 20 日均量（不含今日）
    const volSlice = rows.slice(Math.max(0, i - 20), i);
    const avgVol20 = volSlice.reduce((s, r) => s + r.volume, 0) / volSlice.length;

    const ind     = { ma5: ma5s[i],    ma20: ma20s[i],    ma60: ma60s[i],    macdHist: macdH[i],   rsi: rsis[i] };
    const prevInd = { ma5: ma5s[i-1],  ma20: ma20s[i-1],  ma60: ma60s[i-1],  macdHist: macdH[i-1], rsi: rsis[i-1] };

    const results   = strategies.map(s => checkStrategy(s, today, prev, avgVol20, ind, prevInd));
    const triggered = logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
    if (!triggered) continue;

    const entry = today.close;
    const sig = {
      date:      today.trade_date,
      close:     entry,
      vol_ratio: avgVol20 > 0 ? parseFloat((today.volume / avgVol20).toFixed(2)) : null,
      triggered_strategies: strategies
        .filter((_, idx) => results[idx])
        .map(s => STRATEGY_NAMES[s] || s),
      ma5:  ma5s[i]  != null ? parseFloat(ma5s[i].toFixed(2))  : null,
      ma20: ma20s[i] != null ? parseFloat(ma20s[i].toFixed(2)) : null,
      ma60: ma60s[i] != null ? parseFloat(ma60s[i].toFixed(2)) : null,
      rsi:  rsis[i]  != null ? parseFloat(rsis[i].toFixed(1))  : null,
    };

    // 持有 N 個交易日後的報酬
    for (const n of [3, 5, 10, 20]) {
      if (i + n < rows.length) {
        const fc = rows[i + n].close;
        sig[`ret${n}d`]    = parseFloat(((fc - entry) / entry * 100).toFixed(2));
        sig[`future${n}d`] = fc;
      } else {
        sig[`ret${n}d`]    = null;
        sig[`future${n}d`] = null;
      }
    }

    signals.push(sig);
  }

  const stats = {};
  for (const n of [3, 5, 10, 20]) {
    const valid = signals.filter(s => s[`ret${n}d`] != null).map(s => s[`ret${n}d`]);
    stats[`ret${n}d`] = calcStats(valid);
  }

  return {
    stock_id:       stockId,
    strategies,
    strategy_names: strategies.map(s => STRATEGY_NAMES[s] || s),
    logic,
    data_range: {
      from:               rows[0].trade_date,
      to:                 rows[rows.length - 1].trade_date,
      total_trading_days: rows.length,
    },
    total_signals: signals.length,
    stats,
    signals,
  };
}

module.exports = { backtestStock, STRATEGY_NAMES };
