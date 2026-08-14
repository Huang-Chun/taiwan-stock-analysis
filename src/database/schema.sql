-- 台股供應鏈基本面研究系統資料庫架構
-- Taiwan Stock Supply-Chain Fundamentals Research System — Database Schema
--
-- 這是唯一權威來源；新環境用 `npm run init-db` 執行本檔即可重建完整結構。
-- 歷史遷移檔（src/database/migrations/001~004）記錄的是「怎麼從舊版演化過來」，
-- 不需要再對新環境逐一執行。

-- ============================================
-- 1. 股票基本資料 (Stock Basic Information)
-- ============================================
CREATE TABLE stocks (
    stock_id VARCHAR(10) PRIMARY KEY,           -- 股票代號 (e.g., '2330')
    stock_name VARCHAR(100) NOT NULL,           -- 股票名稱 (e.g., '台積電')
    industry VARCHAR(50),                       -- 產業類別（交易所分類，非框架六層）
    market_type VARCHAR(20),                    -- 市場別 (上市/上櫃/興櫃)
    listing_date DATE,                          -- 上市日期
    capital DECIMAL(20, 2),                     -- 實收資本額 (百萬)
    is_active BOOLEAN DEFAULT TRUE,             -- 是否仍在交易
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- 2. 日K線資料 (Daily Price Data) — 僅作參考價，不進框架分析邏輯
-- ============================================
CREATE TABLE daily_prices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    trade_date DATE NOT NULL,
    open_price DECIMAL(10, 2),
    high_price DECIMAL(10, 2),
    low_price DECIMAL(10, 2),
    close_price DECIMAL(10, 2),
    volume BIGINT,
    turnover DECIMAL(20, 2),
    transactions INT,
    change_amount DECIMAL(10, 2),
    change_percent DECIMAL(5, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_date (stock_id, trade_date),
    INDEX idx_stock_date (stock_id, trade_date DESC)
);

-- ============================================
-- 3. 財報資料 (Financial Statements)
-- ============================================
CREATE TABLE financial_statements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    year INT NOT NULL,
    quarter INT NOT NULL,
    report_type VARCHAR(20),

    -- 損益表 (Income Statement)
    revenue DECIMAL(20, 2),
    operating_cost DECIMAL(20, 2),
    gross_profit DECIMAL(20, 2),
    operating_expense DECIMAL(20, 2),
    operating_income DECIMAL(20, 2),
    non_operating_income DECIMAL(20, 2),
    pretax_income DECIMAL(20, 2),
    net_income DECIMAL(20, 2),
    eps DECIMAL(10, 4),

    -- 資產負債表 (Balance Sheet)
    total_assets DECIMAL(20, 2),
    current_assets DECIMAL(20, 2),
    non_current_assets DECIMAL(20, 2),
    total_liabilities DECIMAL(20, 2),
    current_liabilities DECIMAL(20, 2),
    non_current_liabilities DECIMAL(20, 2),
    equity DECIMAL(20, 2),

    -- 現金流量表 (Cash Flow Statement)
    operating_cash_flow DECIMAL(20, 2),
    investing_cash_flow DECIMAL(20, 2),
    financing_cash_flow DECIMAL(20, 2),
    free_cash_flow DECIMAL(20, 2),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_period (stock_id, year, quarter),
    INDEX idx_stock_period (stock_id, year DESC, quarter DESC)
);

-- ============================================
-- 4. 財務比率 (Financial Ratios)
-- ============================================
CREATE TABLE financial_ratios (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    year INT NOT NULL,
    quarter INT NOT NULL,

    roe DECIMAL(5, 2),
    roa DECIMAL(5, 2),
    gross_margin DECIMAL(5, 2),
    operating_margin DECIMAL(5, 2),
    net_margin DECIMAL(5, 2),

    current_ratio DECIMAL(10, 2),
    quick_ratio DECIMAL(10, 2),
    debt_ratio DECIMAL(5, 2),
    debt_to_equity DECIMAL(10, 2),

    inventory_turnover DECIMAL(10, 2),
    receivable_turnover DECIMAL(10, 2),
    total_asset_turnover DECIMAL(10, 2),

    book_value_per_share DECIMAL(10, 2),
    operating_cash_per_share DECIMAL(10, 2),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_period (stock_id, year, quarter),
    INDEX idx_stock_period (stock_id, year DESC, quarter DESC)
);

