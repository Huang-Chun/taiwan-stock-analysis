-- 融資融券資料表
CREATE TABLE IF NOT EXISTS margin_trading (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    trade_date DATE NOT NULL,
    margin_buy BIGINT,              -- 融資買進 (張)
    margin_sell BIGINT,             -- 融資賣出 (張)
    margin_balance BIGINT,          -- 融資餘額 (張)
    margin_limit BIGINT,            -- 融資限額 (張)
    short_buy BIGINT,               -- 融券買進 (張)
    short_sell BIGINT,              -- 融券賣出 (張)
    short_balance BIGINT,           -- 融券餘額 (張)
    short_limit BIGINT,             -- 融券限額 (張)
    offset_volume BIGINT,           -- 資券互抵 (張)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY unique_stock_date (stock_id, trade_date),
    INDEX idx_stock_date (stock_id, trade_date DESC)
);
