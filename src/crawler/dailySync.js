/**
 * 每日自動同步：只更新「數據」，不動「敘事」。
 * 覆盤觸發點是事件，不是股價——所以這裡只負責偵測數字變化並寫進 data_change_log
 * （必要時自動建立一筆事件日誌草稿），護城河/因果線/假設/v1判斷等欄位一律留給人工覆盤更新。
 */
const { pool } = require('../database/connection');
const { fetchAllStocksLatestPrices } = require('./fetchDailyPrices');
const { fetchRecentMonthlyRevenue } = require('./fetchMonthlyRevenue');
const { fetchAndSaveFinancialStatements, getLatestAvailableQuarters } = require('./fetchFinancialStatements');
const { syncMaterialAnnouncements } = require('./fetchMaterialAnnouncements');

const SIGNIFICANT_YOY_SWING = 10;   // 百分點
const SIGNIFICANT_MARGIN_SWING = 2; // 百分點

async function getCoverageStockIds() {
  const [rows] = await pool.query('SELECT stock_id FROM company_profiles WHERE is_coverage_active = 1');
  return rows.map(r => r.stock_id);
}

async function snapshotStock(stockId) {
  const [[rev]] = await pool.query(
    'SELECT year, month, revenue, revenue_yoy FROM monthly_revenue WHERE stock_id=? ORDER BY year DESC, month DESC LIMIT 1',
    [stockId]
  );
  const [[fin]] = await pool.query(
    `SELECT fs.year, fs.quarter, fr.gross_margin, fr.operating_margin, fr.roe
     FROM financial_statements fs
     LEFT JOIN financial_ratios fr ON fs.stock_id = fr.stock_id AND fs.year = fr.year AND fs.quarter = fr.quarter
     WHERE fs.stock_id=? ORDER BY fs.year DESC, fs.quarter DESC LIMIT 1`,
    [stockId]
  );
  return { rev: rev || null, fin: fin || null };
}

async function snapshotAll(stockIds) {
  const snapshot = {};
  for (const id of stockIds) snapshot[id] = await snapshotStock(id);
  return snapshot;
}

function diffStock(stockId, before, after) {
  const rows = [];

  // 月營收
  const b = before.rev, a = after.rev;
  if (a) {
    const period = `${a.year}-${String(a.month).padStart(2, '0')}`;
    const samePeriod = b && b.year === a.year && b.month === a.month;
    const oldRevenue = samePeriod ? parseFloat(b.revenue) : null;
    const newRevenue = parseFloat(a.revenue);
    const isNewPeriod = !samePeriod;

    if (isNewPeriod || oldRevenue !== newRevenue) {
      rows.push({ stock_id: stockId, metric: 'monthly_revenue', period, old_value: oldRevenue, new_value: newRevenue, is_new: isNewPeriod, is_significant: isNewPeriod });
    }

    const oldYoy = samePeriod && b.revenue_yoy != null ? parseFloat(b.revenue_yoy) : null;
    const newYoy = a.revenue_yoy != null ? parseFloat(a.revenue_yoy) : null;
    if ((isNewPeriod && newYoy != null) || (!isNewPeriod && oldYoy !== newYoy)) {
      const swung = oldYoy != null && newYoy != null && (
        Math.abs(newYoy - oldYoy) >= SIGNIFICANT_YOY_SWING || Math.sign(oldYoy) !== Math.sign(newYoy)
      );
      rows.push({ stock_id: stockId, metric: 'revenue_yoy', period, old_value: oldYoy, new_value: newYoy, is_new: isNewPeriod, is_significant: isNewPeriod || swung });
    }
  }

  // 季度財務比率
  const bf = before.fin, af = after.fin;
  if (af) {
    const period = `${af.year}Q${af.quarter}`;
    const samePeriod = bf && bf.year === af.year && bf.quarter === af.quarter;
    const isNewPeriod = !samePeriod;

    for (const metric of ['gross_margin', 'operating_margin', 'roe']) {
      const newV = af[metric] != null ? parseFloat(af[metric]) : null;
      if (newV == null) continue;
      const oldV = samePeriod && bf[metric] != null ? parseFloat(bf[metric]) : null;
      if (isNewPeriod || oldV !== newV) {
        const swung = oldV != null && Math.abs(newV - oldV) >= SIGNIFICANT_MARGIN_SWING;
        rows.push({ stock_id: stockId, metric, period, old_value: oldV, new_value: newV, is_new: isNewPeriod, is_significant: isNewPeriod || swung });
      }
    }
  }

  return rows;
}

