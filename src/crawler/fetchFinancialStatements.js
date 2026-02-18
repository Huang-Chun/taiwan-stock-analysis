const { pool } = require('../database/connection');
const { fetchFinMindData } = require('./finmindApi');

// FinMind type → DB column 對照表
const INCOME_STATEMENT_MAP = {
  'Revenue': 'revenue',
  'CostOfGoodsSold': 'operating_cost',
  'GrossProfit': 'gross_profit',
  'OperatingExpenses': 'operating_expense',
  'OperatingIncome': 'operating_income',
  'TotalNonoperatingIncomeAndExpense': 'non_operating_income',
  'PreTaxIncome': 'pretax_income',
  'IncomeAfterTaxes': 'net_income',
  'EPS': 'eps',
};

const BALANCE_SHEET_MAP = {
  'TotalAssets': 'total_assets',
  'CurrentAssets': 'current_assets',
  'NoncurrentAssets': 'non_current_assets',
  'Liabilities': 'total_liabilities',
  'CurrentLiabilities': 'current_liabilities',
  'NoncurrentLiabilities': 'non_current_liabilities',
  'Equity': 'equity',
};

const CASH_FLOW_MAP = {
  'NetCashInflowFromOperatingActivities': 'operating_cash_flow',
  'CashProvidedByInvestingActivities': 'investing_cash_flow',
  'CashFlowsProvidedFromFinancingActivities': 'financing_cash_flow',
};

function quarterEndDate(year, quarter) {
  const monthDay = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
  return `${year}-${monthDay[quarter]}`;
}

function pivotRows(rows, typeMap) {
  const result = {};
  for (const row of rows) {
    const col = typeMap[row.type];
    if (!col) continue;
    if (!result[row.stock_id]) result[row.stock_id] = {};
    result[row.stock_id][col] = row.value;
  }
  return result;
}

/**
 * 抓取 3 個 dataset（可帶 data_id 或不帶）
 */
async function fetchThreeDatasets(dateStr, extraParams = {}) {
  const params = { start_date: dateStr, end_date: dateStr, ...extraParams };

  const [incomeRows, balanceRows, cashFlowRows] = await Promise.all([
    fetchFinMindData('TaiwanStockFinancialStatements', params),
    fetchFinMindData('TaiwanStockBalanceSheet', params),
    fetchFinMindData('TaiwanStockCashFlowsStatement', params),
  ]);

  return { incomeRows, balanceRows, cashFlowRows };
}

function buildRecords(incomeRows, balanceRows, cashFlowRows, year, quarter) {
  const incomeMap = pivotRows(incomeRows, INCOME_STATEMENT_MAP);
  const balanceMap = pivotRows(balanceRows, BALANCE_SHEET_MAP);
  const cashFlowMap = pivotRows(cashFlowRows, CASH_FLOW_MAP);

  const allStockIds = new Set([
    ...Object.keys(incomeMap),
    ...Object.keys(balanceMap),
    ...Object.keys(cashFlowMap),
  ]);

  const records = [];
  for (const stockId of allStockIds) {
    if (!/^\d{4}$/.test(stockId)) continue;

    const income = incomeMap[stockId] || {};
    const balance = balanceMap[stockId] || {};
    const cashFlow = cashFlowMap[stockId] || {};

    const operatingCF = cashFlow.operating_cash_flow ?? null;
    const investingCF = cashFlow.investing_cash_flow ?? null;
    const freeCF = (operatingCF != null && investingCF != null)
      ? operatingCF + investingCF : null;

    records.push({
      stock_id: stockId, year, quarter, report_type: '合併',
      revenue: income.revenue ?? null,
      operating_cost: income.operating_cost ?? null,
      gross_profit: income.gross_profit ?? null,
      operating_expense: income.operating_expense ?? null,
      operating_income: income.operating_income ?? null,
      non_operating_income: income.non_operating_income ?? null,
      pretax_income: income.pretax_income ?? null,
      net_income: income.net_income ?? null,
      eps: income.eps ?? null,
      total_assets: balance.total_assets ?? null,
      current_assets: balance.current_assets ?? null,
      non_current_assets: balance.non_current_assets ?? null,
      total_liabilities: balance.total_liabilities ?? null,
      current_liabilities: balance.current_liabilities ?? null,
      non_current_liabilities: balance.non_current_liabilities ?? null,
      equity: balance.equity ?? null,
      operating_cash_flow: operatingCF,
      investing_cash_flow: investingCF,
      financing_cash_flow: cashFlow.financing_cash_flow ?? null,
      free_cash_flow: freeCF,
    });
  }
  return records;
}

/**
 * 從 FinMind 抓取指定年/季的財報資料
 * - 先嘗試批次模式（不帶 data_id，需要付費 token）
 * - 若失敗則改為逐檔抓取（免費帳號可用）
 * - 可傳入 stockId 只抓單檔
 */
