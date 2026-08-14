-- 可證偽假設加分類欄位，讓個股頁面可以把假設顯示在對應的量化指標卡片底下（例如「稼動率觀察」），
-- 而不是全部堆在頁面最下面的通用清單裡。自由文字欄位，不用 ENUM——之後新增指標家族(本益比估值等)
-- 不需要再開一次 migration 加新分類值。NULL = 沒有對應特定指標，維持顯示在通用「研究判斷」區塊。

ALTER TABLE company_hypotheses
  ADD COLUMN category VARCHAR(50) AFTER current_status;
