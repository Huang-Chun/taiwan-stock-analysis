-- 法人說明會（法說會）排程公告
-- 資料源：TWSE OpenAPI /opendata/t187ap04_L，符合條款第四條第12款，內容含「召開法人說明會之日期」
-- 法規要求：上市公司辦理法人說明會，應在召開日前一日發布重大訊息公告，所以跟財報排程走同一個資料源。
-- 這是之後「抓法說會內容做分析」功能的地基：先把日期抓準，內容分析是後續獨立的功能。

ALTER TABLE material_announcements
  MODIFY COLUMN category ENUM('attention','self_disclosure','earnings_schedule','earnings_announced','earnings_call') NOT NULL;
