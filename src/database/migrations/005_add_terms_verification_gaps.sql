-- 補齊框架模板裡漏掉的三塊：產業地圖名詞解釋、個股驗證清單、個股待確認事項

CREATE TABLE industry_map_terms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    industry_map_id INT NOT NULL,
    term VARCHAR(100) NOT NULL,
    definition TEXT,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (industry_map_id) REFERENCES industry_maps(id) ON DELETE CASCADE
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

ALTER TABLE company_profiles ADD COLUMN open_gaps TEXT AFTER business_notes;
