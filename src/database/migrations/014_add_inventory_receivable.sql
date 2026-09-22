-- 補上速動比率/存貨周轉天數/應收帳款收現天數需要的原始欄位
-- 利息費用刻意不加：FinMind TaiwanStockFinancialStatements 資料集本身沒有拆出這條線
-- (連台積電都查不到 InterestExpense type)，利息保障倍數無法用同一套資料源計算。

ALTER TABLE financial_statements ADD COLUMN inventory DECIMAL(20, 2) AFTER equity;
ALTER TABLE financial_statements ADD COLUMN accounts_receivable DECIMAL(20, 2) AFTER inventory;
