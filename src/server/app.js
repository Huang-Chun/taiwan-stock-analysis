const express = require('express');
const { pool } = require('../database/connection');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中介軟體
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// API 路由
// ============================================

// 取得所有股票清單
app.get('/api/stocks', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT stock_id, stock_name, industry, market_type FROM stocks WHERE is_active = TRUE ORDER BY stock_id'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 取得單一股票資訊
app.get('/api/stocks/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    
    const [rows] = await pool.query(
      'SELECT * FROM stocks WHERE stock_id = ?',
      [stockId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '股票不存在' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 取得股票歷史價格
app.get('/api/stocks/:stockId/prices', async (req, res) => {
  try {
    const { stockId } = req.params;
    const { limit = 30 } = req.query;

    const [rows] = await pool.query(
      `SELECT * FROM daily_prices 
       WHERE stock_id = ? 
       ORDER BY trade_date DESC 
       LIMIT ?`,
      [stockId, parseInt(limit)]
    );

    res.json({ success: true, data: rows.reverse() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 取得股票最新資料（含技術指標）
app.get('/api/stocks/:stockId/latest', async (req, res) => {
  try {
    const { stockId } = req.params;

    const [rows] = await pool.query(
      `SELECT 
        s.stock_id,
        s.stock_name,
        s.industry,
        dp.trade_date,
        dp.close_price,
        dp.open_price,
        dp.high_price,
        dp.low_price,
        dp.volume,
        dp.change_amount,
        dp.change_percent,
        ti.ma5,
        ti.ma10,
        ti.ma20,
        ti.ma60,
        ti.rsi,
        ti.macd,
        ti.kd_k,
        ti.kd_d
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

// 取得技術指標篩選結果
app.get('/api/analysis/screen', async (req, res) => {
  try {
    const { 
      rsi_min, 
      rsi_max, 
      ma_position, // 'above' 或 'below'
      volume_min 
    } = req.query;

    let query = `
      SELECT 
        s.stock_id,
        s.stock_name,
        dp.close_price,
        dp.change_percent,
        dp.volume,
        ti.rsi,
        ti.ma5,
        ti.ma20,
        ti.kd_k
      FROM stocks s
      JOIN daily_prices dp ON s.stock_id = dp.stock_id
      JOIN technical_indicators ti ON s.stock_id = ti.stock_id 
        AND dp.trade_date = ti.trade_date
      WHERE dp.trade_date = (
        SELECT MAX(trade_date) FROM daily_prices WHERE stock_id = s.stock_id
      )
    `;

    const params = [];

    if (rsi_min) {
      query += ' AND ti.rsi >= ?';
      params.push(parseFloat(rsi_min));
    }

    if (rsi_max) {
      query += ' AND ti.rsi <= ?';
      params.push(parseFloat(rsi_max));
    }

    if (ma_position === 'above') {
      query += ' AND dp.close_price > ti.ma20';
    } else if (ma_position === 'below') {
      query += ' AND dp.close_price < ti.ma20';
    }

    if (volume_min) {
      query += ' AND dp.volume >= ?';
      params.push(parseInt(volume_min));
    }

    query += ' ORDER BY dp.change_percent DESC LIMIT 50';

    const [rows] = await pool.query(query, params);

    res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 健康檢查
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, status: 'unhealthy', error: error.message });
  }
});

// ============================================
// 網頁路由
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
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
        .header {
          background: white;
          padding: 30px;
          border-radius: 15px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          margin-bottom: 30px;
          text-align: center;
        }
        h1 {
          color: #667eea;
          margin-bottom: 10px;
        }
        .subtitle {
          color: #666;
          font-size: 16px;
        }
        .card {
          background: white;
          padding: 25px;
          border-radius: 15px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          margin-bottom: 20px;
        }
        .card h2 {
          color: #333;
          margin-bottom: 15px;
          border-bottom: 2px solid #667eea;
          padding-bottom: 10px;
        }
        .api-list {
          list-style: none;
        }
        .api-list li {
          padding: 12px;
          margin: 8px 0;
          background: #f8f9fa;
          border-left: 4px solid #667eea;
          border-radius: 5px;
          font-family: 'Courier New', monospace;
        }
        .api-list li:hover {
          background: #e9ecef;
          cursor: pointer;
        }
        .method {
          color: #28a745;
          font-weight: bold;
          margin-right: 10px;
        }
        .endpoint {
          color: #495057;
        }
        .description {
          color: #6c757d;
          font-size: 14px;
          margin-top: 5px;
        }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background: #667eea;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          margin: 10px 5px;
          transition: all 0.3s;
        }
        .button:hover {
          background: #764ba2;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }
        .status {
          display: inline-block;
          padding: 5px 15px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: bold;
        }
        .status.online {
          background: #d4edda;
          color: #155724;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📈 台股分析系統</h1>
          <p class="subtitle">Taiwan Stock Analysis System</p>
          <p style="margin-top: 10px;">
            <span class="status online">● 系統運行中</span>
          </p>
        </div>

        <div class="card">
          <h2>🚀 快速開始</h2>
          <p style="margin-bottom: 15px;">歡迎使用台股分析系統！以下是可用的 API 端點：</p>
          <ul class="api-list">
            <li>
              <span class="method">GET</span>
              <span class="endpoint">/api/stocks</span>
              <div class="description">取得所有股票清單</div>
            </li>
            <li>
              <span class="method">GET</span>
              <span class="endpoint">/api/stocks/:stockId</span>
              <div class="description">取得單一股票資訊（例如：/api/stocks/2330）</div>
            </li>
            <li>
              <span class="method">GET</span>
              <span class="endpoint">/api/stocks/:stockId/prices</span>
              <div class="description">取得股票歷史價格</div>
            </li>
            <li>
              <span class="method">GET</span>
              <span class="endpoint">/api/stocks/:stockId/latest</span>
              <div class="description">取得股票最新資料（含技術指標）</div>
            </li>
            <li>
              <span class="method">GET</span>
              <span class="endpoint">/api/analysis/screen</span>
              <div class="description">技術指標篩選（參數：rsi_min, rsi_max, ma_position, volume_min）</div>
            </li>
          </ul>
        </div>

        <div class="card">
          <h2>📊 範例查詢</h2>
          <a href="/api/stocks/2330/latest" class="button">查看台積電 (2330)</a>
          <a href="/api/analysis/screen?rsi_max=30" class="button">找出 RSI < 30 的股票</a>
          <a href="/api/health" class="button">系統健康檢查</a>
        </div>

        <div class="card">
          <h2>💡 使用說明</h2>
          <p style="line-height: 1.8; color: #555;">
            1. 先執行 <code>npm run fetch-stocks</code> 抓取股票清單<br>
            2. 執行 <code>npm run fetch-prices</code> 抓取股價資料<br>
            3. 執行 <code>npm run calculate-indicators</code> 計算技術指標<br>
            4. 使用上方 API 端點查詢資料
          </p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`\n🚀 伺服器啟動成功！`);
  console.log(`📍 網址: http://localhost:${PORT}`);
  console.log(`📊 API 文件: http://localhost:${PORT}/api`);
  console.log(`\n按 Ctrl+C 停止伺服器\n`);
});

module.exports = app;