-- ============================================
-- 5. 月營收資料 (Monthly Revenue) — 框架的主要覆盤觸發點
-- ============================================
CREATE TABLE monthly_revenue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    revenue DECIMAL(20, 2),
    revenue_mom DECIMAL(5, 2),
    revenue_yoy DECIMAL(5, 2),
    cumulative_revenue DECIMAL(20, 2),
    cumulative_yoy DECIMAL(5, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_month (stock_id, year, month),
    INDEX idx_stock_period (stock_id, year DESC, month DESC)
);

-- ============================================
-- 6. 產業分類（通用自訂分組工具，與供應鏈框架分開維護）
-- ============================================
CREATE TABLE sector_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sector_subgroups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES sector_groups(id) ON DELETE CASCADE
);

CREATE TABLE sector_stock_sections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    subgroup_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (subgroup_id) REFERENCES sector_subgroups(id) ON DELETE CASCADE
);

CREATE TABLE sector_stocks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    subgroup_id INT NOT NULL,
    stock_id VARCHAR(10) NOT NULL,
    sort_order INT DEFAULT 0,
    section_id INT NULL,
    FOREIGN KEY (subgroup_id) REFERENCES sector_subgroups(id) ON DELETE CASCADE,
    FOREIGN KEY (section_id) REFERENCES sector_stock_sections(id) ON DELETE SET NULL,
    UNIQUE KEY uq_sub_stock (subgroup_id, stock_id)
);

-- ============================================
-- 7. 供應鏈研究框架 — 產業地圖
-- 六層供應鏈骨架 / 護城河分類 / 三條因果線 / 主題中性矩陣 / 可證偽假設
-- ============================================
CREATE TABLE industry_maps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    tech_background_notes TEXT,
    taiwan_participation_notes TEXT,
    customer_relationship_notes TEXT,
    open_gaps TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE industry_map_layers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    layer ENUM('設備','原材料','關鍵材料','零組件製造','模組整合','終端產品') NOT NULL,
    players TEXT,
    scarcity_source TEXT,
    moat_level VARCHAR(50),
    key_structure TEXT,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE,
    UNIQUE KEY unique_map_layer (industry_map_id, layer)
);

CREATE TABLE industry_map_causal_lines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    line_type ENUM('supply','demand','inventory') NOT NULL,
    assessment TEXT,
    evidence TEXT,
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE,
    UNIQUE KEY unique_map_line (industry_map_id, line_type)
);

CREATE TABLE industry_map_matrix_cells (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    stock_id VARCHAR(10) NULL,
    product_line VARCHAR(100),
    application VARCHAR(100),
    note TEXT,
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id)
);

CREATE TABLE industry_map_hypotheses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    hypothesis TEXT NOT NULL,
    falsifying_observation TEXT,
    current_status TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE
);

-- 名詞解釋（避免後面表格出現名詞混用）
CREATE TABLE industry_map_terms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    term VARCHAR(100) NOT NULL,
    definition TEXT,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE
);

-- ============================================
-- 8. 供應鏈研究框架 — 個股層級
-- company_profiles.is_coverage_active 同時決定 FinMind 財報/月營收爬蟲的抓取範圍
-- ============================================
CREATE TABLE company_profiles (
    stock_id VARCHAR(10) PRIMARY KEY,
    industry_map_id INT NULL,
    layer ENUM('設備','原材料','關鍵材料','零組件製造','模組整合','終端產品'),
    moat_source ENUM('地理稀缺性','製程精度+BOM鎖定','製程know-how稀缺性'),
    moat_level VARCHAR(50),
    key_structure_status TEXT,
    relationship_type ENUM('規格驗證型','架構共同開發型'),
    supplier_multiplicity ENUM('多供應商','單一綁定'),
    integration_risk_notes TEXT,
    v1_judgment VARCHAR(100),
    v1_reasoning TEXT,
    business_notes TEXT,
    metric_notes TEXT,
    open_gaps TEXT,
    is_coverage_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE SET NULL,
    INDEX idx_coverage_active (is_coverage_active)
);

