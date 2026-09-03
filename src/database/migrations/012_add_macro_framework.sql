-- 總經分析框架：四大總經維度、三層優先級、公布行事曆、傳導機制、判讀原則
-- 資料來源：使用者提供的「總經分析框架.md」（功率半導體/台股研究用）
-- priority_tier / dimension 只在原文明確分類時才填值，未分類的留 NULL，不用樂觀假設填補

CREATE TABLE macro_indicators (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    country ENUM('美國','台灣') NOT NULL,
    dimension ENUM('經濟成長動能','勞動市場緊俏度','通膨與物價壓力','資金成本與貨幣政策') NULL,
    priority_tier ENUM('核心必追','重要','參考即可') NULL,
    frequency VARCHAR(50),
    release_timing VARCHAR(100),
    publisher VARCHAR(100),
    interpretation_notes TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_indicator_name (name)
);

CREATE TABLE macro_transmission_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    indicator_id INT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (indicator_id) REFERENCES macro_indicators(id) ON DELETE SET NULL
);

CREATE TABLE macro_analysis_principles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    principle TEXT NOT NULL,
    source_case VARCHAR(200),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE macro_framework_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    section_key VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(100) NOT NULL,
    content TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
