const express = require('express');
const { pool } = require('../database/connection');
const path = require('path');
require('dotenv').config();

const { detectAllSignals, scoreStock, screenByStrategy } = require('../analysis/strategies');
const { analyzeInstitutionalTrend, detectAccumulation, analyzeConsensus, analyzeMarginTrend, screenByInstitutional } = require('../analysis/institutionalAnalysis');
const { analyzeRevenueTrend, calculateValuation, getFinancialSummary, scoreFundamental } = require('../analysis/fundamentalAnalysis');

const app = express();
const PORT = process.env.PORT || 3000;

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
    const days = Math.min(parseInt(req.query.days) || 120, 500);
    // 多抓 60 筆暖機資料讓 MACD/KD 更準確
    const [rows] = await pool.query(
      `SELECT trade_date, close_price, high_price, low_price
       FROM daily_prices WHERE stock_id = ?
       ORDER BY trade_date DESC LIMIT ?`,
      [stockId, days + 60]
    );
    if (rows.length === 0) return res.json({ success: true, data: { dates:[], rsi:[], macd:[], macd_signal:[], macd_histogram:[], kd_k:[], kd_d:[] } });

    const all    = rows.reverse();
    const closes = all.map(r => parseFloat(r.close_price));
    const highs  = all.map(r => parseFloat(r.high_price));
    const lows   = all.map(r => parseFloat(r.low_price));

    const rsiArr  = calcRSISeries(closes);
    const macdObj = calcMACDSeries(closes);
    const kdObj   = calcKDSeries(highs, lows, closes);

    // 只回傳最近 days 筆（去掉暖機資料）
    const trim = arr => arr.slice(-days);
    const trimDates = all.slice(-days).map(r => r.trade_date.toISOString().split('T')[0]);

    res.json({
      success: true,
      data: {
        dates:          trimDates,
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
        dates:       data.map(r => r.trade_date.toISOString().split('T')[0]),
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
    const days = Math.min(parseInt(req.query.days) || 120, 500);

    // 多抓 60 筆讓 MA60 能有足夠的暖機資料
    const [rows] = await pool.query(
      `SELECT trade_date, open_price, high_price, low_price, close_price, volume, change_percent
       FROM daily_prices
       WHERE stock_id = ?
       ORDER BY trade_date DESC
       LIMIT ?`,
      [stockId, days + 60]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '無資料' });
    }

    const all = rows.reverse();
    const closes = all.map(r => parseFloat(r.close_price));

    // 在 server 端直接算 MA 序列，不依賴 technical_indicators
    const calcMA = (arr, n) => arr.map((_, i) =>
      i < n - 1 ? null : +( arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n ).toFixed(2)
    );

    const ma5  = calcMA(closes, 5);
    const ma10 = calcMA(closes, 10);
    const ma20 = calcMA(closes, 20);
    const ma60 = calcMA(closes, 60);

    // 只回傳使用者要求的天數，但 MA 已有完整暖機
    const offset = all.length - days;
    const data   = all.slice(offset);

    // 偵測歷史 MA 交叉訊號（在顯示範圍內）
    const signals = [];
    for (let i = 1; i < all.length; i++) {
      if (i < offset) continue; // 只回傳顯示範圍內的訊號
      if (ma5[i] == null || ma20[i] == null || ma5[i-1] == null || ma20[i-1] == null) continue;
      const dateStr = all[i].trade_date.toISOString().split('T')[0];
      if (ma5[i-1] <= ma20[i-1] && ma5[i] > ma20[i])
        signals.push({ date: dateStr, type: 'golden_cross', label: '金叉' });
      else if (ma5[i-1] >= ma20[i-1] && ma5[i] < ma20[i])
        signals.push({ date: dateStr, type: 'death_cross', label: '死叉' });
    }

    res.json({
      success: true,
      data: {
        dates:          data.map(r => r.trade_date.toISOString().split('T')[0]),
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
// 管理用：一鍵更新股價 + 重算指標
// ============================================

app.post('/api/admin/sync', async (req, res) => {
  try {
    const { fetchAllStocksLatestPrices } = require('../crawler/fetchDailyPrices');
    const { calculateAllIndicators } = require('../analysis/calculateIndicators');

    const priceResult = await fetchAllStocksLatestPrices();
    await calculateAllIndicators();

    res.json({ success: true, message: `已更新 ${priceResult.count} 檔股票股價（${priceResult.tradeDate}），技術指標重算完成` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
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

app.listen(PORT, () => {
  console.log(`\n台股分析系統 v2.0 啟動成功！`);
  console.log(`網址: http://localhost:${PORT}`);
  console.log(`按 Ctrl+C 停止伺服器\n`);
});

module.exports = app;
