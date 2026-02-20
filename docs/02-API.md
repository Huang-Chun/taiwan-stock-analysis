# API 端點說明

## 基本資訊

- **Base URL**: `http://localhost:3000`
- **格式**: 所有回應皆為 JSON
- **錯誤格式**: `{ "error": "錯誤訊息" }`

---

## 一、股票基本查詢

### `GET /api/stocks`
搜尋/列出股票清單

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `keyword` | query | 否 | 模糊搜尋股票名稱或代號 |

```
GET /api/stocks?keyword=台積
→ [{ stock_id: "2330", stock_name: "台積電", industry: "半導體業", ... }]
```

---

### `GET /api/stocks/:stockId`
取得單一股票詳細資訊

```
GET /api/stocks/2330
→ { stock_id: "2330", stock_name: "台積電", industry: "半導體業",
     market_type: "上市", listing_date: "1994-09-05", capital: 259303805 }
```

---

### `GET /api/stocks/:stockId/prices`
取得歷史股價

| 參數 | 類型 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `limit` | query | 否 | 30 | 回傳筆數 |

```
GET /api/stocks/2330/prices?limit=5
→ [{ trade_date: "2026-02-14", open_price: 980, high_price: 985,
     low_price: 975, close_price: 982, volume: 25000000, ... }]
```

回傳欄位：`trade_date`, `open_price`, `high_price`, `low_price`, `close_price`, `volume`, `turnover`, `transactions`, `change_amount`, `change_percent`

---

### `GET /api/stocks/:stockId/latest`
取得最新股價 + 全部技術指標

```
GET /api/stocks/2330/latest
→ {
    stock_id: "2330", stock_name: "台積電",
    trade_date: "2026-02-14",
    close_price: 982, volume: 25000000,
    // 均線
    ma5: 978, ma10: 972, ma20: 965, ma60: 940,
    // RSI
    rsi: 62.5,
    // MACD
    macd: 5.2, macd_signal: 3.8, macd_histogram: 1.4,
    // KD
    kd_k: 71.3, kd_d: 65.8,
    // 布林通道
    bollinger_upper: 1005, bollinger_middle: 965, bollinger_lower: 925,
    // 進階指標
    vwap: 970, atr: 18.5, adx: 28.3,
    plus_di: 25.1, minus_di: 18.7,
    williams_r: -28.5, obv: 150000000
  }
```

---

## 二、技術分析篩選

### `GET /api/analysis/screen`
依技術指標條件篩選股票

| 參數 | 類型 | 說明 |
|------|------|------|
| `rsi_min` | query | RSI 最小值 |
| `rsi_max` | query | RSI 最大值 |
| `ma_position` | query | `above`（站上 MA20）或 `below`（跌破 MA20）|
| `volume_min` | query | 最小成交量 |
| `kd_golden_cross` | query | `true` = 篩選 K > D |
| `macd_positive` | query | `true` = 篩選 MACD 柱狀圖 > 0 |
| `adx_min` | query | ADX 最小值（趨勢強度）|

```
GET /api/analysis/screen?rsi_min=20&rsi_max=40&ma_position=above
→ [{ stock_id: "xxxx", stock_name: "...", close_price: ..., rsi: ..., ... }]
```

---

### `GET /api/analysis/screen/strategy/:strategy`
依預設策略篩選

| 策略名稱 | 說明 |
|----------|------|
| `golden_cross` | MA5 向上穿越 MA20（黃金交叉）|
| `rsi_oversold` | RSI < 閾值（預設 30）|
| `macd_golden_cross` | MACD 柱狀圖由負轉正 |
| `volume_breakout` | 成交量 > 20 日均量的 2 倍 |
| `bollinger_squeeze` | 布林通道收縮最窄 |

| 參數 | 類型 | 說明 |
|------|------|------|
| `rsi_threshold` | query | RSI 閾值（僅 rsi_oversold 使用，預設 30）|

```
GET /api/analysis/screen/strategy/golden_cross
→ [{ stock_id: "xxxx", stock_name: "...", ... }]
```

---

## 三、訊號偵測與評分

### `GET /api/stocks/:stockId/signals`
偵測交易訊號

回傳 5 種訊號的偵測結果：

| 訊號 | 說明 |
|------|------|
| MA 交叉 | MA5 與 MA20 的黃金/死亡交叉 |
| RSI 超賣反彈 | RSI 從 <30 回升至 ≥30 |
| MACD 交叉 | MACD 柱狀圖正負翻轉 |
| 量能突破 | 成交量爆量（> 2 倍均量）|
| 布林突破 | 股價突破布林通道上/下軌 |

```
GET /api/stocks/2330/signals
→ {
    signals: [
      { type: "macd_crossover", direction: "bullish", description: "MACD 柱狀圖轉正" },
      { type: "volume_breakout", direction: "bullish", description: "成交量突破 2 倍均量" }
    ]
  }
```

