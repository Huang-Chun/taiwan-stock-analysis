# Server 架構說明

## 概覽

本專案有兩個 Server：

| Server | 檔案 | 協定 | 用途 |
|--------|------|------|------|
| Express REST API | `src/server/app.js` | HTTP (port 3000) | 提供 REST API 給前端/外部呼叫 |
| MCP Server | `src/mcp/server.js` | stdio | 讓 Claude Code 直接呼叫股票工具 |

---

## 1. Express REST API (`src/server/app.js`)

### 啟動方式

```bash
npm start          # 或
npm run server     # 兩者相同
```

啟動後監聽 `PORT` 環境變數（預設 3000）。

### 架構流程

```
使用者 / 前端
    ↓ HTTP Request
Express Server (port 3000)
    ↓ 呼叫
Analysis 模組 / Database 查詢
    ↓ 回傳 JSON
使用者 / 前端
```

### 首頁

`GET /` 會回傳一個 HTML 頁面，列出所有 API 端點和說明，方便快速查閱。

### 中介層 (Middleware)

- `express.json()` — 解析 JSON body
- CORS headers — 允許跨域請求
- 錯誤處理 — 統一回傳 `{ error: message }`

---

## 2. MCP Server (`src/mcp/server.js`)

### 什麼是 MCP？

MCP（Model Context Protocol）讓 AI 模型（如 Claude）可以直接呼叫你定義的工具函式，不需要透過 HTTP。

### 啟動方式

```bash
npm run mcp
```

透過 **stdio**（標準輸入/輸出）通訊，不佔用網路端口。

### 設定檔

MCP 設定在專案根目錄的 `.mcp.json`：

```json
{
  "mcpServers": {
    "taiwan-stock": {
      "command": "node",
      "args": ["src/mcp/server.js"]
    }
  }
}
```

### 工具分類

MCP Server 提供 **25+ 個工具**，分三大類：

#### 查詢工具（唯讀）
| 工具名稱 | 用途 |
|----------|------|
| `get_stock_list` | 搜尋股票（模糊搜尋名稱/代號）|
| `get_stock_detail` | 單一股票詳細資訊 |
| `get_stock_prices` | 歷史股價 |
| `get_stock_latest` | 最新股價 + 全部技術指標 |
| `screen_stocks` | 依技術指標篩選 |
| `get_institutional_trading` | 三大法人買賣超 |
| `get_margin_trading` | 融資融券資料 |
| `get_monthly_revenue` | 月營收趨勢 |
| `get_financial_summary` | 季度財報摘要 |
| `get_valuation` | 估值指標（PE/PB/殖利率）|

#### 分析工具
| 工具名稱 | 用途 |
|----------|------|
| `detect_signals` | 偵測交易訊號（黃金交叉、RSI 超賣等）|
| `score_stock` | 綜合評分（技術 + 基本面，0-100）|
| `screen_by_strategy` | 策略選股（5 種預設策略）|
| `screen_by_institutional` | 籌碼面選股 |

#### 同步工具（爬蟲）
| 工具名稱 | 資料來源 | 用途 |
|----------|----------|------|
| `sync_stock_list` | TWSE | 同步上市股票清單 |
| `sync_daily_prices` | TWSE | 同步每日股價 |
| `calculate_indicators` | 本地計算 | 計算技術指標 |
| `sync_institutional_trading` | TWSE | 同步法人買賣超 |
| `sync_margin_trading` | TWSE | 同步融資融券 |
| `sync_monthly_revenue` | FinMind | 同步月營收 |
| `sync_financial_statements` | FinMind | 同步季度財報 |
| `sync_dividends` | TWSE | 同步股利資料 |

---

## 3. 爬蟲模組 (`src/crawler/*.js`)

### 資料來源

| 來源 | 爬蟲檔案 | 需要 Token |
|------|----------|-----------|
| TWSE（台灣證交所）| fetchStockList, fetchDailyPrices, fetchInstitutionalTrading, fetchMarginTrading, fetchDividends | 否 |
| FinMind API | fetchMonthlyRevenue, fetchFinancialStatements | 是（`FINMIND_TOKEN`）|

### FinMind 限流

- 共用模組：`src/crawler/finmindApi.js`
- 限制：滑動視窗 **550 次/小時**（安全邊界，官方上限 600）
- 超過限制會自動等待，不會報錯

### 各爬蟲功能

每個爬蟲都遵循相同模式：
1. **匯出函式** — 可被其他模組 `require()` 呼叫
2. **CLI 執行** — 可用 `node src/crawler/fetchXxx.js` 直接執行
3. **交易寫入** — 使用 MySQL Transaction + `ON DUPLICATE KEY UPDATE`（不怕重複執行）

### NPM 腳本

```bash
npm run fetch-stocks         # 同步股票清單
npm run fetch-prices         # 同步股價（預設前 10 檔）
npm run fetch-institutional  # 同步法人買賣超
npm run fetch-margin         # 同步融資融券
npm run fetch-revenue        # 同步月營收
npm run fetch-financial      # 同步季度財報
npm run fetch-dividends      # 同步股利資料
npm run calculate-indicators # 計算技術指標
```

---

## 4. 分析模組 (`src/analysis/*.js`)

| 模組 | 功能 |
|------|------|
| `calculateIndicators.js` | 計算 15+ 種技術指標（MA/RSI/MACD/KD/布林/VWAP/ATR/ADX 等）|
| `strategies.js` | 交易訊號偵測 + 綜合評分 |
| `institutionalAnalysis.js` | 三大法人籌碼分析 + 共識度判斷 |
| `fundamentalAnalysis.js` | 營收趨勢 + 估值 + EPS 趨勢 + 基本面評分 |

---

## 5. 整體資料流

```
外部資料源（TWSE / FinMind）
        ↓ 爬蟲抓取
    MySQL 資料庫
        ↓ 查詢 & 計算
    分析模組
        ↓
  ┌─────────┬──────────┐
  │ REST API │ MCP Server│
  │ (HTTP)   │ (stdio)   │
  └─────────┴──────────┘
        ↓
  前端使用者 / Claude
```
