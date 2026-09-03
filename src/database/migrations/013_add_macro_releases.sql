-- 總經指標的實際數值 + 公布行事曆
-- macro_indicators 加 FRED 對應欄位（僅部分美股指標有免費 FRED 資料，其餘留 NULL 走手動輸入）
-- fred_release_id 是第一次同步時查到後的快取，避免每次都重查 series/release

ALTER TABLE macro_indicators
  ADD COLUMN fred_series_id VARCHAR(20) NULL,
  ADD COLUMN fred_release_id INT NULL;

CREATE TABLE macro_indicator_releases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    indicator_id INT NOT NULL,
    period VARCHAR(20) NOT NULL,             -- monthly: 'YYYY-MM'；quarterly: 'YYYY-Qn'
    expected_date DATE NULL,                 -- 下一次/本期預期公布日
    actual_release_date DATE NULL,           -- 已公布則填實際公布日
    value DECIMAL(20,4) NULL,
    unit VARCHAR(20) NULL,
    source ENUM('fred','manual') NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (indicator_id) REFERENCES macro_indicators(id) ON DELETE CASCADE,
    UNIQUE KEY unique_indicator_period (indicator_id, period),
    INDEX idx_expected_date (expected_date)
);
