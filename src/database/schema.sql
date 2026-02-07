-- 台股分析系統資料庫架構設計
-- Taiwan Stock Analysis System Database Schema

-- ============================================
-- 1. 股票基本資料 (Stock Basic Information)
-- ============================================
CREATE TABLE stocks (
    stock_id VARCHAR(10) PRIMARY KEY,           -- 股票代號 (e.g., '2330')
    stock_name VARCHAR(100) NOT NULL,           -- 股票名稱 (e.g., '台積電')
    industry VARCHAR(50),                       -- 產業類別
    market_type VARCHAR(20),                    -- 市場別 (上市/上櫃/興櫃)
    listing_date DATE,                          -- 上市日期
    capital DECIMAL(20, 2),                     -- 實收資本額 (百萬)
    is_active BOOLEAN DEFAULT TRUE,             -- 是否仍在交易
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- 2. 日K線資料 (Daily Price Data)
-- ============================================
CREATE TABLE daily_prices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    trade_date DATE NOT NULL,                   -- 交易日期
    open_price DECIMAL(10, 2),                  -- 開盤價
    high_price DECIMAL(10, 2),                  -- 最高價
    low_price DECIMAL(10, 2),                   -- 最低價
    close_price DECIMAL(10, 2),                 -- 收盤價
    volume BIGINT,                              -- 成交量 (股)
    turnover DECIMAL(20, 2),                    -- 成交金額 (元)
    transactions INT,                           -- 成交筆數
    change_amount DECIMAL(10, 2),               -- 漲跌價差
    change_percent DECIMAL(5, 2),               -- 漲跌幅 (%)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_date (stock_id, trade_date),
    INDEX idx_stock_date (stock_id, trade_date DESC)
);

-- ============================================
-- 3. 技術指標資料 (Technical Indicators)
-- ============================================
CREATE TABLE technical_indicators (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    trade_date DATE NOT NULL,                   -- 交易日期
    ma5 DECIMAL(10, 2),                         -- 5日均線
    ma10 DECIMAL(10, 2),                        -- 10日均線
    ma20 DECIMAL(10, 2),                        -- 20日均線
    ma60 DECIMAL(10, 2),                        -- 60日均線
    rsi DECIMAL(5, 2),                          -- RSI指標
    macd DECIMAL(10, 4),                        -- MACD
    macd_signal DECIMAL(10, 4),                 -- MACD信號線
    macd_histogram DECIMAL(10, 4),              -- MACD柱狀圖
    kd_k DECIMAL(5, 2),                         -- KD指標-K值
    kd_d DECIMAL(5, 2),                         -- KD指標-D值
    bollinger_upper DECIMAL(10, 2),             -- 布林通道上軌
    bollinger_middle DECIMAL(10, 2),            -- 布林通道中軌
    bollinger_lower DECIMAL(10, 2),             -- 布林通道下軌
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_date (stock_id, trade_date),
    INDEX idx_stock_date (stock_id, trade_date DESC)
);

-- ============================================
-- 4. 財報資料 (Financial Statements)
-- ============================================
CREATE TABLE financial_statements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    year INT NOT NULL,                          -- 年度
    quarter INT NOT NULL,                       -- 季度 (1-4)
    report_type VARCHAR(20),                    -- 報表類型 (合併/個別)
    
    -- 損益表 (Income Statement)
    revenue DECIMAL(20, 2),                     -- 營業收入
    operating_cost DECIMAL(20, 2),              -- 營業成本
    gross_profit DECIMAL(20, 2),                -- 營業毛利
    operating_expense DECIMAL(20, 2),           -- 營業費用
    operating_income DECIMAL(20, 2),            -- 營業利益
    non_operating_income DECIMAL(20, 2),        -- 營業外收支
    pretax_income DECIMAL(20, 2),               -- 稅前淨利
    net_income DECIMAL(20, 2),                  -- 稅後淨利
    eps DECIMAL(10, 4),                         -- 每股盈餘 (EPS)
    
    -- 資產負債表 (Balance Sheet)
    total_assets DECIMAL(20, 2),                -- 總資產
    current_assets DECIMAL(20, 2),              -- 流動資產
    non_current_assets DECIMAL(20, 2),          -- 非流動資產
    total_liabilities DECIMAL(20, 2),           -- 總負債
    current_liabilities DECIMAL(20, 2),         -- 流動負債
    non_current_liabilities DECIMAL(20, 2),     -- 非流動負債
    equity DECIMAL(20, 2),                      -- 股東權益
    
    -- 現金流量表 (Cash Flow Statement)
    operating_cash_flow DECIMAL(20, 2),         -- 營業活動現金流
    investing_cash_flow DECIMAL(20, 2),         -- 投資活動現金流
    financing_cash_flow DECIMAL(20, 2),         -- 融資活動現金流
    free_cash_flow DECIMAL(20, 2),              -- 自由現金流
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_period (stock_id, year, quarter),
    INDEX idx_stock_period (stock_id, year DESC, quarter DESC)
);

