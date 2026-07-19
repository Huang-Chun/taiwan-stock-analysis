require('dotenv').config();
const { fetchAndSaveInstitutionalTrading } = require('../src/crawler/fetchInstitutionalTrading');
const { fetchAndSaveMarginTrading } = require('../src/crawler/fetchMarginTrading');
const { calculateAllIndicators } = require('../src/analysis/calculateIndicators');
const { pool } = require('../src/database/connection');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function weekdayRange(startStr, endStr) {
  const dates = [];
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}${m}${dd}`);
  }
  return dates;
}

async function main() {
  const report = {};

  report.prices = { stocks: 1924, records: 63391, note: '已於前一輪完成' };
  report.financialStatements = { skipped: true, reason: 'FinMind 免費帳號速率限制 (~280 req/hr)，逐檔抓取需 6-7 小時，本輪跳過，需另外處理' };
  report.monthlyRevenue = { skipped: true, reason: '同樣走 FinMind API，速率限制與財報共用，本輪跳過' };

  console.log('=== STEP 3: 逐日法人買賣超 + 融資融券 (2026-04-10 ~ 2026-07-10) ===');
  const days = weekdayRange('2026-04-10', '2026-07-10');
  console.log(`共 ${days.length} 個交易日待補`);
  let instTotal = 0, instFail = 0, marginTotal = 0, marginFail = 0;
  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    try {
      const n = await fetchAndSaveInstitutionalTrading(date);
      instTotal += n;
      if (n === 0) console.log(`  [${i+1}/${days.length}] ${date} 法人: 0 筆 (可能假日)`);
    } catch (e) {
      instFail++;
      console.error(`  [${i+1}/${days.length}] ${date} 法人失敗: ${e.message}`);
    }
    try {
      const n = await fetchAndSaveMarginTrading(date);
      marginTotal += n;
      if (n === 0) console.log(`  [${i+1}/${days.length}] ${date} 融資券: 0 筆 (可能假日)`);
    } catch (e) {
      marginFail++;
      console.error(`  [${i+1}/${days.length}] ${date} 融資券失敗: ${e.message}`);
    }
    if ((i + 1) % 10 === 0) console.log(`--- 進度 ${i+1}/${days.length} ---`);
    await sleep(400);
  }
  report.institutional = { totalRecords: instTotal, failedDays: instFail };
  report.margin = { totalRecords: marginTotal, failedDays: marginFail };
  console.log('法人+融資融券回補完成:', JSON.stringify({ instTotal, instFail, marginTotal, marginFail }));

  console.log('=== STEP 4: 重新計算技術指標 ===');
  try {
    const ind = await calculateAllIndicators();
    report.indicators = ind;
    console.log('技術指標計算完成:', JSON.stringify(ind));
  } catch (e) {
    console.error('技術指標計算失敗:', e.message);
    report.indicators = { error: e.message };
  }

  console.log('=== FINAL REPORT ===');
  console.log(JSON.stringify(report, null, 2));

  await pool.end();
}

main()
  .then(() => { console.log('全部完成！'); process.exit(0); })
  .catch(e => { console.error('腳本執行失敗:', e); process.exit(1); });
