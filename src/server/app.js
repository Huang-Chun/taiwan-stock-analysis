const express = require('express');
const { pool } = require('../database/connection');
const path = require('path');
require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');

const { detectAllSignals, scoreStock, screenByStrategy } = require('../analysis/strategies');
const { backtestStock } = require('../analysis/backtest');
const { analyzeInstitutionalTrend, detectAccumulation, analyzeConsensus, analyzeMarginTrend, screenByInstitutional } = require('../analysis/institutionalAnalysis');
const { analyzeRevenueTrend, calculateValuation, getFinancialSummary, scoreFundamental } = require('../analysis/fundamentalAnalysis');

const app = express();
const PORT = process.env.PORT || 3000;

// dateStrings:true 讓 mysql2 回傳字串，直接取前 10 碼即為 YYYY-MM-DD
const toDateStr = d => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// 股票基本 API
// ============================================

app.get('/api/stocks', async (req, res) => {
  try {
    const { keyword } = req.query;
    let query = 'SELECT stock_id, stock_name, industry, market_type FROM stocks WHERE is_active = TRUE';
    const params = [];

    if (keyword) {
      query += ' AND (stock_id LIKE ? OR stock_name LIKE ?)';
      const like = `%${keyword}%`;
      params.push(like, like);
    }

    query += ' ORDER BY stock_id LIMIT 100';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    const [rows] = await pool.query('SELECT * FROM stocks WHERE stock_id = ?', [stockId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '股票不存在' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/prices', async (req, res) => {
  try {
    const { stockId } = req.params;
    const { limit = 30 } = req.query;
    const [rows] = await pool.query(
      `SELECT * FROM daily_prices WHERE stock_id = ? ORDER BY trade_date DESC LIMIT ?`,
      [stockId, parseInt(limit)]
    );
    res.json({ success: true, data: rows.reverse() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/latest', async (req, res) => {
  try {
    const { stockId } = req.params;
    const [rows] = await pool.query(
      `SELECT
        s.stock_id, s.stock_name, s.industry,
        dp.trade_date, dp.close_price, dp.open_price, dp.high_price, dp.low_price,
        dp.volume, dp.change_amount, dp.change_percent,
        ti.ma5, ti.ma10, ti.ma20, ti.ma60, ti.rsi,
        ti.macd, ti.macd_signal, ti.macd_histogram,
        ti.kd_k, ti.kd_d,
        ti.bollinger_upper, ti.bollinger_middle, ti.bollinger_lower,
        ti.vwap, ti.atr, ti.adx, ti.plus_di, ti.minus_di, ti.williams_r, ti.obv
      FROM stocks s
      LEFT JOIN daily_prices dp ON s.stock_id = dp.stock_id
      LEFT JOIN technical_indicators ti ON s.stock_id = ti.stock_id
        AND dp.trade_date = ti.trade_date
      WHERE s.stock_id = ?
      ORDER BY dp.trade_date DESC
      LIMIT 1`,
      [stockId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '無資料' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 技術分析篩選 API
// ============================================

app.get('/api/analysis/screen', async (req, res) => {
  try {
    const { rsi_min, rsi_max, ma_position, volume_min, kd_golden_cross, macd_positive, adx_min } = req.query;

    let query = `
      SELECT
        s.stock_id, s.stock_name, dp.close_price, dp.change_percent, dp.volume,
        ti.rsi, ti.ma5, ti.ma20, ti.kd_k, ti.kd_d, ti.macd_histogram, ti.adx
      FROM stocks s
      JOIN daily_prices dp ON s.stock_id = dp.stock_id
      JOIN technical_indicators ti ON s.stock_id = ti.stock_id
        AND dp.trade_date = ti.trade_date
      WHERE dp.trade_date = (
        SELECT MAX(trade_date) FROM daily_prices WHERE stock_id = s.stock_id
      )
    `;
    const params = [];

    if (rsi_min) { query += ' AND ti.rsi >= ?'; params.push(parseFloat(rsi_min)); }
    if (rsi_max) { query += ' AND ti.rsi <= ?'; params.push(parseFloat(rsi_max)); }
    if (ma_position === 'above') query += ' AND dp.close_price > ti.ma20';
    else if (ma_position === 'below') query += ' AND dp.close_price < ti.ma20';
    if (volume_min) { query += ' AND dp.volume >= ?'; params.push(parseInt(volume_min)); }
    if (kd_golden_cross === 'true') query += ' AND ti.kd_k > ti.kd_d';
    if (macd_positive === 'true') query += ' AND ti.macd_histogram > 0';
    if (adx_min) { query += ' AND ti.adx >= ?'; params.push(parseFloat(adx_min)); }

    query += ' ORDER BY dp.change_percent DESC LIMIT 50';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analysis/screen/strategy/:strategy', async (req, res) => {
  try {
    const { strategy } = req.params;
    const { rsi_threshold } = req.query;
    const result = await screenByStrategy(strategy, { rsi_threshold: rsi_threshold ? parseFloat(rsi_threshold) : 30 });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 交易訊號 & 評分 API
// ============================================

app.get('/api/stocks/:stockId/signals', async (req, res) => {
  try {
    const signals = await detectAllSignals(req.params.stockId);
    res.json({ success: true, stock_id: req.params.stockId, signals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/score', async (req, res) => {
  try {
    const stockId = req.params.stockId;
    const technical = await scoreStock(stockId);
    const fundamental = await scoreFundamental(stockId);

    let totalScore = null;
    if (technical && fundamental) totalScore = Math.round(technical.score * 0.5 + fundamental.score * 0.5);
    else if (technical) totalScore = technical.score;
    else if (fundamental) totalScore = fundamental.score;

    res.json({
      success: true,
      stock_id: stockId,
      total_score: totalScore,
      technical_score: technical ? technical.score : null,
      fundamental_score: fundamental ? fundamental.score : null,
      technical_details: technical ? technical.indicators : null,
      fundamental_details: fundamental ? fundamental.details : null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 籌碼面 API
// ============================================

app.get('/api/stocks/:stockId/institutional', async (req, res) => {
  try {
    const { stockId } = req.params;
    const days = parseInt(req.query.days) || 20;

    const trend = await analyzeInstitutionalTrend(stockId, days);
    const consensus = await analyzeConsensus(stockId);
    const accumulation = await detectAccumulation(stockId);

    res.json({ success: true, trend, consensus, accumulation });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/margin', async (req, res) => {
  try {
    const { stockId } = req.params;
    const days = parseInt(req.query.days) || 20;
    const result = await analyzeMarginTrend(stockId, days);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analysis/screen/institutional', async (req, res) => {
  try {
    const { foreign_net_min, trust_net_min, days } = req.query;
    const result = await screenByInstitutional({
      foreign_net_min: foreign_net_min ? parseInt(foreign_net_min) : undefined,
      trust_net_min: trust_net_min ? parseInt(trust_net_min) : undefined,
      days: days ? parseInt(days) : 5
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 回測 API
// ============================================

app.get('/api/backtest', async (req, res) => {
  try {
    const { stock_id, strategies, logic } = req.query;
    if (!stock_id) return res.status(400).json({ success: false, error: 'stock_id 必填' });
    const stratList = (strategies || '').split(',').map(s => s.trim()).filter(Boolean);
    const result = await backtestStock(stock_id, stratList, logic === 'OR' ? 'OR' : 'AND');
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 基本面 API
// ============================================

app.get('/api/stocks/:stockId/revenue', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;
    const result = await analyzeRevenueTrend(req.params.stockId, months);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/financial', async (req, res) => {
  try {
    const result = await getFinancialSummary(req.params.stockId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/valuation', async (req, res) => {
  try {
    const result = await calculateValuation(req.params.stockId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 技術指標歷史 & 法人日線 API
// ============================================

// 從價格陣列計算完整 RSI 序列
function calcRSISeries(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) avgGain += ch; else avgLoss += Math.abs(ch);
  }
  avgGain /= period; avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (ch > 0 ? ch : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (ch < 0 ? Math.abs(ch) : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  }
  return result;
}

// EMA 序列
function calcEMASeries(arr, period) {
  if (arr.length < period) return new Array(arr.length).fill(null);
  const k = 2 / (period + 1);
  let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = [...new Array(period - 1).fill(null), ema];
  for (let i = period; i < arr.length; i++) {
    ema = arr[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// MACD 序列
function calcMACDSeries(closes) {
  const n = closes.length;
  const ema12 = calcEMASeries(closes, 12);
  const ema26 = calcEMASeries(closes, 26);
  const macdLine = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null);
  // signal = 9-period EMA of non-null MACD values, re-aligned
  const nonNull = macdLine.filter(v => v != null);
  const signalRaw = calcEMASeries(nonNull, 9);
  let si = 0;
  const signal = new Array(n).fill(null);
  const hist   = new Array(n).fill(null);
  macdLine.forEach((v, i) => {
    if (v != null) {
      signal[i] = signalRaw[si] != null ? parseFloat(signalRaw[si].toFixed(4)) : null;
      hist[i]   = signal[i]     != null ? parseFloat((v - signal[i]).toFixed(4)) : null;
      si++;
    }
  });
  return {
    macd:      macdLine.map(v => v != null ? parseFloat(v.toFixed(4)) : null),
    signal,
    histogram: hist
  };
}

// KD 序列
function calcKDSeries(highs, lows, closes, period = 9) {
  const kArr = new Array(closes.length).fill(null);
  const dArr = new Array(closes.length).fill(null);
  let k = 50, d = 50;
  for (let i = period - 1; i < closes.length; i++) {
    const hi = Math.max(...highs.slice(i - period + 1, i + 1));
    const lo = Math.min(...lows.slice(i - period + 1, i + 1));
    const rsv = hi !== lo ? ((closes[i] - lo) / (hi - lo)) * 100 : 50;
    k = 2 / 3 * k + 1 / 3 * rsv;
    d = 2 / 3 * d + 1 / 3 * k;
    kArr[i] = parseFloat(k.toFixed(2));
    dArr[i] = parseFloat(d.toFixed(2));
  }
  return { k: kArr, d: dArr };
}

app.get('/api/stocks/:stockId/indicators', async (req, res) => {
  try {
    const { stockId } = req.params;
    const startDate = req.query.startDate;
    if (!startDate) return res.json({ success: true, data: { dates:[], rsi:[], macd:[], macd_signal:[], macd_histogram:[], kd_k:[], kd_d:[] } });

    // 往前多抓 90 天日曆日（約 60 交易日）供 MACD/KD 暖機
    const warmup = new Date(new Date(startDate).getTime() - 90 * 24 * 60 * 60 * 1000);
    const warmupStr = warmup.toISOString().split('T')[0];

    const [rows] = await pool.query(
      `SELECT trade_date, close_price, high_price, low_price
       FROM daily_prices WHERE stock_id = ? AND trade_date >= ?
       ORDER BY trade_date ASC`,
      [stockId, warmupStr]
    );
    if (rows.length === 0) return res.json({ success: true, data: { dates:[], rsi:[], macd:[], macd_signal:[], macd_histogram:[], kd_k:[], kd_d:[] } });

    const all    = rows;
    const closes = all.map(r => parseFloat(r.close_price));
    const highs  = all.map(r => parseFloat(r.high_price));
    const lows   = all.map(r => parseFloat(r.low_price));

    const rsiArr  = calcRSISeries(closes);
    const macdObj = calcMACDSeries(closes);
    const kdObj   = calcKDSeries(highs, lows, closes);

    // 只回傳 startDate 之後的資料
    const dispIdx = all.findIndex(r => toDateStr(r.trade_date) >= startDate);
    const trim = arr => arr.slice(dispIdx);

    res.json({
      success: true,
      data: {
        dates:          all.slice(dispIdx).map(r => toDateStr(r.trade_date)),
        rsi:            trim(rsiArr),
        macd:           trim(macdObj.macd),
        macd_signal:    trim(macdObj.signal),
        macd_histogram: trim(macdObj.histogram),
        kd_k:           trim(kdObj.k),
        kd_d:           trim(kdObj.d),
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/institutional/daily', async (req, res) => {
  try {
    const { stockId } = req.params;
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const [rows] = await pool.query(
      `SELECT trade_date, foreign_net, trust_net, dealer_net, total_net
       FROM institutional_trading
       WHERE stock_id = ?
       ORDER BY trade_date DESC LIMIT ?`,
      [stockId, days]
    );
    if (rows.length === 0) return res.json({ success: true, data: [] });
    const data = rows.reverse();
    res.json({
      success: true,
      data: {
        dates:       data.map(r => toDateStr(r.trade_date)),
        foreign_net: data.map(r => r.foreign_net),
        trust_net:   data.map(r => r.trust_net),
        dealer_net:  data.map(r => r.dealer_net),
        total_net:   data.map(r => r.total_net),
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// K 線圖資料 API
// ============================================

app.get('/api/stocks/:stockId/kline', async (req, res) => {
  try {
    const { stockId } = req.params;
    const startDate = req.query.startDate;
    if (!startDate) return res.status(400).json({ success: false, error: 'startDate 必填' });

    // 往前多抓 90 天日曆日（約 60 交易日）供 MA60 暖機
    const warmup = new Date(new Date(startDate).getTime() - 90 * 24 * 60 * 60 * 1000);
    const warmupStr = warmup.toISOString().split('T')[0];

    const [rows] = await pool.query(
      `SELECT trade_date, open_price, high_price, low_price, close_price, volume, change_percent
       FROM daily_prices
       WHERE stock_id = ? AND trade_date >= ?
       ORDER BY trade_date ASC`,
      [stockId, warmupStr]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '無資料' });
    }

    const all    = rows;
    const closes = all.map(r => parseFloat(r.close_price));

    const calcMA = (arr, n) => arr.map((_, i) =>
      i < n - 1 ? null : +( arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n ).toFixed(2)
    );

    const ma5  = calcMA(closes, 5);
    const ma10 = calcMA(closes, 10);
    const ma20 = calcMA(closes, 20);
    const ma60 = calcMA(closes, 60);

    // 只顯示 startDate 之後的資料（MA 已用完整暖機計算）
    const offset = all.findIndex(r => toDateStr(r.trade_date) >= startDate);
    const data   = all.slice(offset);

    // 偵測顯示範圍內的 MA 交叉訊號
    const signals = [];
    for (let i = Math.max(1, offset); i < all.length; i++) {
      if (ma5[i] == null || ma20[i] == null || ma5[i-1] == null || ma20[i-1] == null) continue;
      const dateStr = toDateStr(all[i].trade_date);
      if (ma5[i-1] <= ma20[i-1] && ma5[i] > ma20[i])
        signals.push({ date: dateStr, type: 'golden_cross', label: '金叉' });
      else if (ma5[i-1] >= ma20[i-1] && ma5[i] < ma20[i])
        signals.push({ date: dateStr, type: 'death_cross', label: '死叉' });
    }

    res.json({
      success: true,
      data: {
        dates:          data.map(r => toDateStr(r.trade_date)),
        ohlcv:          data.map(r => [r.open_price, r.close_price, r.low_price, r.high_price].map(parseFloat)),
        volume:         data.map(r => parseFloat(r.volume)),
        change_percent: data.map(r => r.change_percent),
        ma5:  ma5.slice(offset),
        ma10: ma10.slice(offset),
        ma20: ma20.slice(offset),
        ma60: ma60.slice(offset),
        signals,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 管理用：一鍵同步（SSE 串流進度）
// ============================================

app.post('/api/admin/sync', async (req, res) => {
  const { syncAllStocksHistory } = require('../crawler/fetchDailyPrices');
  const { calculateAllIndicators } = require('../analysis/calculateIndicators');
  const { fetchRecentInstitutionalTrading } = require('../crawler/fetchInstitutionalTrading');
  const { fetchRecentMarginTrading } = require('../crawler/fetchMarginTrading');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    emit({ step: 'prices', status: 'start', msg: '正在補抓全市場股價（本月）...' });
    const pr = await syncAllStocksHistory(1);
    emit({ step: 'prices', status: 'done', msg: `股價更新完成：${pr.stocks} 檔，寫入 ${pr.records} 筆` });

    emit({ step: 'institutional', status: 'start', msg: '正在同步三大法人...' });
    const instCount = await fetchRecentInstitutionalTrading();
    emit({ step: 'institutional', status: 'done', msg: `三大法人同步完成：${instCount} 筆` });

    emit({ step: 'margin', status: 'start', msg: '正在同步融資融券...' });
    const marginCount = await fetchRecentMarginTrading();
    emit({ step: 'margin', status: 'done', msg: `融資融券同步完成：${marginCount} 筆` });

    emit({ step: 'indicators', status: 'start', msg: '正在計算技術指標...' });
    await calculateAllIndicators();
    emit({ step: 'indicators', status: 'done', msg: '技術指標計算完成' });

    emit({ done: true });
  } catch (error) {
    emit({ error: error.message });
  }
  res.end();
});

// ============================================
// 健康檢查
// ============================================

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, status: 'unhealthy', error: error.message });
  }
});

// ── Sectors ──────────────────────────────────────────────────

// GET all groups with subgroups
app.get('/api/sectors', async (req, res) => {
  try {
    const [groups] = await pool.query('SELECT * FROM sector_groups ORDER BY sort_order, id');
    const [subgroups] = await pool.query('SELECT * FROM sector_subgroups ORDER BY sort_order, id');
    const tree = groups.map(g => ({
      ...g,
      subgroups: subgroups.filter(s => s.group_id === g.id)
    }));
    res.json({ success: true, data: tree });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST create group
app.post('/api/sectors/groups', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const [r] = await pool.query('INSERT INTO sector_groups (name) VALUES (?)', [name]);
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PUT reorder groups (must come before /:id route)
app.put('/api/sectors/groups/reorder', async (req, res) => {
  try {
    const { order } = req.body; // array of group ids in new order
    if (!Array.isArray(order)) return res.status(400).json({ success: false, error: 'order array required' });
    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE sector_groups SET sort_order=? WHERE id=?', [i, order[i]]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PUT update group
app.put('/api/sectors/groups/:id', async (req, res) => {
  try {
    const { name } = req.body;
    await pool.query('UPDATE sector_groups SET name=? WHERE id=?', [name, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE group
app.delete('/api/sectors/groups/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sector_groups WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST create subgroup
app.post('/api/sectors/groups/:gid/subgroups', async (req, res) => {
  try {
    const { name, description = '' } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const [r] = await pool.query(
      'INSERT INTO sector_subgroups (group_id, name, description) VALUES (?,?,?)',
      [req.params.gid, name, description]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PUT update subgroup
app.put('/api/sectors/subgroups/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    await pool.query('UPDATE sector_subgroups SET name=?, description=? WHERE id=?',
      [name, description, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE subgroup
app.delete('/api/sectors/subgroups/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sector_subgroups WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET stocks in subgroup (with latest price + change_percent)
app.get('/api/sectors/subgroups/:id/stocks', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ss.stock_id, st.stock_name, ss.section_id,
             dp.close_price, dp.change_percent
      FROM sector_stocks ss
      JOIN stocks st ON ss.stock_id = st.stock_id
      LEFT JOIN daily_prices dp ON ss.stock_id = dp.stock_id
        AND dp.trade_date = (SELECT MAX(trade_date) FROM daily_prices WHERE stock_id = ss.stock_id)
      WHERE ss.subgroup_id = ?
      ORDER BY ss.sort_order, ss.stock_id
    `, [req.params.id]);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST add stock to subgroup
app.post('/api/sectors/subgroups/:id/stocks', async (req, res) => {
  try {
    const { stock_id } = req.body;
    if (!stock_id) return res.status(400).json({ success: false, error: 'stock_id required' });
    // verify stock exists
    const [rows] = await pool.query('SELECT stock_id FROM stocks WHERE stock_id=?', [stock_id]);
    if (!rows.length) return res.status(404).json({ success: false, error: '股票代號不存在' });
    await pool.query('INSERT IGNORE INTO sector_stocks (subgroup_id, stock_id) VALUES (?,?)',
      [req.params.id, stock_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE stock from subgroup
app.delete('/api/sectors/subgroups/:sid/stocks/:stockId', async (req, res) => {
  try {
    await pool.query('DELETE FROM sector_stocks WHERE subgroup_id=? AND stock_id=?',
      [req.params.sid, req.params.stockId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Sections CRUD
app.get('/api/sectors/subgroups/:id/sections', async (req, res) => {
  try {
    const [sections] = await pool.query(
      'SELECT * FROM sector_stock_sections WHERE subgroup_id=? ORDER BY sort_order, id',
      [req.params.id]
    );
    res.json({ success: true, data: sections });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/sectors/subgroups/:id/sections', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const [r] = await pool.query(
      'INSERT INTO sector_stock_sections (subgroup_id, name) VALUES (?,?)',
      [req.params.id, name]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/sectors/sections/:id', async (req, res) => {
  try {
    const { name } = req.body;
    await pool.query('UPDATE sector_stock_sections SET name=? WHERE id=?', [name, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/sectors/sections/:id', async (req, res) => {
  try {
    // Nullify section_id for stocks in this section
    await pool.query('UPDATE sector_stocks SET section_id=NULL WHERE section_id=?', [req.params.id]);
    await pool.query('DELETE FROM sector_stock_sections WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Move stock to section (or unassign with section_id: null)
app.put('/api/sectors/subgroups/:sid/stocks/:stockId/section', async (req, res) => {
  try {
    const { section_id } = req.body; // null = uncategorized
    await pool.query(
      'UPDATE sector_stocks SET section_id=? WHERE subgroup_id=? AND stock_id=?',
      [section_id || null, req.params.sid, req.params.stockId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================
// 首頁
// ============================================

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>台股分析系統</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Microsoft JhengHei', Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
          background: white; padding: 30px; border-radius: 15px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2); margin-bottom: 30px; text-align: center;
        }
        h1 { color: #667eea; margin-bottom: 10px; }
        .card {
          background: white; padding: 25px; border-radius: 15px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2); margin-bottom: 20px;
        }
        .card h2 { color: #333; margin-bottom: 15px; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
        .api-list { list-style: none; }
        .api-list li {
          padding: 12px; margin: 8px 0; background: #f8f9fa;
          border-left: 4px solid #667eea; border-radius: 5px; font-family: 'Courier New', monospace;
        }
        .method { color: #28a745; font-weight: bold; margin-right: 10px; }
        .description { color: #6c757d; font-size: 14px; margin-top: 5px; }
        .button {
          display: inline-block; padding: 12px 24px; background: #667eea; color: white;
          text-decoration: none; border-radius: 8px; margin: 10px 5px; transition: all 0.3s;
        }
        .button:hover { background: #764ba2; transform: translateY(-2px); }
        .status { display: inline-block; padding: 5px 15px; border-radius: 20px; font-size: 14px; font-weight: bold; }
        .status.online { background: #d4edda; color: #155724; }
        .section-label { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; margin-left: 8px; }
        .label-tech { background: #e3f2fd; color: #1565c0; }
        .label-chip { background: #fff3e0; color: #e65100; }
        .label-fund { background: #e8f5e9; color: #2e7d32; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>台股分析系統 v2.0</h1>
          <p style="color: #666;">Taiwan Stock Analysis System - Technical / Institutional / Fundamental</p>
          <p style="margin-top: 10px;"><span class="status online">系統運行中</span></p>
        </div>

        <div class="card">
          <h2>API Endpoints</h2>
          <ul class="api-list">
            <li><span class="method">GET</span>/api/stocks<div class="description">股票清單（?keyword=台積電）</div></li>
            <li><span class="method">GET</span>/api/stocks/:id<div class="description">股票詳情</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/prices<div class="description">歷史股價（?limit=30）</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/latest<div class="description">最新股價+全部技術指標</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/signals <span class="section-label label-tech">技術面</span><div class="description">交易訊號偵測</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/score <span class="section-label label-tech">技術面</span><span class="section-label label-fund">基本面</span><div class="description">綜合評分（0-100）</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/institutional <span class="section-label label-chip">籌碼面</span><div class="description">法人買賣超趨勢</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/margin <span class="section-label label-chip">籌碼面</span><div class="description">融資融券分析</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/revenue <span class="section-label label-fund">基本面</span><div class="description">月營收趨勢</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/financial <span class="section-label label-fund">基本面</span><div class="description">財報摘要</div></li>
            <li><span class="method">GET</span>/api/stocks/:id/valuation <span class="section-label label-fund">基本面</span><div class="description">估值指標（PE/PB/殖利率）</div></li>
            <li><span class="method">GET</span>/api/analysis/screen<div class="description">技術指標篩選（rsi_min, rsi_max, ma_position, volume_min, kd_golden_cross, macd_positive, adx_min）</div></li>
            <li><span class="method">GET</span>/api/analysis/screen/strategy/:name<div class="description">策略篩選（golden_cross, rsi_oversold, macd_golden_cross, volume_breakout, bollinger_squeeze）</div></li>
            <li><span class="method">GET</span>/api/analysis/screen/institutional <span class="section-label label-chip">籌碼面</span><div class="description">法人篩選（foreign_net_min, trust_net_min, days）</div></li>
          </ul>
        </div>

        <div class="card">
          <h2>Quick Links</h2>
          <a href="/chart.html" class="button">📈 K 線圖</a>
          <a href="/sectors.html" class="button">🗂 產業分類</a>
          <a href="/api/stocks/2330/latest" class="button">台積電最新</a>
          <a href="/api/stocks/2330/signals" class="button">台積電訊號</a>
          <a href="/api/stocks/2330/score" class="button">台積電評分</a>
          <a href="/api/analysis/screen?rsi_max=30" class="button">RSI&lt;30</a>
          <a href="/api/analysis/screen/strategy/golden_cross" class="button">黃金交叉</a>
          <a href="/api/health" class="button">健康檢查</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ============================================
// AI 分析 API (streaming via SSE)
// ============================================
app.post('/api/ai/analyze', async (req, res) => {
  const { stockId, stockName, context } = req.body;
  if (!stockId) return res.status(400).json({ error: 'stockId required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY 未設定，請在 .env 加入 API key' });
  }

  // SSE headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const client = new Anthropic({ apiKey });

    const systemPrompt = `你是一位專業的台股技術分析師，熟悉台灣股市的特性、技術指標和籌碼面分析。
請用繁體中文回覆，語言簡潔直接，重點清晰。分析時請關注：
1. 技術指標的多空訊號（RSI、KD、MACD）
2. 籌碼面（外資、投信、自營商動向）
3. 當前股價位置與趨勢
4. 短中期操作建議
請避免過於保守的免責聲明，給出有參考價值的具體觀點。`;

    const userMessage = `請分析 ${stockName || stockId}（${stockId}）的近期技術面與籌碼面狀況：

${context || '（無額外資料）'}

請給出：
- 技術指標解讀（RSI/KD/MACD 目前狀態）
- 籌碼面觀察
- 短期多空偏向
- 操作建議或需注意的關鍵位置`;

    const stream = await client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('AI analyze error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ============================================
// AI Chat API (multi-turn + tool use + SSE streaming)
// ============================================
app.post('/api/chat', async (req, res) => {
  const { messages = [], context = {} } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 未設定' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // ── Tool definitions ──────────────────────────────────────────
  const tools = [
    {
      name: 'get_stock_latest',
      description: '取得股票最新報價與技術指標（RSI、KD、MACD、MA等）',
      input_schema: {
        type: 'object',
        properties: { stock_id: { type: 'string', description: '股票代號，如 2330' } },
        required: ['stock_id'],
      },
    },
    {
      name: 'get_signals',
      description: '偵測股票的技術面交易訊號（黃金交叉、RSI超賣、MACD訊號等）',
      input_schema: {
        type: 'object',
        properties: { stock_id: { type: 'string' } },
        required: ['stock_id'],
      },
    },
    {
      name: 'get_score',
      description: '取得股票技術面 + 基本面綜合評分（0-100）',
      input_schema: {
        type: 'object',
        properties: { stock_id: { type: 'string' } },
        required: ['stock_id'],
      },
    },
    {
      name: 'get_institutional',
      description: '取得法人買賣超資料（外資、投信、自營商）',
      input_schema: {
        type: 'object',
        properties: {
          stock_id: { type: 'string' },
          days: { type: 'number', description: '查詢天數，預設 20' },
        },
        required: ['stock_id'],
      },
    },
    {
      name: 'get_margin',
      description: '取得融資融券資料與趨勢分析',
      input_schema: {
        type: 'object',
        properties: { stock_id: { type: 'string' } },
        required: ['stock_id'],
      },
    },
    {
      name: 'get_revenue',
      description: '取得月營收趨勢與年月增率',
      input_schema: {
        type: 'object',
        properties: { stock_id: { type: 'string' } },
        required: ['stock_id'],
      },
    },
    {
      name: 'get_financial',
      description: '取得財報摘要（EPS、毛利率、ROE、負債比等）',
      input_schema: {
        type: 'object',
        properties: { stock_id: { type: 'string' } },
        required: ['stock_id'],
      },
    },
    {
      name: 'get_valuation',
      description: '取得估值指標（本益比 PE、股價淨值比 PB、殖利率）',
      input_schema: {
        type: 'object',
        properties: { stock_id: { type: 'string' } },
        required: ['stock_id'],
      },
    },
    {
      name: 'screen_stocks',
      description: '用策略或技術條件篩選股票',
      input_schema: {
        type: 'object',
        properties: {
          strategy: { type: 'string', description: '策略：golden_cross, rsi_oversold, macd_golden_cross, volume_breakout, bollinger_squeeze' },
          rsi_min: { type: 'number' },
          rsi_max: { type: 'number' },
          ma_position: { type: 'string', description: 'above 或 below（相對 MA20）' },
          macd_positive: { type: 'boolean' },
          kd_golden_cross: { type: 'boolean' },
        },
      },
    },
  ];

  // ── Tool executor ─────────────────────────────────────────────
  const executeTool = async (name, input) => {
    switch (name) {
      case 'get_stock_latest': {
        const [rows] = await pool.query(
          `SELECT s.stock_id, s.stock_name, s.industry, s.market_type,
              dp.trade_date, dp.close_price, dp.open_price, dp.high_price,
              dp.low_price, dp.volume, dp.change_amount, dp.change_percent,
              ti.ma5, ti.ma10, ti.ma20, ti.ma60, ti.rsi,
              ti.macd, ti.macd_signal, ti.macd_histogram,
              ti.kd_k, ti.kd_d, ti.bollinger_upper, ti.bollinger_lower, ti.adx
           FROM stocks s
           LEFT JOIN daily_prices dp ON s.stock_id = dp.stock_id
           LEFT JOIN technical_indicators ti ON s.stock_id = ti.stock_id
             AND dp.trade_date = ti.trade_date
           WHERE s.stock_id = ?
           ORDER BY dp.trade_date DESC LIMIT 1`,
          [input.stock_id]
        );
        return rows[0] || { error: '找不到股票' };
      }
      case 'get_signals':
        return await detectAllSignals(input.stock_id);
      case 'get_score': {
        const technical = await scoreStock(input.stock_id);
        const fundamental = await scoreFundamental(input.stock_id);
        let totalScore = null;
        if (technical && fundamental) totalScore = Math.round(technical.score * 0.5 + fundamental.score * 0.5);
        else if (technical) totalScore = technical.score;
        else if (fundamental) totalScore = fundamental.score;
        return {
          total_score: totalScore,
          technical_score: technical?.score,
          fundamental_score: fundamental?.score,
          technical_details: technical?.indicators,
          fundamental_details: fundamental?.details,
        };
      }
      case 'get_institutional':
        return await analyzeInstitutionalTrend(input.stock_id, input.days || 20);
      case 'get_margin':
        return await analyzeMarginTrend(input.stock_id);
      case 'get_revenue':
        return await analyzeRevenueTrend(input.stock_id);
      case 'get_financial':
        return await getFinancialSummary(input.stock_id);
      case 'get_valuation':
        return await calculateValuation(input.stock_id);
      case 'screen_stocks': {
        if (input.strategy) {
          return await screenByStrategy(input.strategy, { rsi_threshold: input.rsi_max || 30 });
        }
        let query = `
          SELECT s.stock_id, s.stock_name, dp.close_price, dp.change_percent,
                 ti.rsi, ti.kd_k, ti.kd_d, ti.macd_histogram, ti.ma20
          FROM stocks s
          JOIN daily_prices dp ON s.stock_id = dp.stock_id
          JOIN technical_indicators ti ON s.stock_id = ti.stock_id
            AND dp.trade_date = ti.trade_date
          WHERE dp.trade_date = (SELECT MAX(trade_date) FROM daily_prices WHERE stock_id = s.stock_id)
        `;
        const params = [];
        if (input.rsi_min != null) { query += ' AND ti.rsi >= ?'; params.push(input.rsi_min); }
        if (input.rsi_max != null) { query += ' AND ti.rsi <= ?'; params.push(input.rsi_max); }
        if (input.ma_position === 'above') query += ' AND dp.close_price > ti.ma20';
        else if (input.ma_position === 'below') query += ' AND dp.close_price < ti.ma20';
        if (input.macd_positive) query += ' AND ti.macd_histogram > 0';
        if (input.kd_golden_cross) query += ' AND ti.kd_k > ti.kd_d';
        query += ' ORDER BY dp.change_percent DESC LIMIT 30';
        const [rows] = await pool.query(query, params);
        return { data: rows, count: rows.length };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  };

  // ── System prompt ─────────────────────────────────────────────
  const contextDesc = context.stockId
    ? `使用者目前正在查看 ${context.stockName || context.stockId}（${context.stockId}），頁面：${context.page || '台股分析'}。`
    : `使用者目前在頁面：${context.page || '台股分析'}。`;

  const systemPrompt = `你是一位專業的台股分析師助理，整合在台股分析系統中。
${contextDesc}
你有工具可以查詢即時股票資料（技術指標、籌碼、財報、月營收、估值、股票篩選等）。
遇到需要數據的問題，主動使用工具查詢，不要只靠記憶回答。
回覆用繁體中文，語言直接精準，重點清晰。給出有參考價值的具體觀點，避免空洞的免責聲明。`;

  // ── Agentic loop ──────────────────────────────────────────────
  try {
    const client = new Anthropic({ apiKey });
    let currentMessages = messages.map(m => ({ role: m.role, content: m.content }));

    for (let iteration = 0; iteration < 6; iteration++) {
      const stream = client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages: currentMessages,
      });

      let toolUses = [];
      let currentToolUse = null;
      let assistantContent = [];

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            assistantContent.push({ type: 'text', text: '' });
          } else if (event.content_block.type === 'tool_use') {
            currentToolUse = { id: event.content_block.id, name: event.content_block.name, input_json: '' };
            assistantContent.push({ type: 'tool_use', id: event.content_block.id, name: event.content_block.name, input: null });
          }
        }
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const last = assistantContent[assistantContent.length - 1];
            if (last?.type === 'text') last.text += event.delta.text;
            emit({ text: event.delta.text });
          }
          if (event.delta.type === 'input_json_delta' && currentToolUse) {
            currentToolUse.input_json += event.delta.partial_json;
          }
        }
        if (event.type === 'content_block_stop' && currentToolUse) {
          try { currentToolUse.input = JSON.parse(currentToolUse.input_json || '{}'); } catch { currentToolUse.input = {}; }
          toolUses.push(currentToolUse);
          const last = assistantContent[assistantContent.length - 1];
          if (last?.type === 'tool_use') last.input = currentToolUse.input;
          currentToolUse = null;
        }
      }

      const finalMsg = await stream.finalMessage();

      if (finalMsg.stop_reason === 'end_turn' || toolUses.length === 0) {
        emit({ done: true });
        break;
      }

      // tool_use: add assistant turn, then execute tools
      currentMessages.push({ role: 'assistant', content: assistantContent });

      const toolResults = [];
      for (const tu of toolUses) {
        emit({ tool_call: { name: tu.name, input: tu.input } });
        try {
          const result = await executeTool(tu.name, tu.input);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${err.message}`, is_error: true });
        }
      }
      currentMessages.push({ role: 'user', content: toolResults });
    }

    res.end();
  } catch (err) {
    console.error('Chat error:', err.message);
    emit({ error: err.message });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n台股分析系統 v2.0 啟動成功！`);
  console.log(`網址: http://localhost:${PORT}`);
  console.log(`按 Ctrl+C 停止伺服器\n`);
});

module.exports = app;
