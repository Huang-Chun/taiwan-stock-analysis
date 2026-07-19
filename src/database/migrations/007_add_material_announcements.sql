-- 官方重大訊息：注意股清單 + 因股價異常波動被要求公佈自結損益
-- 資料源：TWSE OpenAPI /announcement/notice（當日注意股）+ /opendata/t187ap04_L（每日重大訊息，篩選符合條款第51款且含「自結」字樣）

CREATE TABLE material_announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    announced_date DATE NOT NULL,
    category ENUM('attention','self_disclosure') NOT NULL,
    subject TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(stock_id),
    UNIQUE KEY uq_announcement (stock_id, announced_date, category, subject(191)),
    INDEX idx_stock (stock_id, announced_date DESC)
);