async function fetchFinancialStatements(year, quarter, stockId) {
  try {
    if (!process.env.FINMIND_TOKEN) {
      console.error('錯誤：需要設定 FINMIND_TOKEN 環境變數。');
      console.error('請至 https://finmindtrade.com/ 免費註冊取得 token，並加入 .env 檔案');
      return [];
    }

    const dateStr = quarterEndDate(year, quarter);
    console.log(`抓取 ${year} Q${quarter} 財報資料 (FinMind)...`);

    let allIncome = [], allBalance = [], allCashFlow = [];

    if (stockId) {
      // 單檔模式
      const { incomeRows, balanceRows, cashFlowRows } = await fetchThreeDatasets(dateStr, { data_id: stockId });
      allIncome = incomeRows; allBalance = balanceRows; allCashFlow = cashFlowRows;
    } else {
      // 嘗試批次模式
      try {
        const { incomeRows, balanceRows, cashFlowRows } = await fetchThreeDatasets(dateStr);
        allIncome = incomeRows; allBalance = balanceRows; allCashFlow = cashFlowRows;
      } catch (batchErr) {
        // 免費帳號無法批次抓取，改為逐檔（每檔 3 次 API，1045 檔約需 6 小時）
        console.log(`  批次模式不可用: ${batchErr.message}`);
        console.log(`  免費帳號將逐檔抓取（速度較慢）。升級 FinMind 帳號可一次抓取全部。`);
        console.log(`  或使用: node src/crawler/fetchFinancialStatements.js ${year} ${quarter} <股票代號>`);

        const [rows] = await pool.query('SELECT stock_id FROM stocks WHERE is_active = 1 ORDER BY stock_id');
        const stockIds = rows.map(r => r.stock_id);
        console.log(`  共 ${stockIds.length} 檔，開始抓取...`);

        let consecutiveFails = 0;
        for (let i = 0; i < stockIds.length; i++) {
          const sid = stockIds[i];
          try {
            const { incomeRows, balanceRows, cashFlowRows } = await fetchThreeDatasets(dateStr, { data_id: sid });
            allIncome.push(...incomeRows);
            allBalance.push(...balanceRows);
            allCashFlow.push(...cashFlowRows);
            consecutiveFails = 0;
          } catch (err) {
            if (err.message && err.message.includes('402')) {
              consecutiveFails++;
              if (consecutiveFails > 5) {
                console.error(`  API 頻率限制，已抓取 ${i} 檔後停止。請稍後再執行。`);
                break;
              }
              console.warn(`  頻率限制，等待 15 秒... (${consecutiveFails}/5)`);
              await new Promise(r => setTimeout(r, 15000));
              i--; // 重試
            }
          }
          if ((i + 1) % 50 === 0) console.log(`  進度: ${i + 1}/${stockIds.length}`);
        }
      }
    }

    console.log(`  損益表: ${allIncome.length} 筆, 資產負債表: ${allBalance.length} 筆, 現金流量表: ${allCashFlow.length} 筆`);
    return buildRecords(allIncome, allBalance, allCashFlow, year, quarter);
  } catch (error) {
    console.error(`抓取 ${year} Q${quarter} 財報失敗:`, error.message);
    return [];
  }
}

/**
 * 將 records 寫入資料庫
 */
