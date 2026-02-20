const ExcelJS = require('exceljs');
const path = require('path');

const wb = new ExcelJS.Workbook();

const HEADER_COLOR = 'FF1F3864';
const TYPE_COLOR = {
  'sync（爬蟲）':     'FF4472C4',
  'calculate（計算）':'FF70AD47',
  'get（查詢）':      'FFFFC000',
  'analyze（分析）':  'FFED7D31',
};
const STRIPE = 'FFF2F2F2';

function styleHeader(ws) {
  ws.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_COLOR } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.getRow(1).height = 24;
}

function stripeRow(row, idx, colorKey) {
  row.eachCell(cell => {
    if (idx % 2 === 0) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } };
    }
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  if (colorKey) {
    const color = TYPE_COLOR[colorKey] || 'FFFFFFFF';
    row.getCell('type').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    row.getCell('type').font = { color: { argb: 'FFFFFFFF' }, bold: true };
    row.getCell('type').alignment = { vertical: 'middle', horizontal: 'center' };
  }
}

// =============================================
// Sheet 1: API 總覽
// =============================================
const ws1 = wb.addWorksheet('API 總覽');
ws1.columns = [
  { header: 'API 名稱',     key: 'api',       width: 30 },
  { header: '類型',         key: 'type',      width: 14 },
  { header: '資料方向',     key: 'direction', width: 11 },
  { header: '說明',         key: 'desc',      width: 40 },
  { header: '呼叫函式',     key: 'func',      width: 55 },
  { header: '資料來源',     key: 'source',    width: 20 },
  { header: '讀取 Table',   key: 'read',      width: 42 },
  { header: '寫入 Table',   key: 'write',     width: 26 },
];