---

### `GET /api/stocks/:stockId/score`
綜合評分（0-100 分）

評分權重：

| 面向 | 權重 | 評分依據 |
|------|------|----------|
| RSI | 20% | 30-50 最佳，>70 或 <30 扣分 |
| 均線排列 | 20% | 多頭排列加分，空頭排列扣分 |
| MACD | 15% | 柱狀圖為正加分 |
| KD | 15% | K>D 且未超買加分 |
| 成交量 | 10% | 爆量 + 趨勢向上加分 |
| ADX | 10% | 趨勢明確（>25）加分 |
| 布林通道 | 10% | 位於 50-80% 位置最佳 |

```
GET /api/stocks/2330/score
→ {
    stock_id: "2330",
    technical_score: 72,
    fundamental_score: 68,
    total_score: 70,
    details: { ... }
  }
```

---

## 四、籌碼面分析

### `GET /api/stocks/:stockId/institutional`
三大法人買賣超趨勢

| 參數 | 類型 | 預設 | 說明 |
|------|------|------|------|
| `days` | query | 20 | 分析天數 |

```
GET /api/stocks/2330/institutional?days=10
→ {
    summary: {
      foreign: { net_total: 15000, buy_days: 7, sell_days: 3, trend: "買超" },
      trust:   { net_total: 5000, buy_days: 6, sell_days: 4, trend: "買超" },
      dealer:  { net_total: -2000, buy_days: 3, sell_days: 7, trend: "賣超" }
    },
    consensus: "偏多",
    daily: [...]
  }
```

---

### `GET /api/stocks/:stockId/margin`
融資融券趨勢

| 參數 | 類型 | 預設 | 說明 |
|------|------|------|------|
| `days` | query | 20 | 分析天數 |

```
GET /api/stocks/2330/margin?days=10
→ {
    margin: { balance: 50000, change: -2000, trend: "減少" },
    short:  { balance: 8000, change: 500, trend: "增加" },
    daily: [...]
  }
```

---

### `GET /api/analysis/screen/institutional`
依法人籌碼篩選

| 參數 | 類型 | 說明 |
|------|------|------|
| `foreign_net_min` | query | 外資累計淨買超最低值（股）|
| `trust_net_min` | query | 投信累計淨買超最低值（股）|
| `days` | query | 累計天數（預設 5）|

```
GET /api/analysis/screen/institutional?foreign_net_min=10000&days=5
→ [{ stock_id: "xxxx", stock_name: "...", foreign_net: 25000, ... }]
```

---

## 五、基本面分析

### `GET /api/stocks/:stockId/revenue`
月營收趨勢

| 參數 | 類型 | 預設 | 說明 |
|------|------|------|------|
| `months` | query | 12 | 查看月數 |

```
GET /api/stocks/2330/revenue?months=6
→ {
    data: [
      { year: 2026, month: 1, revenue: 280000000000,
        revenue_mom: 5.2, revenue_yoy: 35.1,
        cumulative_revenue: 280000000000, cumulative_yoy: 35.1 }
    ],
    trend: "strong_growth",
    description: "營收年增率持續 > 20%"
  }
```

營收趨勢分類：
- `strong_growth` — 年增率持續 > 20%
- `stable_growth` — 年增率穩定正成長
- `turnaround` — 由衰退轉為成長
- `decline` — 年增率持續為負
- `volatile` — 波動劇烈

---

### `GET /api/stocks/:stockId/financial`
最近 4 季財報摘要

```
GET /api/stocks/2330/financial
→ {
    statements: [
      {
        year: 2025, quarter: 3,
        revenue: 760000000000,
        gross_profit: 430000000000,
        operating_income: 350000000000,
        net_income: 300000000000,
        eps: 11.6
      }
    ],
    ratios: [
      {
        year: 2025, quarter: 3,
        roe: 28.5, roa: 15.2,
        gross_margin: 56.6, operating_margin: 46.1, net_margin: 39.5,
        current_ratio: 2.1, debt_ratio: 35.2
      }
    ]
  }
```

---

### `GET /api/stocks/:stockId/valuation`
估值指標

```
GET /api/stocks/2330/valuation
→ {
    pe_ratio: 22.5,          // 本益比（股價 ÷ 近四季 EPS）
    pb_ratio: 6.8,           // 股價淨值比（股價 ÷ 每股淨值）
    dividend_yield: 1.8,     // 殖利率（現金股利 ÷ 股價 × 100%）
    eps_ttm: 43.6,           // 近四季 EPS 合計
    book_value_per_share: 144.5
  }
```

---

## 六、系統

### `GET /api/health`
健康檢查（確認資料庫連線）

```
GET /api/health
→ { status: "ok", database: "connected" }
```