CREATE TABLE company_causal_lines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    line_type ENUM('supply','demand','inventory') NOT NULL,
    assessment TEXT,
    evidence TEXT,
    FOREIGN KEY (stock_id) REFERENCES company_profiles(stock_id) ON DELETE CASCADE,
    UNIQUE KEY unique_stock_line (stock_id, line_type)
);

CREATE TABLE company_hypotheses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    hypothesis TEXT NOT NULL,
    falsifying_observation TEXT,
    current_status TEXT,
    category VARCHAR(50),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES company_profiles(stock_id) ON DELETE CASCADE
);

CREATE TABLE company_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    event_date DATE NOT NULL,
    event_desc TEXT NOT NULL,
    affected_hypothesis TEXT,
    impact_on_judgment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES company_profiles(stock_id) ON DELETE CASCADE,
    INDEX idx_stock_date (stock_id, event_date DESC)
);

-- 財務數字用來驗證商業論點是否成立，跟「可證偽假設」是不同的東西：
-- 假設是「這個論點可能被什麼推翻」，驗證清單是「用什麼具體財務數字/事件追蹤假設有沒有成立」
CREATE TABLE company_verification_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    item TEXT NOT NULL,
    is_checked BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (stock_id) REFERENCES company_profiles(stock_id) ON DELETE CASCADE
);

-- ============================================
-- 9. 每日自動同步紀錄與變化偵測
-- 只記錄數字變化，不自動改動敘事欄位，覆盤仍由人工判斷
-- ============================================
CREATE TABLE sync_runs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    status ENUM('running','done','failed') DEFAULT 'running',
    error_message TEXT NULL
);

CREATE TABLE data_change_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    run_id INT NOT NULL,
    stock_id VARCHAR(10) NOT NULL,
    metric VARCHAR(30) NOT NULL,
    period VARCHAR(20) NOT NULL,
    old_value DECIMAL(20,4) NULL,
    new_value DECIMAL(20,4) NULL,
    is_new BOOLEAN DEFAULT FALSE,
    is_significant BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (run_id) REFERENCES sync_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    INDEX idx_run (run_id),
    INDEX idx_stock (stock_id)
);

-- 官方重大訊息：注意股清單 / 因股價異常波動被要求公佈自結損益 / 財報董事會實際排定日期 / 法說會排程
-- 資料源：TWSE OpenAPI /announcement/notice（當日注意股）+ /opendata/t187ap04_L（每日重大訊息）
-- category='self_disclosure'：符合條款第51款且含「自結」字樣
-- category='earnings_schedule'：符合條款第31款，內容含「董事會預計召開日期」，event_date/target_period 為解析出的實際日期與季度
-- category='earnings_announced'：符合條款第31款，董事會已決議通過財報（早於正式財報，內容常含實際數字）
-- category='earnings_call'：符合條款第12款，內容含「召開法人說明會之日期」（法規要求開會前一日須公告，是之後「抓法說會內容分析」功能的地基）
CREATE TABLE material_announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    announced_date DATE NOT NULL,
    event_date DATE NULL,
    target_period VARCHAR(20) NULL,
    category ENUM('attention','self_disclosure','earnings_schedule','earnings_announced','earnings_call') NOT NULL,
    subject TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY uq_announcement (stock_id, announced_date, category, subject(191)),
    INDEX idx_stock (stock_id, announced_date DESC)
);

-- ============================================
-- 常用查詢視圖
-- ============================================
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
