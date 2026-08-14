-- 個股頁面「稼動率觀察」卡片旁的指標判讀方法筆記（怎麼讀 DOL、之後陸續加入的其他判斷指標）
-- 先全部記在單一 company_profiles 欄位、集中在強茂頁面試寫，等累積第二、第三個指標後再考慮拆成結構化表格

ALTER TABLE company_profiles
  ADD COLUMN metric_notes TEXT AFTER business_notes;
