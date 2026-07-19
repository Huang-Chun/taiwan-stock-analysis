-- 供應鏈基本面研究框架 — 新增資料表
-- 六層供應鏈骨架 / 護城河分類 / 三條因果線 / 客戶關係類型學

-- ============================================
-- 產業地圖主表
-- ============================================
CREATE TABLE industry_maps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,               -- 產業垂直名稱，例如「功率元件」
    tech_background_notes TEXT,                      -- 前置技術背景（如需要）
    taiwan_participation_notes TEXT,                  -- 台灣參與度總覽
    customer_relationship_notes TEXT,                 -- 客戶關係類型學檢視
    open_gaps TEXT,                                   -- 待確認事項
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 六層供應鏈地圖表格列
CREATE TABLE industry_map_layers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    layer ENUM('設備','原材料','關鍵材料','零組件製造','模組整合','終端產品') NOT NULL,
    players TEXT,                                     -- 主要玩家（台廠標*）
    scarcity_source TEXT,                              -- 稀缺性來源
    moat_level VARCHAR(50),                             -- 護城河等級
    key_structure TEXT,                                 -- 關鍵結構
    sort_order INT DEFAULT 0,
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE,
    UNIQUE KEY unique_map_layer (industry_map_id, layer)
);

-- 三條因果線分析（產業層級）
CREATE TABLE industry_map_causal_lines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    line_type ENUM('supply','demand','inventory') NOT NULL,
    assessment TEXT,                                    -- 現況判斷
    evidence TEXT,                                       -- 支持證據 / 待確認缺口
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE,
    UNIQUE KEY unique_map_line (industry_map_id, line_type)
);

-- 主題中性矩陣（公司 × 產品 × 應用）
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

-- 可證偽假設（產業層級）
CREATE TABLE industry_map_hypotheses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    hypothesis TEXT NOT NULL,
    falsifying_observation TEXT,                        -- 會被推翻的觀察
    current_status TEXT,                                 -- 目前狀態
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE
);

-- ============================================
-- 個股層級框架分類（同時是 FinMind 抓取範圍的依據）
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
    integration_risk_notes TEXT,                         -- 3-5年整合/替代風險
    v1_judgment VARCHAR(100),                             -- 例如「Fully priced, watchlist not buy」
    v1_reasoning TEXT,
    business_notes TEXT,                                  -- 商業模式/競爭力補充
    is_coverage_active BOOLEAN DEFAULT TRUE,              -- FinMind 財報/月營收只抓這裡=TRUE的股票
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE SET NULL,
    INDEX idx_coverage_active (is_coverage_active)
);

-- 三條因果線在個股的具體展現
CREATE TABLE company_causal_lines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    line_type ENUM('supply','demand','inventory') NOT NULL,
    assessment TEXT,
    evidence TEXT,
    FOREIGN KEY (stock_id) REFERENCES company_profiles(stock_id) ON DELETE CASCADE,
    UNIQUE KEY unique_stock_line (stock_id, line_type)
);

-- 可證偽假設（個股層級）
CREATE TABLE company_hypotheses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    hypothesis TEXT NOT NULL,
    falsifying_observation TEXT,
    current_status TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES company_profiles(stock_id) ON DELETE CASCADE
);

-- 事件日誌（財報公布 / 法說會 / guidance / 關鍵結構改變）
CREATE TABLE company_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    event_date DATE NOT NULL,
    event_desc TEXT NOT NULL,
    affected_hypothesis TEXT,                             -- 影響哪條因果線 / 哪個假設
    impact_on_judgment TEXT,                               -- 對 v1 判斷的影響
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES company_profiles(stock_id) ON DELETE CASCADE,
    INDEX idx_stock_date (stock_id, event_date DESC)
);