const apiRows = [
  // ── sync 類 ──
  {
    api: 'sync_stock_list', type: 'sync（爬蟲）', direction: '→ DB',
    desc: '從 TWSE 同步上市股票清單',
    func: 'fetchStockList()',
    source: 'TWSE API', read: '', write: 'stocks',
  },
  {
    api: 'sync_daily_prices', type: 'sync（爬蟲）', direction: '→ DB',
    desc: '抓 TWSE 每日股價，支援單股 / 多月',
    func: 'fetchRecentPrices() / fetchBatchDailyPrices() / fetchMultiMonthPrices()',
    source: 'TWSE API', read: '', write: 'daily_prices',
  },
  {
    api: 'sync_institutional_trading', type: 'sync（爬蟲）', direction: '→ DB',
    desc: '三大法人買賣超；單股用 FinMind，全市場用 TWSE T86',
    func: 'fetchAndSaveInstitutionalTradingForStock() / fetchAndSaveInstitutionalTrading() / fetchRecentInstitutionalTrading()',
    source: 'TWSE T86 / FinMind', read: 'stocks（FK 過濾）', write: 'institutional_trading',
  },
  {
    api: 'sync_margin_trading', type: 'sync（爬蟲）', direction: '→ DB',
    desc: '抓 TWSE 融資融券資料',
    func: 'fetchAndSaveMarginTrading() / fetchRecentMarginTrading()',
    source: 'TWSE API', read: '', write: 'margin_trading',
  },
  {
    api: 'sync_monthly_revenue', type: 'sync（爬蟲）', direction: '→ DB',
    desc: '抓月營收，支援單股 / 指定年月 / 全市場',
    func: 'fetchAndSaveMonthlyRevenue() / fetchRecentMonthlyRevenue() / fetchMonthlyRevenue()',
    source: 'FinMind API', read: '', write: 'monthly_revenue',
  },
  {
    api: 'sync_financial_statements', type: 'sync（爬蟲）', direction: '→ DB',
    desc: '抓季度財報（損益表、財務比率），支援單股 / 全市場',
    func: 'fetchAndSaveFinancialStatements() / fetchRecentFinancialStatements() / getLatestAvailableQuarters()',
    source: 'FinMind API', read: 'financial_statements（重複檢查）', write: 'financial_statements',
  },
  {
    api: 'sync_dividends', type: 'sync（爬蟲）', direction: '→ DB',
    desc: '抓股利除權息資料',
    func: 'fetchAndSaveDividends() / fetchRecentDividends()',
    source: 'TWSE / FinMind', read: '', write: 'dividends',
  },
  // ── calculate 類 ──
  {
    api: 'calculate_indicators', type: 'calculate（計算）', direction: 'DB→DB',
    desc: '從 daily_prices 計算 MA/RSI/MACD/KD/布林/VWAP/ATR/ADX/Williams%R/OBV',
    func: 'calculateIndicatorsForStock() / calculateAllIndicators()',
    source: '（無外部）', read: 'daily_prices', write: 'technical_indicators',
  },
  // ── get 類 ──
  {
    api: 'get_stock_list', type: 'get（查詢）', direction: '← DB',
    desc: '查股票清單，支援關鍵字搜尋，最多 100 筆',
    func: '（直接 SQL）',
    source: '（無外部）', read: 'stocks', write: '',
  },
  {
    api: 'get_stock_detail', type: 'get（查詢）', direction: '← DB',
    desc: '查單一股票基本資料（名稱、產業、市場別）',
    func: '（直接 SQL）',
    source: '（無外部）', read: 'stocks', write: '',
  },
  {
    api: 'get_stock_prices', type: 'get（查詢）', direction: '← DB',
    desc: '查歷史股價，預設 30 筆，由舊到新排列',
    func: '（直接 SQL）',
    source: '（無外部）', read: 'daily_prices', write: '',
  },
  {
    api: 'get_stock_latest', type: 'get（查詢）', direction: '← DB',
    desc: '查最新股價 + 全部技術指標（JOIN 三表）',
    func: '（直接 SQL JOIN）',
    source: '（無外部）', read: 'stocks, daily_prices, technical_indicators', write: '',
  },
  {
    api: 'get_institutional_trading', type: 'get（查詢）', direction: '← DB',
    desc: '查三大法人趨勢 / 買賣共識 / 籌碼累積',
    func: 'analyzeInstitutionalTrend() / analyzeConsensus() / detectAccumulation()',
    source: '（無外部）', read: 'institutional_trading', write: '',
  },
  {
    api: 'get_margin_trading', type: 'get（查詢）', direction: '← DB',
    desc: '查融資融券趨勢分析',
    func: 'analyzeMarginTrend()',
    source: '（無外部）', read: 'margin_trading', write: '',
  },
  {
    api: 'get_monthly_revenue', type: 'get（查詢）', direction: '← DB',
    desc: '查月營收 + YoY / MoM 成長趨勢',
    func: 'analyzeRevenueTrend()',
    source: '（無外部）', read: 'monthly_revenue', write: '',
  },
  {
    api: 'get_financial_summary', type: 'get（查詢）', direction: '← DB',
    desc: '查近四季財報摘要（損益、財務比率）',
    func: 'getFinancialSummary()',
    source: '（無外部）', read: 'financial_statements', write: '',
  },
  {
    api: 'get_valuation', type: 'get（查詢）', direction: '← DB',
    desc: '查 PE / PB / 殖利率估值指標',
    func: 'calculateValuation()',
    source: '（無外部）', read: 'financial_statements, daily_prices, dividends', write: '',
  },
  // ── analyze 類 ──
  {
    api: 'screen_stocks', type: 'analyze（分析）', direction: '← DB',
    desc: '依技術指標條件篩選股票（RSI / MA / KD / MACD / ADX）',
    func: '（直接 SQL）',
    source: '（無外部）', read: 'stocks, daily_prices, technical_indicators', write: '',
  },
  {
    api: 'screen_by_strategy', type: 'analyze（分析）', direction: '← DB',
    desc: '依策略篩選：golden_cross / rsi_oversold / macd_golden_cross / volume_breakout / bollinger_squeeze',
    func: 'screenByStrategy()',
    source: '（無外部）', read: 'stocks, daily_prices, technical_indicators', write: '',
  },
  {
    api: 'screen_by_institutional', type: 'analyze（分析）', direction: '← DB',
    desc: '依外資 / 投信累計買賣超篩選股票',
    func: 'screenByInstitutional()',
    source: '（無外部）', read: 'institutional_trading, stocks', write: '',
  },
  {
    api: 'detect_signals', type: 'analyze（分析）', direction: '← DB',
    desc: '偵測單股交易訊號（黃金交叉 / 布林突破 / RSI 超賣等）',
    func: 'detectAllSignals()',
    source: '（無外部）', read: 'daily_prices, technical_indicators', write: '',
  },
  {
    api: 'score_stock', type: 'analyze（分析）', direction: '← DB',
    desc: '技術面 + 基本面綜合評分 0-100 分（各佔 50%）',
    func: 'scoreStock() / scoreFundamental()',
    source: '（無外部）', read: 'technical_indicators, financial_statements, dividends', write: '',
  },
];

apiRows.forEach((r, i) => {
  const row = ws1.addRow(r);
  stripeRow(row, i, r.type);
});
styleHeader(ws1);

