-- 移除技術面/籌碼面/回測相關資料表（框架不使用，改用 industry_maps / company_profiles 系列）
-- 注意：此遷移不可逆。執行前請確認已有備份（例如 taiwan_stock_backup.sql）。

DROP VIEW IF EXISTS latest_stock_data;

DROP TABLE IF EXISTS technical_indicators;
DROP TABLE IF EXISTS institutional_trading;
DROP TABLE IF EXISTS margin_trading;
DROP TABLE IF EXISTS dividends;
DROP TABLE IF EXISTS price_alerts;
DROP TABLE IF EXISTS user_watchlists;