-- ============================================
-- 5. 財務比率 (Financial Ratios)
-- ============================================
CREATE TABLE financial_ratios (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    year INT NOT NULL,                          -- 年度
    quarter INT NOT NULL,                       -- 季度
    
    -- 獲利能力指標
    roe DECIMAL(5, 2),                          -- 股東權益報酬率 (ROE %)
    roa DECIMAL(5, 2),                          -- 資產報酬率 (ROA %)
    gross_margin DECIMAL(5, 2),                 -- 毛利率 (%)
    operating_margin DECIMAL(5, 2),             -- 營業利益率 (%)
    net_margin DECIMAL(5, 2),                   -- 淨利率 (%)
    
    -- 償債能力指標
    current_ratio DECIMAL(10, 2),               -- 流動比率 (%)
    quick_ratio DECIMAL(10, 2),                 -- 速動比率 (%)
    debt_ratio DECIMAL(5, 2),                   -- 負債比率 (%)
    debt_to_equity DECIMAL(10, 2),              -- 負債權益比
    
    -- 經營效率指標
    inventory_turnover DECIMAL(10, 2),          -- 存貨週轉率 (次)
    receivable_turnover DECIMAL(10, 2),         -- 應收帳款週轉率 (次)
    total_asset_turnover DECIMAL(10, 2),        -- 總資產週轉率 (次)
    
    -- 每股指標
    book_value_per_share DECIMAL(10, 2),        -- 每股淨值
    operating_cash_per_share DECIMAL(10, 2),    -- 每股營業現金流
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_period (stock_id, year, quarter),
    INDEX idx_stock_period (stock_id, year DESC, quarter DESC)
);

-- ============================================
-- 6. 月營收資料 (Monthly Revenue)
-- ============================================
CREATE TABLE monthly_revenue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    year INT NOT NULL,                          -- 年度
    month INT NOT NULL,                         -- 月份
    revenue DECIMAL(20, 2),                     -- 當月營收
    revenue_mom DECIMAL(5, 2),                  -- 月增率 (%)
    revenue_yoy DECIMAL(5, 2),                  -- 年增率 (%)
    cumulative_revenue DECIMAL(20, 2),          -- 累計營收
    cumulative_yoy DECIMAL(5, 2),               -- 累計年增率 (%)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_month (stock_id, year, month),
    INDEX idx_stock_period (stock_id, year DESC, month DESC)
);

-- ============================================
-- 7. 股利資料 (Dividend Information)
-- ============================================
CREATE TABLE dividends (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    year INT NOT NULL,                          -- 配息年度
    cash_dividend DECIMAL(10, 4),               -- 現金股利
    stock_dividend DECIMAL(10, 4),              -- 股票股利
    total_dividend DECIMAL(10, 4),              -- 合計股利
    ex_dividend_date DATE,                      -- 除息日
    ex_right_date DATE,                         -- 除權日
    dividend_yield DECIMAL(5, 2),               -- 殖利率 (%)
    payout_ratio DECIMAL(5, 2),                 -- 配息率 (%)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_year (stock_id, year),
    INDEX idx_stock_year (stock_id, year DESC)
);