async function saveRecords(records) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const r of records) {
      await connection.query(
        `INSERT INTO financial_statements
        (stock_id, year, quarter, report_type, revenue, operating_cost, gross_profit,
         operating_expense, operating_income, non_operating_income, pretax_income,
         net_income, eps, total_assets, current_assets, non_current_assets,
         total_liabilities, current_liabilities, non_current_liabilities, equity,
         operating_cash_flow, investing_cash_flow, financing_cash_flow, free_cash_flow)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        report_type = VALUES(report_type), revenue = VALUES(revenue),
        operating_cost = VALUES(operating_cost), gross_profit = VALUES(gross_profit),
        operating_expense = VALUES(operating_expense), operating_income = VALUES(operating_income),
        non_operating_income = VALUES(non_operating_income), pretax_income = VALUES(pretax_income),
        net_income = VALUES(net_income), eps = VALUES(eps),
        total_assets = VALUES(total_assets), current_assets = VALUES(current_assets),
        non_current_assets = VALUES(non_current_assets), total_liabilities = VALUES(total_liabilities),
        current_liabilities = VALUES(current_liabilities), non_current_liabilities = VALUES(non_current_liabilities),
        equity = VALUES(equity), operating_cash_flow = VALUES(operating_cash_flow),
        investing_cash_flow = VALUES(investing_cash_flow), financing_cash_flow = VALUES(financing_cash_flow),
        free_cash_flow = VALUES(free_cash_flow)`,
        [r.stock_id, r.year, r.quarter, r.report_type, r.revenue, r.operating_cost,
         r.gross_profit, r.operating_expense, r.operating_income, r.non_operating_income,
         r.pretax_income, r.net_income, r.eps, r.total_assets, r.current_assets,
         r.non_current_assets, r.total_liabilities, r.current_liabilities,
         r.non_current_liabilities, r.equity, r.operating_cash_flow, r.investing_cash_flow,
         r.financing_cash_flow, r.free_cash_flow]
      );

      // 計算財務比率
      const grossMargin = (r.revenue && r.revenue !== 0 && r.gross_profit != null)
        ? (r.gross_profit / r.revenue * 100) : null;
      const operatingMargin = (r.revenue && r.revenue !== 0 && r.operating_income != null)
        ? (r.operating_income / r.revenue * 100) : null;
      const netMargin = (r.revenue && r.revenue !== 0 && r.net_income != null)
        ? (r.net_income / r.revenue * 100) : null;
      const roe = (r.equity && r.equity !== 0 && r.net_income != null)
        ? (r.net_income / r.equity * 100) : null;
      const roa = (r.total_assets && r.total_assets !== 0 && r.net_income != null)
        ? (r.net_income / r.total_assets * 100) : null;
      const debtRatio = (r.total_assets && r.total_assets !== 0 && r.total_liabilities != null)
        ? (r.total_liabilities / r.total_assets * 100) : null;
      const currentRatio = (r.current_liabilities && r.current_liabilities !== 0 && r.current_assets != null)
        ? (r.current_assets / r.current_liabilities * 100) : null;
      const debtToEquity = (r.equity && r.equity !== 0 && r.total_liabilities != null)
        ? (r.total_liabilities / r.equity) : null;

      if (grossMargin != null || roe != null) {
        await connection.query(
          `INSERT INTO financial_ratios
          (stock_id, year, quarter, gross_margin, operating_margin, net_margin,
           roe, roa, debt_ratio, current_ratio, debt_to_equity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
          gross_margin = VALUES(gross_margin), operating_margin = VALUES(operating_margin),
          net_margin = VALUES(net_margin), roe = VALUES(roe), roa = VALUES(roa),
          debt_ratio = VALUES(debt_ratio), current_ratio = VALUES(current_ratio),
          debt_to_equity = VALUES(debt_to_equity)`,
          [r.stock_id, r.year, r.quarter, grossMargin, operatingMargin, netMargin,
           roe, roa, debtRatio, currentRatio, debtToEquity]
        );
      }
    }

    await connection.commit();
    console.log(`✓ 成功寫入 ${records.length} 筆財報資料`);
    return records.length;
  } catch (error) {
    await connection.rollback();
    console.error('寫入財報資料失敗:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

async function fetchAndSaveFinancialStatements(year, quarter, stockId) {
  const records = await fetchFinancialStatements(year, quarter, stockId);
  if (records.length === 0) {
    console.log('無財報資料可寫入');
    return 0;
  }
  return await saveRecords(records);
}

/**
 * 根據今天日期，推算已公開的最新季度，再往回算共 count 季
 * 台灣財報公告期限：Q1→5/15, Q2→8/14, Q3→11/14, Q4(年報)→隔年3/31
 */
function getLatestAvailableQuarters(count = 4) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  const d = now.getDate();

  let latestYear, latestQuarter;

  if (m > 11 || (m === 11 && d >= 14)) {
    // 11/14 之後 → 當年 Q3 可用
    latestYear = y; latestQuarter = 3;
  } else if (m > 8 || (m === 8 && d >= 14)) {
    // 8/14 之後 → 當年 Q2 可用
    latestYear = y; latestQuarter = 2;
  } else if (m > 5 || (m === 5 && d >= 15)) {
    // 5/15 之後 → 當年 Q1 可用
    latestYear = y; latestQuarter = 1;
  } else if (m > 3 || (m === 3 && d >= 31)) {
    // 3/31 之後 → 前年 Q4 可用
    latestYear = y - 1; latestQuarter = 4;
  } else {
    // 1/1 ~ 3/30 → 前年 Q3 可用
    latestYear = y - 1; latestQuarter = 3;
  }

  const quarters = [];
  let qy = latestYear, qq = latestQuarter;
  for (let i = 0; i < count; i++) {
    quarters.push({ year: qy, quarter: qq });
    qq -= 1;
    if (qq <= 0) { qy -= 1; qq = 4; }
  }
  return quarters;
}

async function fetchRecentFinancialStatements() {
  const quarters = getLatestAvailableQuarters(4);
  let total = 0;
  for (const { year, quarter } of quarters) {
    total += await fetchAndSaveFinancialStatements(year, quarter);
  }
  return total;
}

if (require.main === module) {
  const yearArg = process.argv[2] ? parseInt(process.argv[2]) : null;
  const quarterArg = process.argv[3] ? parseInt(process.argv[3]) : null;
  const stockArg = process.argv[4] || null; // 可選：指定股票代號

  let fn;
  if (yearArg && quarterArg) {
    fn = () => fetchAndSaveFinancialStatements(yearArg, quarterArg, stockArg);
  } else {
    fn = fetchRecentFinancialStatements;
  }

  fn()
    .then(() => { console.log('完成！'); process.exit(0); })
    .catch(error => { console.error(error); process.exit(1); });
}

module.exports = {
  fetchFinancialStatements,
  fetchAndSaveFinancialStatements,
  fetchRecentFinancialStatements,
  getLatestAvailableQuarters
};
