-- 每日自動同步的執行紀錄與變化偵測
-- 目的：把「數據自動更新」跟「敘事人工覆盤」分開——這裡只記錄數字變化，
-- 不自動改動 company_profiles/hypotheses 等敘事欄位，符合框架「覆盤觸發點是事件，不是股價」的原則。

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
    metric VARCHAR(30) NOT NULL,        -- monthly_revenue | revenue_yoy | gross_margin | operating_margin | roe
    period VARCHAR(20) NOT NULL,        -- '2026-06' 或 '2026Q1'
    old_value DECIMAL(20,4) NULL,
    new_value DECIMAL(20,4) NULL,
    is_new BOOLEAN DEFAULT FALSE,       -- 該期間第一次出現（old_value 必為 NULL）
    is_significant BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (run_id) REFERENCES sync_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    INDEX idx_run (run_id),
    INDEX idx_stock (stock_id)
);