-- ============================================
-- 8. 三大法人買賣超 (Institutional Investors)
-- ============================================
CREATE TABLE institutional_trading (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    trade_date DATE NOT NULL,                   -- 交易日期
    foreign_buy BIGINT,                         -- 外資買進 (股)
    foreign_sell BIGINT,                        -- 外資賣出 (股)
    foreign_net BIGINT,                         -- 外資買賣超 (股)
    trust_buy BIGINT,                           -- 投信買進 (股)
    trust_sell BIGINT,                          -- 投信賣出 (股)
    trust_net BIGINT,                           -- 投信買賣超 (股)
    dealer_buy BIGINT,                          -- 自營商買進 (股)
    dealer_sell BIGINT,                         -- 自營商賣出 (股)
    dealer_net BIGINT,                          -- 自營商買賣超 (股)
    total_net BIGINT,                           -- 三大法人合計 (股)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_date (stock_id, trade_date),
    INDEX idx_stock_date (stock_id, trade_date DESC)
);

-- ============================================
-- 9. 使用者自選股 (User Watchlist) - 可選
-- ============================================
CREATE TABLE user_watchlists (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,                    -- 使用者ID
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    watchlist_name VARCHAR(50),                 -- 自選股分類名稱
    notes TEXT,                                 -- 備註
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_user_stock (user_id, stock_id, watchlist_name),
    INDEX idx_user (user_id)
);

-- ============================================
-- 10. 價格提醒 (Price Alerts) - 可選
-- ============================================
CREATE TABLE price_alerts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,                    -- 使用者ID
    stock_id VARCHAR(10) NOT NULL,              -- 股票代號
    alert_type VARCHAR(20),                     -- 提醒類型 (above/below)
    target_price DECIMAL(10, 2),                -- 目標價格
    is_active BOOLEAN DEFAULT TRUE,             -- 是否啟用
    is_triggered BOOLEAN DEFAULT FALSE,         -- 是否已觸發
    triggered_at TIMESTAMP NULL,                -- 觸發時間
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    INDEX idx_user_active (user_id, is_active)
);

-- ============================================
-- 建立常用查詢的視圖 (Useful Views)
-- ============================================

-- 最新股價與技術指標整合視圖
CREATE VIEW latest_stock_data AS
SELECT 
    s.stock_id,
    s.stock_name,
    s.industry,
    dp.trade_date,
    dp.close_price,
    dp.change_percent,
    dp.volume,
    ti.ma5,
    ti.ma20,
    ti.ma60,
    ti.rsi,
    ti.macd
FROM stocks s
LEFT JOIN daily_prices dp ON s.stock_id = dp.stock_id
LEFT JOIN technical_indicators ti ON s.stock_id = ti.stock_id 
    AND dp.trade_date = ti.trade_date
WHERE dp.trade_date = (
    SELECT MAX(trade_date) 
    FROM daily_prices 
    WHERE stock_id = s.stock_id
);

-- 最新財報與財務比率整合視圖
CREATE VIEW latest_financial_data AS
SELECT 
    s.stock_id,
    s.stock_name,
    fs.year,
    fs.quarter,
    fs.revenue,
    fs.operating_income,
    fs.net_income,
    fs.eps,
    fs.total_assets,
    fs.equity,
    fr.roe,
    fr.roa,
    fr.net_margin,
    fr.debt_ratio
FROM stocks s
LEFT JOIN financial_statements fs ON s.stock_id = fs.stock_id
LEFT JOIN financial_ratios fr ON s.stock_id = fr.stock_id 
    AND fs.year = fr.year 
    AND fs.quarter = fr.quarter
WHERE (fs.year, fs.quarter) = (
    SELECT year, quarter 
    FROM financial_statements 
    WHERE stock_id = s.stock_id 
    ORDER BY year DESC, quarter DESC 
    LIMIT 1
);
