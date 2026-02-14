-- 擴充技術指標欄位
ALTER TABLE technical_indicators
  ADD COLUMN vwap DECIMAL(10, 2) AFTER bollinger_lower,
  ADD COLUMN atr DECIMAL(10, 4) AFTER vwap,
  ADD COLUMN adx DECIMAL(5, 2) AFTER atr,
  ADD COLUMN plus_di DECIMAL(5, 2) AFTER adx,
  ADD COLUMN minus_di DECIMAL(5, 2) AFTER plus_di,
  ADD COLUMN williams_r DECIMAL(5, 2) AFTER minus_di,
  ADD COLUMN obv BIGINT AFTER williams_r;