async function runDailySync() {
  const [runResult] = await pool.query("INSERT INTO sync_runs (status) VALUES ('running')");
  const runId = runResult.insertId;

  try {
    const stockIds = await getCoverageStockIds();
    const before = await snapshotAll(stockIds);

    // 1. 參考股價（全市場，快，僅供參考不影響框架結論）
    await fetchAllStocksLatestPrices().catch(e => console.error('[dailySync] 股價同步失敗:', e.message));

    // 2. 月營收（覆蓋清單，自動偵測缺口）
    await fetchRecentMonthlyRevenue().catch(e => console.error('[dailySync] 月營收同步失敗:', e.message));

    // 3. 季度財報（覆蓋清單，同季已有資料就跳過，避免每天重打 FinMind）
    const quarters = getLatestAvailableQuarters(4);
    for (const { year, quarter } of quarters) {
      const [[existing]] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM financial_statements WHERE year=? AND quarter=?', [year, quarter]
      );
      if (existing.cnt > 0) continue;
      await fetchAndSaveFinancialStatements(year, quarter).catch(e => console.error('[dailySync] 財報同步失敗:', e.message));
    }

    // 4. 官方重大訊息：注意股清單 / 自結損益 / 財報董事會實際排定日期 / 法說會排程（全市場，供之後任何覆蓋股票觸發時都能查到）
    const materialResult = await syncMaterialAnnouncements().catch(e => {
      console.error('[dailySync] 重大訊息同步失敗:', e.message);
      return { attention: 0, self_disclosure: 0, earnings_schedule: 0, earnings_announced: 0, earnings_call: 0 };
    });

    const after = await snapshotAll(stockIds);

    let changeCount = 0, significantCount = 0;
    for (const id of stockIds) {
      const rows = diffStock(id, before[id], after[id]);
      for (const r of rows) {
        await pool.query(
          `INSERT INTO data_change_log (run_id, stock_id, metric, period, old_value, new_value, is_new, is_significant)
           VALUES (?,?,?,?,?,?,?,?)`,
          [runId, r.stock_id, r.metric, r.period, r.old_value, r.new_value, r.is_new, r.is_significant]
        );
        changeCount++;
        if (r.is_significant) significantCount++;

        // 新月營收自動建立一筆事件日誌草稿，供人工覆盤時補上 affected_hypothesis / impact_on_judgment
        if (r.metric === 'monthly_revenue' && r.is_new) {
          const yoyRow = rows.find(x => x.metric === 'revenue_yoy' && x.period === r.period);
          const yoyStr = yoyRow && yoyRow.new_value != null
            ? `YoY ${yoyRow.new_value >= 0 ? '+' : ''}${yoyRow.new_value}%`
            : 'YoY 待計算';
          const revenueYi = (r.new_value / 1e8).toFixed(2);
          await pool.query(
            `INSERT INTO company_events (stock_id, event_date, event_desc) VALUES (?, CURDATE(), ?)`,
            [id, `月營收公布：${r.period} 營收 ${revenueYi} 億，${yoyStr}（自動偵測，待覆盤）`]
          );
        }
      }
    }

    const materialTotal = materialResult.attention + materialResult.self_disclosure + materialResult.earnings_schedule + materialResult.earnings_announced + materialResult.earnings_call;
    await pool.query("UPDATE sync_runs SET status='done', finished_at=NOW() WHERE id=?", [runId]);
    console.log(`[dailySync] 完成，共 ${changeCount} 筆變化（${significantCount} 筆需留意），重大訊息 ${materialTotal} 筆新增`);
    return {
      runId, stockCount: stockIds.length, changeCount, significantCount,
      material: materialResult,
    };
  } catch (error) {
    await pool.query("UPDATE sync_runs SET status='failed', error_message=?, finished_at=NOW() WHERE id=?", [error.message, runId]);
    throw error;
  }
}

if (require.main === module) {
  runDailySync()
    .then(r => { console.log('結果:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runDailySync };
