require('dotenv').config();
const { fetchAndSaveFinancialStatements } = require('../src/crawler/fetchFinancialStatements');
const { fetchRecentMonthlyRevenue } = require('../src/crawler/fetchMonthlyRevenue');
const { pool } = require('../src/database/connection');

async function main() {
  const report = {};

  console.log('=== STEP A: 財報 2026 Q1 (單季，全市場逐檔) ===');
  try {
    const n = await fetchAndSaveFinancialStatements(2026, 1);
    report.financialStatements = { year: 2026, quarter: 1, records: n };
    console.log('財報同步完成:', JSON.stringify(report.financialStatements));
  } catch (e) {
    console.error('財報同步失敗:', e.message);
    report.financialStatements = { error: e.message };
  }

  console.log('=== STEP B: 月營收缺口回補 (全市場自動偵測) ===');
  try {
    const n = await fetchRecentMonthlyRevenue();
    report.monthlyRevenue = { records: n };
    console.log('月營收同步完成:', JSON.stringify(report.monthlyRevenue));
  } catch (e) {
    console.error('月營收同步失敗:', e.message);
    report.monthlyRevenue = { error: e.message };
  }

  console.log('=== FINAL REPORT ===');
  console.log(JSON.stringify(report, null, 2));

  await pool.end();
}

main()
  .then(() => { console.log('全部完成！'); process.exit(0); })
  .catch(e => { console.error('腳本執行失敗:', e); process.exit(1); });
