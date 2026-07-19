require('dotenv').config();
const { fetchAndSaveFinancialStatements } = require('../src/crawler/fetchFinancialStatements');
const { pool } = require('../src/database/connection');

async function main() {
  console.log('=== 財報 2026 Q1 重跑 (已修正 operating_margin 溢位問題) ===');
  try {
    const n = await fetchAndSaveFinancialStatements(2026, 1);
    console.log('財報同步完成:', JSON.stringify({ year: 2026, quarter: 1, records: n }));
  } catch (e) {
    console.error('財報同步失敗:', e.message);
  }
  await pool.end();
}

main()
  .then(() => { console.log('全部完成！'); process.exit(0); })
  .catch(e => { console.error('腳本執行失敗:', e); process.exit(1); });
