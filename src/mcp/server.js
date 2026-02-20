const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { pool } = require('../database/connection');
const { fetchStockList } = require('../crawler/fetchStockList');
const { fetchRecentPrices, fetchBatchDailyPrices, fetchMultiMonthPrices } = require('../crawler/fetchDailyPrices');
const { calculateIndicatorsForStock, calculateAllIndicators } = require('../analysis/calculateIndicators');
const { fetchAndSaveInstitutionalTrading, fetchRecentInstitutionalTrading } = require('../crawler/fetchInstitutionalTrading');
const { fetchAndSaveMarginTrading, fetchRecentMarginTrading } = require('../crawler/fetchMarginTrading');
const { fetchAndSaveMonthlyRevenue, fetchRecentMonthlyRevenue } = require('../crawler/fetchMonthlyRevenue');
const { fetchAndSaveFinancialStatements, fetchRecentFinancialStatements, getLatestAvailableQuarters } = require('../crawler/fetchFinancialStatements');
const { fetchAndSaveDividends, fetchRecentDividends } = require('../crawler/fetchDividends');
const { detectAllSignals, scoreStock, screenByStrategy } = require('../analysis/strategies');
const { analyzeInstitutionalTrend, detectAccumulation, analyzeConsensus, analyzeMarginTrend, screenByInstitutional } = require('../analysis/institutionalAnalysis');
const { analyzeRevenueTrend, calculateValuation, getFinancialSummary, scoreFundamental } = require('../analysis/fundamentalAnalysis');

const server = new McpServer({
  name: 'taiwan-stock-analysis',
  version: '2.0.0',
});

// ============================================
// 查詢類 Tools
// ============================================

