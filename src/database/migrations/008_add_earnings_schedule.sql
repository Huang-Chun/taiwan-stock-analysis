-- 個股實際公告的財報董事會日期（比法定截止日更準）
-- 資料源：TWSE OpenAPI /opendata/t187ap04_L，符合條款第31款且內容含「董事會」+「財務報告/自結財務」，
-- 區分「預告董事會召開日期」(earnings_schedule) 與「董事會已決議通過」(earnings_announced) 兩種。

ALTER TABLE material_announcements
  MODIFY COLUMN category ENUM('attention','self_disclosure','earnings_schedule','earnings_announced') NOT NULL,
  ADD COLUMN event_date DATE NULL AFTER announced_date,
  ADD COLUMN target_period VARCHAR(20) NULL AFTER event_date;