// =============================================
// Sheet 2: DB Table 與依賴
// =============================================
const ws2 = wb.addWorksheet('DB Table 與依賴');
ws2.columns = [
  { header: 'Table 名稱',         key: 'table',   width: 24 },
  { header: '說明',               key: 'desc',    width: 26 },
  { header: '寫入來源 API',       key: 'written', width: 30 },
  { header: '被哪些 API 讀取',    key: 'readby',  width: 68 },
  { header: '前置依賴 Table',     key: 'depends', width: 24 },
];

const tableRows = [
  { table: 'stocks',               desc: '股票基本資料（名稱、產業）',   written: 'sync_stock_list',              readby: 'get_stock_list, get_stock_detail, get_stock_latest, screen_stocks, screen_by_strategy, screen_by_institutional, sync_institutional_trading（FK）', depends: '（無，最先建立）' },
  { table: 'daily_prices',         desc: '每日股價（OHLCV）',            written: 'sync_daily_prices',            readby: 'get_stock_prices, get_stock_latest, screen_stocks, screen_by_strategy, detect_signals, get_valuation, calculate_indicators', depends: 'stocks' },
  { table: 'technical_indicators', desc: '技術指標（MA/RSI/MACD/KD…）', written: 'calculate_indicators',         readby: 'get_stock_latest, screen_stocks, screen_by_strategy, detect_signals, score_stock', depends: 'daily_prices' },
  { table: 'institutional_trading',desc: '三大法人買賣超',               written: 'sync_institutional_trading',   readby: 'get_institutional_trading, screen_by_institutional', depends: 'stocks' },
  { table: 'margin_trading',       desc: '融資融券',                     written: 'sync_margin_trading',          readby: 'get_margin_trading', depends: 'stocks' },
  { table: 'monthly_revenue',      desc: '月營收',                       written: 'sync_monthly_revenue',         readby: 'get_monthly_revenue, score_stock', depends: 'stocks' },
  { table: 'financial_statements', desc: '季度財報（損益表、比率）',     written: 'sync_financial_statements',    readby: 'get_financial_summary, get_valuation, score_stock', depends: 'stocks' },
  { table: 'dividends',            desc: '股利除權息',                   written: 'sync_dividends',               readby: 'get_valuation, score_stock', depends: 'stocks' },
];

tableRows.forEach((r, i) => {
  const row = ws2.addRow(r);
  stripeRow(row, i, null);
});
styleHeader(ws2);

// =============================================
// Sheet 3: 初始化順序
// =============================================
const ws3 = wb.addWorksheet('初始化順序');
ws3.columns = [
  { header: '步驟', key: 'step',  width: 8  },
  { header: 'API',  key: 'api',   width: 30 },
  { header: '說明', key: 'desc',  width: 48 },
  { header: '備註', key: 'note',  width: 44 },
];

const stepRows = [
  { step: 1, api: 'sync_stock_list',           desc: '建立股票清單 → stocks',                         note: '必須最先跑，其他 table 皆依賴' },
  { step: 2, api: 'sync_daily_prices',         desc: '抓股價 → daily_prices',                        note: '建議先跑目標股票，或全市場批次' },
  { step: 3, api: 'calculate_indicators',      desc: '計算技術指標 → technical_indicators',           note: '須在 sync_daily_prices 之後才能執行' },
  { step: 4, api: 'sync_institutional_trading',desc: '抓三大法人 → institutional_trading',            note: '可單股（FinMind）或全市場（TWSE）' },
  { step: 5, api: 'sync_margin_trading',       desc: '抓融資融券 → margin_trading',                  note: '可選' },
  { step: 6, api: 'sync_monthly_revenue',      desc: '抓月營收 → monthly_revenue',                   note: '可選，使用 FinMind API' },
  { step: 7, api: 'sync_financial_statements', desc: '抓季度財報 → financial_statements',            note: '可選，使用 FinMind API' },
  { step: 8, api: 'sync_dividends',            desc: '抓股利 → dividends',                           note: '可選' },
  { step: '✓', api: '（以上完成後）',          desc: '所有 get_* / screen_* / detect_* / score_* 均可正常使用', note: '' },
];

stepRows.forEach((r, i) => {
  const row = ws3.addRow(r);
  stripeRow(row, i, null);
});
styleHeader(ws3);

// 輸出
const outPath = path.join('C:/Users/User/Desktop', 'taiwan_stock_api_reference.xlsx');
wb.xlsx.writeFile(outPath).then(() => {
  console.log('✓ 已輸出：' + outPath);
}).catch(e => console.error(e));