server.tool(
  'get_stock_list',
  '取得所有上市股票清單,可用 keyword 模糊搜尋股票名稱或代號',
  { keyword: z.string().optional().describe('搜尋關鍵字（股票名稱或代號）') },
  async ({ keyword }) => {
    try {
      let query = 'SELECT stock_id, stock_name, industry, market_type FROM stocks WHERE is_active = TRUE';
      const params = [];

      if (keyword) {
        query += ' AND (stock_id LIKE ? OR stock_name LIKE ?)';
        const like = `%${keyword}%`;
        params.push(like, like);
      }

      query += ' ORDER BY stock_id LIMIT 100';

      const [rows] = await pool.query(query, params);
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: rows.length, data: rows }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_stock_detail',
  '取得單一股票的詳細資訊',
  { stock_id: z.string().describe('股票代號,例如 2330') },
  async ({ stock_id }) => {
    try {
      const [rows] = await pool.query('SELECT * FROM stocks WHERE stock_id = ?', [stock_id]);
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `找不到股票 ${stock_id}` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(rows[0], null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_stock_prices',
  '取得股票歷史股價資料',
  {
    stock_id: z.string().describe('股票代號,例如 2330'),
    limit: z.number().optional().default(30).describe('回傳筆數,預設 30'),
  },
  async ({ stock_id, limit }) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM daily_prices WHERE stock_id = ? ORDER BY trade_date DESC LIMIT ?`,
        [stock_id, limit]
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: rows.length, data: rows.reverse() }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_stock_latest',
  '取得股票最新股價與技術指標（MA、RSI、MACD、KD、布林通道、VWAP、ATR、ADX、Williams %R、OBV）',
  { stock_id: z.string().describe('股票代號,例如 2330') },
  async ({ stock_id }) => {
    try {
      const [rows] = await pool.query(
        `SELECT
          s.stock_id, s.stock_name, s.industry,
          dp.trade_date, dp.close_price, dp.open_price, dp.high_price, dp.low_price,
          dp.volume, dp.change_amount, dp.change_percent,
          ti.ma5, ti.ma10, ti.ma20, ti.ma60, ti.rsi,
          ti.macd, ti.macd_signal, ti.macd_histogram,
          ti.kd_k, ti.kd_d,
          ti.bollinger_upper, ti.bollinger_middle, ti.bollinger_lower,
          ti.vwap, ti.atr, ti.adx, ti.plus_di, ti.minus_di, ti.williams_r, ti.obv
        FROM stocks s
        LEFT JOIN daily_prices dp ON s.stock_id = dp.stock_id
        LEFT JOIN technical_indicators ti ON s.stock_id = ti.stock_id
          AND dp.trade_date = ti.trade_date
        WHERE s.stock_id = ?
        ORDER BY dp.trade_date DESC
        LIMIT 1`,
        [stock_id]
      );

      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `找不到股票 ${stock_id} 的資料` }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(rows[0], null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'screen_stocks',
  '依技術指標篩選股票（RSI、均線位置、成交量、KD、MACD、ADX 等）',
  {
    rsi_min: z.number().optional().describe('RSI 最小值'),
    rsi_max: z.number().optional().describe('RSI 最大值'),
    ma_position: z.enum(['above', 'below']).optional().describe('收盤價相對 MA20 位置：above（站上）或 below（跌破）'),
    volume_min: z.number().optional().describe('最小成交量'),
    kd_golden_cross: z.boolean().optional().describe('篩選 K > D 的股票'),
    macd_positive: z.boolean().optional().describe('篩選 MACD 柱狀圖 > 0 的股票'),
    adx_min: z.number().optional().describe('ADX 最小值（趨勢強度）'),
  },
  async ({ rsi_min, rsi_max, ma_position, volume_min, kd_golden_cross, macd_positive, adx_min }) => {
    try {
      let query = `
        SELECT
          s.stock_id, s.stock_name, dp.close_price, dp.change_percent, dp.volume,
          ti.rsi, ti.ma5, ti.ma20, ti.kd_k, ti.kd_d, ti.macd_histogram, ti.adx
        FROM stocks s
        JOIN daily_prices dp ON s.stock_id = dp.stock_id
        JOIN technical_indicators ti ON s.stock_id = ti.stock_id
          AND dp.trade_date = ti.trade_date
        WHERE dp.trade_date = (
          SELECT MAX(trade_date) FROM daily_prices WHERE stock_id = s.stock_id
        )
      `;
      const params = [];

      if (rsi_min !== undefined) { query += ' AND ti.rsi >= ?'; params.push(rsi_min); }
      if (rsi_max !== undefined) { query += ' AND ti.rsi <= ?'; params.push(rsi_max); }
      if (ma_position === 'above') query += ' AND dp.close_price > ti.ma20';
      else if (ma_position === 'below') query += ' AND dp.close_price < ti.ma20';
      if (volume_min !== undefined) { query += ' AND dp.volume >= ?'; params.push(volume_min); }
      if (kd_golden_cross) query += ' AND ti.kd_k > ti.kd_d';
      if (macd_positive) query += ' AND ti.macd_histogram > 0';
      if (adx_min !== undefined) { query += ' AND ti.adx >= ?'; params.push(adx_min); }

      query += ' ORDER BY dp.change_percent DESC LIMIT 50';

      const [rows] = await pool.query(query, params);
      return {
        content: [{ type: 'text', text: JSON.stringify({ count: rows.length, data: rows }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

// ============================================
// 籌碼面查詢 Tools
// ============================================

server.tool(
  'get_institutional_trading',
  '查看指定股票的三大法人買賣超資料與趨勢分析',
  {
    stock_id: z.string().describe('股票代號'),
    days: z.number().optional().default(20).describe('分析天數,預設 20'),
  },
  async ({ stock_id, days }) => {
    try {
      const trend = await analyzeInstitutionalTrend(stock_id, days);
      const consensus = await analyzeConsensus(stock_id);
      const accumulation = await detectAccumulation(stock_id);

      return {
        content: [{ type: 'text', text: JSON.stringify({ trend, consensus, accumulation }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_margin_trading',
  '查看指定股票的融資融券資料與趨勢分析',
  {
    stock_id: z.string().describe('股票代號'),
    days: z.number().optional().default(20).describe('分析天數,預設 20'),
  },
  async ({ stock_id, days }) => {
    try {
      const result = await analyzeMarginTrend(stock_id, days);
      if (!result) {
        return { content: [{ type: 'text', text: `找不到股票 ${stock_id} 的融資融券資料` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

// ============================================
// 基本面查詢 Tools
// ============================================

server.tool(
  'get_monthly_revenue',
  '查看指定股票的月營收資料與成長趨勢',
  {
    stock_id: z.string().describe('股票代號'),
    months: z.number().optional().default(12).describe('查看月數,預設 12'),
  },
  async ({ stock_id, months }) => {
    try {
      const result = await analyzeRevenueTrend(stock_id, months);
      if (!result) {
        return { content: [{ type: 'text', text: `找不到股票 ${stock_id} 的營收資料` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_financial_summary',
  '查看指定股票的財報摘要（近四季損益表、財務比率）',
  { stock_id: z.string().describe('股票代號') },
  async ({ stock_id }) => {
    try {
      const result = await getFinancialSummary(stock_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_valuation',
  '查看指定股票的估值指標（本益比 PE、股價淨值比 PB、殖利率）',
  { stock_id: z.string().describe('股票代號') },
  async ({ stock_id }) => {
    try {
      const result = await calculateValuation(stock_id);
      if (!result) {
        return { content: [{ type: 'text', text: `找不到股票 ${stock_id} 的估值資料` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

// ============================================
// 分析類 Tools
// ============================================

server.tool(
  'detect_signals',
  '偵測指定股票的交易訊號（黃金交叉、RSI 超賣反彈、MACD 交叉、量能突破、布林通道突破）',
  { stock_id: z.string().describe('股票代號') },
  async ({ stock_id }) => {
    try {
      const signals = await detectAllSignals(stock_id);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          stock_id,
          signal_count: signals.length,
          signals
        }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'score_stock',
  '對指定股票進行綜合評分（技術面 + 基本面,0-100分）',
  { stock_id: z.string().describe('股票代號') },
  async ({ stock_id }) => {
    try {
      const technical = await scoreStock(stock_id);
      const fundamental = await scoreFundamental(stock_id);

      const combined = {
        stock_id,
        technical_score: technical ? technical.score : null,
        fundamental_score: fundamental ? fundamental.score : null,
        total_score: null,
        technical_details: technical ? technical.indicators : null,
        fundamental_details: fundamental ? fundamental.details : null
      };

      if (technical && fundamental) {
        combined.total_score = Math.round(technical.score * 0.5 + fundamental.score * 0.5);
      } else if (technical) {
        combined.total_score = technical.score;
      } else if (fundamental) {
        combined.total_score = fundamental.score;
      }

      return { content: [{ type: 'text', text: JSON.stringify(combined, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'screen_by_strategy',
  '依選股策略篩選股票（golden_cross / rsi_oversold / macd_golden_cross / volume_breakout / bollinger_squeeze）',
  {
    strategy: z.string().describe('策略名稱: golden_cross, rsi_oversold, macd_golden_cross, volume_breakout, bollinger_squeeze'),
    rsi_threshold: z.number().optional().default(30).describe('RSI 閾值（僅 rsi_oversold 策略使用）'),
  },
  async ({ strategy, rsi_threshold }) => {
    try {
      const result = await screenByStrategy(strategy, { rsi_threshold });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'screen_by_institutional',
  '依籌碼面篩選股票（法人買賣超）',
  {
    foreign_net_min: z.number().optional().describe('外資累計淨買超最低值（股）'),
    trust_net_min: z.number().optional().describe('投信累計淨買超最低值（股）'),
    days: z.number().optional().default(5).describe('累計天數,預設 5'),
  },
  async ({ foreign_net_min, trust_net_min, days }) => {
    try {
      const result = await screenByInstitutional({ foreign_net_min, trust_net_min, days });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

// ============================================
// 同步類 Tools
// ============================================

server.tool(
  'sync_stock_list',
  '從台灣證交所 (TWSE) 同步最新的上市股票清單到資料庫',
  {},
  async () => {
    try {
      const stocks = await fetchStockList();
      return { content: [{ type: 'text', text: `成功同步 ${stocks.length} 檔股票清單` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `同步失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_daily_prices',
  '從 TWSE 抓取最新每日股價資料並存入資料庫',
  {
    stock_id: z.string().optional().describe('指定股票代號,不填則抓取前 10 檔股票'),
    months: z.number().min(1).max(12).optional().describe('往回抓幾個月,預設 1,最大 12'),
  },
  async ({ stock_id, months }) => {
    try {
      if (stock_id) {
        if (months && months > 1) {
          const total = await fetchMultiMonthPrices(stock_id, months);
          return { content: [{ type: 'text', text: `成功抓取股票 ${stock_id} 近 ${months} 個月股價,共 ${total} 筆` }] };
        } else {
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const date = `${year}${month}01`;
          await fetchBatchDailyPrices([stock_id], date);
          return { content: [{ type: 'text', text: `成功抓取股票 ${stock_id} 的股價資料` }] };
        }
      } else {
        await fetchRecentPrices();
        return { content: [{ type: 'text', text: '成功抓取最近股價資料（前 10 檔）' }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `抓取失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'calculate_indicators',
  '計算技術指標（MA、RSI、MACD、KD、布林通道、VWAP、ATR、ADX、Williams %R、OBV）',
  {
    stock_id: z.string().optional().describe('指定股票代號,不填則計算所有股票'),
  },
  async ({ stock_id }) => {
    try {
      if (stock_id) {
        await calculateIndicatorsForStock(stock_id);
        return { content: [{ type: 'text', text: `成功計算股票 ${stock_id} 的技術指標` }] };
      } else {
        await calculateAllIndicators();
        return { content: [{ type: 'text', text: '成功計算所有股票的技術指標' }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `計算失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_institutional_trading',
  '抓取三大法人買賣超資料',
  {
    date: z.string().optional().describe('日期 YYYYMMDD 格式,不填則抓取最近交易日'),
  },
  async ({ date }) => {
    try {
      let count;
      if (date) {
        count = await fetchAndSaveInstitutionalTrading(date);
      } else {
        count = await fetchRecentInstitutionalTrading();
      }
      return { content: [{ type: 'text', text: `成功同步 ${count} 筆三大法人買賣超資料` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `同步失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_margin_trading',
  '抓取融資融券資料',
  {
    date: z.string().optional().describe('日期 YYYYMMDD 格式,不填則抓取最近交易日'),
  },
  async ({ date }) => {
    try {
      let count;
      if (date) {
        count = await fetchAndSaveMarginTrading(date);
      } else {
        count = await fetchRecentMarginTrading();
      }
      return { content: [{ type: 'text', text: `成功同步 ${count} 筆融資融券資料` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `同步失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_monthly_revenue',
  '抓取月營收資料',
  {
    year: z.number().optional().describe('西元年,不填則抓取最近月份'),
    month: z.number().optional().describe('月份 1-12'),
    stock_id: z.string().optional().describe('指定股票代號,不填則抓取全部(很慢)'),
  },
  async ({ year, month, stock_id }) => {
    try {
      let count;
      if (year && month) {
        const { fetchMonthlyRevenue } = require('../crawler/fetchMonthlyRevenue');
        if (stock_id) {
          // 單檔模式：直接呼叫底層函式帶 stockId
          const records = await fetchMonthlyRevenue(year, month, stock_id);
          if (records.length === 0) return { content: [{ type: 'text', text: `${stock_id} 在 ${year}/${month} 無月營收資料` }] };
          // 存入 DB（複用 fetchAndSaveMonthlyRevenue 的邏輯太耦合，直接存）
          const { pool } = require('../database/connection');
          const connection = await pool.getConnection();
          try {
            for (const r of records) {
              await connection.query(
                `INSERT INTO monthly_revenue (stock_id, year, month, revenue) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE revenue = VALUES(revenue)`,
                [r.stock_id, r.year, r.month, r.revenue]
              );
            }
            count = records.length;
          } finally { connection.release(); }
        } else {
          count = await fetchAndSaveMonthlyRevenue(year, month);
        }
      } else {
        count = await fetchRecentMonthlyRevenue(stock_id);
      }
      return { content: [{ type: 'text', text: `成功同步 ${count} 筆月營收資料` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `同步失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_financial_statements',
  '抓取季度財報資料（損益表、財務比率）',
  {
    year: z.number().optional().describe('西元年,不填則抓取最近季度'),
    quarter: z.number().optional().describe('季度 1-4'),
    stock_id: z.string().optional().describe('指定股票代號,不填則抓取全部(免費帳號很慢)'),
  },
  async ({ year, quarter, stock_id }) => {
    try {
      let count = 0;
      if (year && quarter) {
        count = await fetchAndSaveFinancialStatements(year, quarter, stock_id);
      } else {
        // 不帶年/季時，自動抓最近已公開的四季財報
        const quarters = getLatestAvailableQuarters(4);
        const labels = quarters.map(q => `${q.year}Q${q.quarter}`).join(', ');
        for (const { year: qy, quarter: qq } of quarters) {
          // 查 DB 是否已有此季財報，有則跳過
          const checkQuery = stock_id
            ? 'SELECT COUNT(*) AS cnt FROM financial_statements WHERE stock_id = ? AND year = ? AND quarter = ?'
            : 'SELECT COUNT(*) AS cnt FROM financial_statements WHERE year = ? AND quarter = ?';
          const checkParams = stock_id ? [stock_id, qy, qq] : [qy, qq];
          const [existing] = await pool.query(checkQuery, checkParams);
          if (existing[0].cnt > 0) {
            console.log(`${qy}Q${qq} 財報已存在，跳過`);
            continue;
          }
          count += await fetchAndSaveFinancialStatements(qy, qq, stock_id);
        }
        return { content: [{ type: 'text', text: `成功同步 ${count} 筆財報資料（${labels}）` }] };
      }
      return { content: [{ type: 'text', text: `成功同步 ${count} 筆財報資料` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `同步失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_dividends',
  '抓取股利除權息資料',
  {
    year: z.number().optional().describe('西元年,不填則抓取當年度'),
  },
  async ({ year }) => {
    try {
      let count;
      if (year) {
        count = await fetchAndSaveDividends(year);
      } else {
        count = await fetchRecentDividends();
      }
      return { content: [{ type: 'text', text: `成功同步 ${count} 筆股利資料` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `同步失敗: ${error.message}` }], isError: true };
    }
  }
);

// ============================================
// 啟動 MCP Server
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('台股分析 MCP Server v2.0 已啟動 (stdio 模式)');
}

main().catch((error) => {
  console.error('MCP Server 啟動失敗:', error);
  process.exit(1);
});
