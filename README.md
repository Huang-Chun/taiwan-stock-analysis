# 台股分析系統 Taiwan Stock Analysis System

一個完整的台股分析系統，支援技術分析與基本面分析。

## 📋 功能特色

- ✅ 自動抓取台股股票清單
- ✅ 抓取每日股價資料（開高低收、成交量）
- ✅ 計算技術指標（MA、RSI、MACD、KD、布林通道）
- ✅ 提供 RESTful API 查詢介面
- ✅ 網頁介面展示
- 📊 支援技術指標篩選（找出符合條件的股票）

## 🛠️ 系統需求

- Node.js 16.x 或更高版本
- MySQL 8.0 或更高版本
- 網路連線（抓取資料用）

## 📦 安裝步驟

### 1. 安裝 MySQL

下載並安裝 MySQL：https://dev.mysql.com/downloads/installer/

安裝時記住你設定的 **root 密碼**！

### 2. 安裝專案

```bash
# 解壓縮專案檔案到你想要的位置
cd taiwan-stock-analysis

# 安裝相依套件
npm install
```

### 3. 設定環境變數

複製 `.env.example` 為 `.env`：

```bash
copy .env.example .env     # Windows
cp .env.example .env       # Mac/Linux
```

編輯 `.env` 檔案，修改以下設定：

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=你的MySQL密碼
DB_NAME=taiwan_stock_db
DB_PORT=3306
PORT=3000
```

### 4. 初始化資料庫

```bash
npm run init-db
```

成功後會看到：
```
✓ 成功連接到 MySQL
✓ 資料庫 taiwan_stock_db 已建立或已存在
✓ 資料表結構建立完成
```

## 🚀 使用方式

### 步驟 1：抓取股票清單

```bash
npm run fetch-stocks
```

這會從台灣證交所抓取所有上市股票清單（約 1000+ 檔）。

### 步驟 2：抓取股價資料

```bash
npm run fetch-prices
```

> ⚠️ 注意：
> - 首次執行會抓取前 10 檔股票的資料（示範用）
> - 證交所有請求頻率限制，程式會自動加入延遲
> - 完整抓取所有股票需要較長時間

### 步驟 3：計算技術指標

```bash
npm run calculate-indicators
```

計算所有股票的技術指標（MA、RSI、MACD、KD、布林通道）。

### 步驟 4：啟動網頁伺服器

```bash
npm run server
```

然後打開瀏覽器訪問：http://localhost:3000

## 📡 API 使用說明

### 1. 取得所有股票清單

```
GET /api/stocks
```

回應範例：
```json
{
  "success": true,
  "data": [
    {
      "stock_id": "2330",
      "stock_name": "台積電",
      "industry": "半導體業",
      "market_type": "上市"
    }
  ]
}
```

### 2. 取得單一股票最新資料（含技術指標）

```
GET /api/stocks/:stockId/latest
```

範例：`/api/stocks/2330/latest`

回應範例：
```json
{
  "success": true,
  "data": {
    "stock_id": "2330",
    "stock_name": "台積電",
    "close_price": "580.00",
    "change_percent": "1.23",
    "ma5": "575.60",
    "ma20": "565.30",
    "rsi": "65.42",
    "macd": "2.45",
    "kd_k": "72.50"
  }
}
```

### 3. 取得歷史價格

```
GET /api/stocks/:stockId/prices?limit=30
```

範例：`/api/stocks/2330/prices?limit=30` （最近 30 天）

### 4. 技術指標篩選

```
GET /api/analysis/screen?rsi_max=30&ma_position=below
```

參數說明：
- `rsi_min`: RSI 最小值
- `rsi_max`: RSI 最大值
- `ma_position`: 股價相對均線位置（`above` 或 `below`）
- `volume_min`: 最小成交量

範例：
```
# 找出 RSI < 30 且股價在 20MA 之下的股票（超跌）
/api/analysis/screen?rsi_max=30&ma_position=below

# 找出 RSI > 70 且成交量 > 10000000 的股票（強勢）
/api/analysis/screen?rsi_min=70&volume_min=10000000
```

## 📁 專案結構

```
taiwan-stock-analysis/
├── src/
│   ├── database/
│   │   ├── init.js              # 資料庫初始化
│   │   ├── connection.js        # 資料庫連接池
│   │   └── schema.sql           # 資料庫結構
│   ├── crawler/
│   │   ├── fetchStockList.js    # 抓取股票清單
│   │   └── fetchDailyPrices.js  # 抓取每日股價
│   ├── analysis/
│   │   └── calculateIndicators.js # 計算技術指標
│   └── server/
│       └── app.js               # Express 網頁伺服器
├── package.json
├── .env.example
└── README.md
```

## 🔧 進階設定

### 修改抓取範圍

編輯 `src/crawler/fetchDailyPrices.js`：

```javascript
// 改成抓取所有股票（移除 LIMIT 10）
const [stocks] = await connection.query(
  'SELECT stock_id FROM stocks WHERE is_active = TRUE'
  // 移除 LIMIT 10
);
```

### 設定自動更新

可以使用 Windows 工作排程器或 cron 設定每日自動執行：

```bash
# 每天下午 3:30 更新資料
npm run fetch-prices
npm run calculate-indicators
```

## ⚠️ 常見問題

### Q: 資料庫連接失敗？

A: 檢查：
1. MySQL 服務是否啟動
2. `.env` 檔案中的密碼是否正確
3. 防火牆是否阻擋 3306 port

### Q: 抓取資料失敗？

A: 可能原因：
1. 網路連線問題
2. 證交所網站維護中
3. 請求頻率過快被擋（程式已有延遲機制）

### Q: 計算指標時顯示「資料不足」？

A: 需要先抓取足夠的歷史資料（至少 60 天）才能計算完整的技術指標。

## 📚 資料來源

- 股票清單：台灣證券交易所 (TWSE)
- 股價資料：台灣證券交易所 (TWSE)
- 資料更新：交易日每日下午 2:00 後

## 🎯 未來功能規劃

- [ ] 財報資料抓取
- [ ] 月營收資料
- [ ] 三大法人買賣超
- [ ] 股利資料
- [ ] 更豐富的網頁介面（圖表展示）
- [ ] 回測功能
- [ ] 自選股管理
- [ ] 價格提醒

## 📄 授權

MIT License

## 🙋 需要幫助？

如有問題，請檢查：
1. Node.js 和 MySQL 是否正確安裝
2. `.env` 設定是否正確
3. 網路連線是否正常

---

祝你投資順利！📈
