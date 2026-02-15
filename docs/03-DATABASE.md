# Database 架構說明

## 基本資訊

- **資料庫**: MySQL 5.7+
- **連線方式**: `mysql2/promise` 連接池（最多 10 連線）
- **設定檔**: `.env` 中的 `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- **Schema 檔**: `src/database/schema.sql` + `src/database/migrations/`

### 初始化

```bash
npm run init-db    # 執行 schema.sql + migrations，建立所有表格
```

---

## 資料表總覽

```
stocks ─────────────┐
  (股票基本資料)      │ stock_id 為所有表的外鍵
                     ├── daily_prices（每日股價）
                     ├── technical_indicators（技術指標）
                     ├── institutional_trading（法人買賣超）
                     ├── margin_trading（融資融券）
                     ├── monthly_revenue（月營收）
                     ├── financial_statements（季度財報）
                     ├── financial_ratios（財務比率）
                     ├── dividends（股利）
                     ├── user_watchlists（自選股）
                     └── price_alerts（價格提醒）
```

---

## 1. `stocks` — 股票基本資料

| 欄位 | 類型 | 說明 |
|------|------|------|
| `stock_id` | VARCHAR(10) **PK** | 股票代號（如 "2330"）|
| `stock_name` | VARCHAR(50) | 股票名稱（如 "台積電"）|
| `industry` | VARCHAR(50) | 產業別 |
| `market_type` | VARCHAR(10) | 上市/上櫃 |
| `listing_date` | DATE | 上市日期 |
| `capital` | BIGINT | 實收資本額 |
| `is_active` | BOOLEAN | 是否仍在交易（預設 true）|

**資料來源**: TWSE (`npm run fetch-stocks`)

---

## 2. `daily_prices` — 每日股價

| 欄位 | 類型 | 說明 |
|------|------|------|
| `stock_id` | VARCHAR(10) | 股票代號 |
| `trade_date` | DATE | 交易日期 |
| `open_price` | DECIMAL(10,2) | 開盤價 |
| `high_price` | DECIMAL(10,2) | 最高價 |
| `low_price` | DECIMAL(10,2) | 最低價 |
| `close_price` | DECIMAL(10,2) | **收盤價**（最常用）|
| `volume` | BIGINT | 成交股數 |
| `turnover` | BIGINT | 成交金額 |
| `transactions` | INT | 成交筆數 |
| `change_amount` | DECIMAL(10,2) | 漲跌金額 |
| `change_percent` | DECIMAL(8,4) | 漲跌幅（%）|

**唯一鍵**: `(stock_id, trade_date)`
**索引**: `(stock_id, trade_date DESC)` — 方便查最新資料
**資料來源**: TWSE (`npm run fetch-prices`)

---

## 3. `technical_indicators` — 技術指標

每日由 `calculateIndicators.js` 根據 `daily_prices` 計算後寫入。

| 欄位 | 類型 | 說明 | 常用判斷 |
|------|------|------|----------|
| `stock_id` | VARCHAR(10) | 股票代號 | |
| `trade_date` | DATE | 交易日期 | |
| **均線** | | | |
| `ma5` | DECIMAL(10,2) | 5 日均線 | 短期趨勢 |
| `ma10` | DECIMAL(10,2) | 10 日均線 | |
| `ma20` | DECIMAL(10,2) | 20 日均線 | 中期趨勢 |
| `ma60` | DECIMAL(10,2) | 60 日均線 | 長期趨勢（季線）|
| **RSI** | | | |
| `rsi` | DECIMAL(8,4) | 14 日 RSI | <30 超賣, >70 超買 |
| **MACD** | | | |
| `macd` | DECIMAL(10,4) | MACD 線 | |
| `macd_signal` | DECIMAL(10,4) | 訊號線 | |
| `macd_histogram` | DECIMAL(10,4) | 柱狀圖 | >0 偏多, <0 偏空 |
| **KD 隨機指標** | | | |
| `kd_k` | DECIMAL(8,4) | K 值 | |
| `kd_d` | DECIMAL(8,4) | D 值 | K>D 偏多, K<D 偏空 |
| **布林通道** | | | |
| `bollinger_upper` | DECIMAL(10,2) | 上軌 | 壓力 |
| `bollinger_middle` | DECIMAL(10,2) | 中軌（=MA20）| |
| `bollinger_lower` | DECIMAL(10,2) | 下軌 | 支撐 |
| **進階指標** | | | |
| `vwap` | DECIMAL(10,2) | 成交量加權均價 | 法人成本參考 |
| `atr` | DECIMAL(10,4) | 平均真實波幅 | 波動度衡量 |
| `adx` | DECIMAL(8,4) | 趨勢強度 | >25 趨勢明確 |
| `plus_di` | DECIMAL(8,4) | +DI | 多方力道 |
| `minus_di` | DECIMAL(8,4) | -DI | 空方力道 |
| `williams_r` | DECIMAL(8,4) | 威廉指標 | <-80 超賣, >-20 超買 |
| `obv` | BIGINT | 能量潮 | 量能趨勢 |

**唯一鍵**: `(stock_id, trade_date)`
**計算方式**: `npm run calculate-indicators`

---

## 4. `institutional_trading` — 三大法人買賣超

| 欄位 | 類型 | 說明 |
|------|------|------|
| `stock_id` | VARCHAR(10) | 股票代號 |
| `trade_date` | DATE | 交易日期 |
| `foreign_buy` | BIGINT | 外資買進（股）|
| `foreign_sell` | BIGINT | 外資賣出 |
| `foreign_net` | BIGINT | **外資淨買超**（正=買, 負=賣）|
| `trust_buy` | BIGINT | 投信買進 |
| `trust_sell` | BIGINT | 投信賣出 |
| `trust_net` | BIGINT | **投信淨買超** |
| `dealer_buy` | BIGINT | 自營商買進 |
| `dealer_sell` | BIGINT | 自營商賣出 |
| `dealer_net` | BIGINT | **自營商淨買超** |
| `total_net` | BIGINT | **三大法人合計淨買超** |

**唯一鍵**: `(stock_id, trade_date)`
**資料來源**: TWSE (`npm run fetch-institutional`)

---

## 5. `margin_trading` — 融資融券

| 欄位 | 類型 | 說明 |
|------|------|------|
| `stock_id` | VARCHAR(10) | 股票代號 |
| `trade_date` | DATE | 交易日期 |
| `margin_buy` | BIGINT | 融資買進 |
| `margin_sell` | BIGINT | 融資賣出 |
| `margin_balance` | BIGINT | **融資餘額**（散戶看多指標）|
| `margin_limit` | BIGINT | 融資限額 |
| `short_buy` | BIGINT | 融券買進（回補）|
| `short_sell` | BIGINT | 融券賣出（放空）|
| `short_balance` | BIGINT | **融券餘額**（散戶看空指標）|
| `short_limit` | BIGINT | 融券限額 |
| `offset_volume` | BIGINT | 資券互抵 |

**唯一鍵**: `(stock_id, trade_date)`
**資料來源**: TWSE (`npm run fetch-margin`)

---

## 6. `monthly_revenue` — 月營收

| 欄位 | 類型 | 說明 |
|------|------|------|
| `stock_id` | VARCHAR(10) | 股票代號 |
| `year` | INT | 西元年 |
| `month` | INT | 月份（1-12）|
| `revenue` | BIGINT | **當月營收**（千元）|
| `revenue_mom` | DECIMAL(8,2) | 月增率（%）|
| `revenue_yoy` | DECIMAL(8,2) | **年增率（%）**（最重要）|
| `cumulative_revenue` | BIGINT | 累計營收 |
| `cumulative_yoy` | DECIMAL(8,2) | 累計年增率 |

**唯一鍵**: `(stock_id, year, month)`
**資料來源**: FinMind (`npm run fetch-revenue`，需要 `FINMIND_TOKEN`)

---

## 7. `financial_statements` — 季度財報

| 分類 | 欄位 | 說明 |
|------|------|------|
| **鍵值** | `stock_id`, `year`, `quarter` | |
| **損益表** | `revenue` | 營業收入 |
| | `operating_cost` | 營業成本 |
| | `gross_profit` | 毛利 |
| | `operating_expense` | 營業費用 |
| | `operating_income` | 營業利益 |
| | `non_operating_income` | 業外收入 |
| | `pretax_income` | 稅前淨利 |
| | `net_income` | **稅後淨利** |
| | `eps` | **每股盈餘** |
| **資產負債** | `total_assets` | 總資產 |
| | `current_assets` | 流動資產 |
| | `non_current_assets` | 非流動資產 |
| | `total_liabilities` | 總負債 |
| | `current_liabilities` | 流動負債 |
| | `non_current_liabilities` | 非流動負債 |
| | `equity` | 股東權益 |
| **現金流** | `operating_cash_flow` | 營業現金流 |
| | `investing_cash_flow` | 投資現金流 |
| | `financing_cash_flow` | 籌資現金流 |
| | `free_cash_flow` | **自由現金流** |

**唯一鍵**: `(stock_id, year, quarter)`
**資料來源**: FinMind (`npm run fetch-financial`，需要 `FINMIND_TOKEN`)

---

## 8. `financial_ratios` — 財務比率

| 分類 | 欄位 | 說明 | 好的參考值 |
|------|------|------|-----------|
| **獲利能力** | `roe` | 股東權益報酬率 | > 15% |
| | `roa` | 資產報酬率 | > 8% |
| | `gross_margin` | 毛利率 | 越高越好 |
| | `operating_margin` | 營業利益率 | > 10% |
| | `net_margin` | 淨利率 | > 8% |
| **償債能力** | `current_ratio` | 流動比率 | > 1.5 |
| | `quick_ratio` | 速動比率 | > 1.0 |
| | `debt_ratio` | 負債比率 | < 50% |
| | `debt_to_equity` | 負債權益比 | < 1.0 |
| **經營效率** | `inventory_turnover` | 存貨週轉率 | 越高越好 |
| | `receivable_turnover` | 應收帳款週轉率 | 越高越好 |
| | `total_asset_turnover` | 總資產週轉率 | 越高越好 |
| **每股指標** | `book_value_per_share` | 每股淨值 | PB 計算用 |
| | `operating_cash_per_share` | 每股營業現金流 | > EPS 為佳 |

**唯一鍵**: `(stock_id, year, quarter)`
**計算時機**: 與 financial_statements 同步時自動計算

---

## 9. `dividends` — 股利

| 欄位 | 類型 | 說明 |
|------|------|------|
| `stock_id` | VARCHAR(10) | 股票代號 |
| `year` | INT | 年度 |
| `cash_dividend` | DECIMAL(10,4) | 現金股利 |
| `stock_dividend` | DECIMAL(10,4) | 股票股利 |
| `total_dividend` | DECIMAL(10,4) | 合計股利 |
| `ex_dividend_date` | DATE | 除息日 |
| `ex_right_date` | DATE | 除權日 |
| `dividend_yield` | DECIMAL(8,4) | **殖利率（%）** |
| `payout_ratio` | DECIMAL(8,4) | 配發率 |

**唯一鍵**: `(stock_id, year)`
**資料來源**: TWSE (`npm run fetch-dividends`)

---

## 10. `user_watchlists` & `price_alerts` — 使用者功能

這兩張表目前是 schema 中定義但尚未在 API 中完整實作的功能。

### `user_watchlists`
| 欄位 | 說明 |
|------|------|
| `id` | 自動遞增 PK |
| `list_name` | 清單名稱 |
| `stock_id` | 股票代號 |
| `notes` | 備註 |

### `price_alerts`
| 欄位 | 說明 |
|------|------|
| `id` | 自動遞增 PK |
| `stock_id` | 股票代號 |
| `alert_type` | 提醒類型（above/below）|
| `target_price` | 目標價格 |
| `is_triggered` | 是否已觸發 |

---

## 便利 View

### `latest_stock_data`
合併 stocks + daily_prices + technical_indicators 的最新一筆，方便一次查詢。

### `latest_financial_data`
合併 financial_statements + financial_ratios 的最新一季。

---

## 資料更新頻率建議

| 資料 | 更新頻率 | 指令 |
|------|----------|------|
| 股票清單 | 每月一次 | `npm run fetch-stocks` |
| 每日股價 | 每個交易日 | `npm run fetch-prices` |
| 技術指標 | 股價更新後 | `npm run calculate-indicators` |
| 法人買賣超 | 每個交易日 | `npm run fetch-institutional` |
| 融資融券 | 每個交易日 | `npm run fetch-margin` |
| 月營收 | 每月 10 號後 | `npm run fetch-revenue` |
| 季度財報 | 每季公告後 | `npm run fetch-financial` |
| 股利 | 每年一次 | `npm run fetch-dividends` |
