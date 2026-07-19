const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { pool } = require('../database/connection');
const { fetchAllStockLists } = require('../crawler/fetchStockList');
const { fetchBatchDailyPrices, fetchMultiMonthPrices, fetchAllStocksLatestPrices, syncAllStocksHistory } = require('../crawler/fetchDailyPrices');
const { fetchAndSaveMonthlyRevenue, fetchRecentMonthlyRevenue } = require('../crawler/fetchMonthlyRevenue');
const { fetchAndSaveFinancialStatements, getLatestAvailableQuarters } = require('../crawler/fetchFinancialStatements');
const { analyzeRevenueTrend, calculateValuation, getFinancialSummary } = require('../analysis/fundamentalAnalysis');
const { getPriceFreshness, getRevenueFreshness, getFinancialFreshness } = require('../utils/dataFreshness');

const server = new McpServer({
  name: 'taiwan-stock-analysis',
  version: '3.0.0',
});

const LAYER_ENUM = ['設備', '原材料', '關鍵材料', '零組件製造', '模組整合', '終端產品'];
const MOAT_SOURCE_ENUM = ['地理稀缺性', '製程精度+BOM鎖定', '製程know-how稀缺性'];
const RELATIONSHIP_ENUM = ['規格驗證型', '架構共同開發型'];
const SUPPLIER_ENUM = ['多供應商', '單一綁定'];
const LAYER_ORDER_SQL = "FIELD(layer,'設備','原材料','關鍵材料','零組件製造','模組整合','終端產品')";

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
  '取得股票歷史股價資料（僅供參考價，框架不以此為結論依據）',
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
      const _meta = await getPriceFreshness(stock_id);
      return {
        content: [{ type: 'text', text: JSON.stringify({ _meta, count: rows.length, data: rows.reverse() }, null, 2) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_stock_latest',
  '取得股票最新參考股價（僅價格，不含技術指標——框架不使用技術面）',
  { stock_id: z.string().describe('股票代號,例如 2330') },
  async ({ stock_id }) => {
    try {
      const [rows] = await pool.query(
        `SELECT
          s.stock_id, s.stock_name, s.industry,
          dp.trade_date, dp.close_price, dp.open_price, dp.high_price, dp.low_price,
          dp.volume, dp.change_amount, dp.change_percent
        FROM stocks s
        LEFT JOIN daily_prices dp ON s.stock_id = dp.stock_id
        WHERE s.stock_id = ?
        ORDER BY dp.trade_date DESC
        LIMIT 1`,
        [stock_id]
      );

      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `找不到股票 ${stock_id} 的資料` }], isError: true };
      }
      const price_meta = await getPriceFreshness(stock_id);
      return { content: [{ type: 'text', text: JSON.stringify({ _meta: { price_meta }, ...rows[0] }, null, 2) }] };
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
  '查看指定股票的月營收資料與成長趨勢（框架的主要覆盤觸發點）',
  {
    stock_id: z.string().describe('股票代號'),
    months: z.number().optional().default(12).describe('查看月數,預設 12'),
  },
  async ({ stock_id, months }) => {
    try {
      const [result, _meta] = await Promise.all([
        analyzeRevenueTrend(stock_id, months),
        getRevenueFreshness(stock_id),
      ]);
      if (!result) {
        return { content: [{ type: 'text', text: JSON.stringify({ _meta, error: `找不到股票 ${stock_id} 的營收資料` }, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ _meta, ...result }, null, 2) }] };
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
      const [result, _meta] = await Promise.all([
        getFinancialSummary(stock_id),
        getFinancialFreshness(stock_id),
      ]);
      return { content: [{ type: 'text', text: JSON.stringify({ _meta, ...result }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_valuation',
  '查看指定股票的估值指標（本益比 PE、股價淨值比 PB，僅供參考）',
  { stock_id: z.string().describe('股票代號') },
  async ({ stock_id }) => {
    try {
      const [result, price_meta, financial_meta] = await Promise.all([
        calculateValuation(stock_id),
        getPriceFreshness(stock_id),
        getFinancialFreshness(stock_id),
      ]);
      if (!result) {
        return { content: [{ type: 'text', text: `找不到股票 ${stock_id} 的估值資料` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ _meta: { price_meta, financial_meta }, ...result }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

// ============================================
// 供應鏈研究框架 — 產業地圖 Tools
// 六層供應鏈骨架 / 護城河分類 / 三條因果線 / 主題中性矩陣 / 可證偽假設
// ============================================

server.tool(
  'list_industry_maps',
  '列出所有已建立的產業地圖',
  {},
  async () => {
    try {
      const [rows] = await pool.query('SELECT id, name, created_at, updated_at FROM industry_maps ORDER BY name');
      return { content: [{ type: 'text', text: JSON.stringify({ count: rows.length, data: rows }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

async function loadIndustryMap(identifier) {
  const [[map]] = /^\d+$/.test(identifier)
    ? await pool.query('SELECT * FROM industry_maps WHERE id = ?', [identifier])
    : await pool.query('SELECT * FROM industry_maps WHERE name = ?', [identifier]);
  if (!map) return null;

  const [layers] = await pool.query(`SELECT * FROM industry_map_layers WHERE industry_map_id = ? ORDER BY ${LAYER_ORDER_SQL}`, [map.id]);
  const [causalLines] = await pool.query('SELECT * FROM industry_map_causal_lines WHERE industry_map_id = ?', [map.id]);
  const [matrix] = await pool.query('SELECT * FROM industry_map_matrix_cells WHERE industry_map_id = ? ORDER BY id', [map.id]);
  const [hypotheses] = await pool.query('SELECT * FROM industry_map_hypotheses WHERE industry_map_id = ? ORDER BY sort_order, id', [map.id]);
  const [terms] = await pool.query('SELECT * FROM industry_map_terms WHERE industry_map_id = ? ORDER BY sort_order, id', [map.id]);
  const [companies] = await pool.query(
    `SELECT cp.stock_id, s.stock_name, cp.layer, cp.moat_source, cp.moat_level, cp.relationship_type, cp.v1_judgment
     FROM company_profiles cp JOIN stocks s ON cp.stock_id = s.stock_id
     WHERE cp.industry_map_id = ? ORDER BY cp.stock_id`, [map.id]
  );

  return { ...map, layers, causal_lines: causalLines, matrix, hypotheses, terms, companies };
}

server.tool(
  'get_industry_map',
  '取得單一產業地圖的完整內容（六層供應鏈、護城河、三條因果線、主題中性矩陣、可證偽假設、名詞解釋、覆蓋股票清單）',
  { name_or_id: z.string().describe('產業地圖名稱（例如「功率元件」）或數字 id') },
  async ({ name_or_id }) => {
    try {
      const data = await loadIndustryMap(name_or_id);
      if (!data) return { content: [{ type: 'text', text: `找不到產業地圖「${name_or_id}」` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'save_industry_map',
  '一次寫入完整產業地圖（六層供應鏈+護城河+三條因果線+主題中性矩陣+可證偽假設）。' +
  '依 name 尋找或建立產業地圖；layers/causal_lines/matrix/hypotheses 若有提供則整批覆寫（不是逐筆新增）。',
  {
    name: z.string().describe('產業地圖名稱，例如「功率元件」'),
    tech_background_notes: z.string().optional().describe('前置技術背景'),
    taiwan_participation_notes: z.string().optional().describe('台灣參與度總覽'),
    customer_relationship_notes: z.string().optional().describe('客戶關係類型學檢視'),
    open_gaps: z.string().optional().describe('待確認事項'),
    layers: z.array(z.object({
      layer: z.enum(LAYER_ENUM),
      players: z.string().optional(),
      scarcity_source: z.string().optional(),
      moat_level: z.string().optional(),
      key_structure: z.string().optional(),
    })).optional().describe('六層供應鏈地圖表格，整批覆寫'),
    causal_lines: z.array(z.object({
      line_type: z.enum(['supply', 'demand', 'inventory']),
      assessment: z.string().optional(),
      evidence: z.string().optional(),
    })).optional().describe('三條因果線分析，整批覆寫'),
    matrix: z.array(z.object({
      stock_id: z.string().optional(),
      product_line: z.string().optional(),
      application: z.string().optional(),
      note: z.string().optional(),
    })).optional().describe('主題中性矩陣（公司×產品×應用），整批覆寫'),
    hypotheses: z.array(z.object({
      hypothesis: z.string(),
      falsifying_observation: z.string().optional(),
      current_status: z.string().optional(),
    })).optional().describe('可證偽假設清單，整批覆寫'),
    terms: z.array(z.object({
      term: z.string(),
      definition: z.string().optional(),
    })).optional().describe('名詞解釋（避免後面表格出現名詞混用），整批覆寫'),
  },
  async ({ name, tech_background_notes, taiwan_participation_notes, customer_relationship_notes, open_gaps, layers, causal_lines, matrix, hypotheses, terms }) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[existing]] = await conn.query('SELECT * FROM industry_maps WHERE name = ?', [name]);
      let industryMapId;
      if (existing) {
        industryMapId = existing.id;
        // 只覆寫這次呼叫真的有帶的欄位；沒帶的欄位沿用既有值，避免局部更新把其他欄位清空
        const mTech = tech_background_notes !== undefined ? tech_background_notes : existing.tech_background_notes;
        const mTaiwan = taiwan_participation_notes !== undefined ? taiwan_participation_notes : existing.taiwan_participation_notes;
        const mCustomer = customer_relationship_notes !== undefined ? customer_relationship_notes : existing.customer_relationship_notes;
        const mGaps = open_gaps !== undefined ? open_gaps : existing.open_gaps;
        await conn.query(
          `UPDATE industry_maps SET tech_background_notes=?, taiwan_participation_notes=?,
           customer_relationship_notes=?, open_gaps=? WHERE id=?`,
          [mTech || null, mTaiwan || null, mCustomer || null, mGaps || null, industryMapId]
        );
      } else {
        const [r] = await conn.query(
          `INSERT INTO industry_maps (name, tech_background_notes, taiwan_participation_notes, customer_relationship_notes, open_gaps)
           VALUES (?,?,?,?,?)`,
          [name, tech_background_notes || null, taiwan_participation_notes || null, customer_relationship_notes || null, open_gaps || null]
        );
        industryMapId = r.insertId;
      }

      if (layers) {
        await conn.query('DELETE FROM industry_map_layers WHERE industry_map_id = ?', [industryMapId]);
        for (const [i, l] of layers.entries()) {
          await conn.query(
            `INSERT INTO industry_map_layers (industry_map_id, layer, players, scarcity_source, moat_level, key_structure, sort_order)
             VALUES (?,?,?,?,?,?,?)`,
            [industryMapId, l.layer, l.players || null, l.scarcity_source || null, l.moat_level || null, l.key_structure || null, i]
          );
        }
      }

      if (causal_lines) {
        await conn.query('DELETE FROM industry_map_causal_lines WHERE industry_map_id = ?', [industryMapId]);
        for (const c of causal_lines) {
          await conn.query(
            `INSERT INTO industry_map_causal_lines (industry_map_id, line_type, assessment, evidence) VALUES (?,?,?,?)`,
            [industryMapId, c.line_type, c.assessment || null, c.evidence || null]
          );
        }
      }

      if (matrix) {
        await conn.query('DELETE FROM industry_map_matrix_cells WHERE industry_map_id = ?', [industryMapId]);
        for (const c of matrix) {
          await conn.query(
            `INSERT INTO industry_map_matrix_cells (industry_map_id, stock_id, product_line, application, note)
             VALUES (?,?,?,?,?)`,
            [industryMapId, c.stock_id || null, c.product_line || null, c.application || null, c.note || null]
          );
        }
      }

      if (hypotheses) {
        await conn.query('DELETE FROM industry_map_hypotheses WHERE industry_map_id = ?', [industryMapId]);
        for (const [i, h] of hypotheses.entries()) {
          await conn.query(
            `INSERT INTO industry_map_hypotheses (industry_map_id, hypothesis, falsifying_observation, current_status, sort_order)
             VALUES (?,?,?,?,?)`,
            [industryMapId, h.hypothesis, h.falsifying_observation || null, h.current_status || null, i]
          );
        }
      }

      if (terms) {
        await conn.query('DELETE FROM industry_map_terms WHERE industry_map_id = ?', [industryMapId]);
        for (const [i, t] of terms.entries()) {
          await conn.query(
            `INSERT INTO industry_map_terms (industry_map_id, term, definition, sort_order) VALUES (?,?,?,?)`,
            [industryMapId, t.term, t.definition || null, i]
          );
        }
      }

      await conn.commit();
      return { content: [{ type: 'text', text: `已儲存產業地圖「${name}」(id=${industryMapId})` }] };
    } catch (error) {
      await conn.rollback();
      return { content: [{ type: 'text', text: `儲存失敗: ${error.message}` }], isError: true };
    } finally {
      conn.release();
    }
  }
);

// ============================================
// 供應鏈研究框架 — 個股層級 Tools
// 護城河分類 / 客戶關係類型學 / 三條因果線 / 可證偽假設
// company_profiles.is_coverage_active 同時決定 FinMind 財報/月營收爬蟲的抓取範圍
// ============================================

server.tool(
  'get_company_profile',
  '取得個股的框架分類（護城河、客戶關係型態、三條因果線、可證偽假設、驗證清單、事件日誌）',
  { stock_id: z.string().describe('股票代號') },
  async ({ stock_id }) => {
    try {
      const [[profile]] = await pool.query(
        `SELECT cp.*, im.name AS industry_name FROM company_profiles cp
         LEFT JOIN industry_maps im ON cp.industry_map_id = im.id
         WHERE cp.stock_id = ?`,
        [stock_id]
      );
      if (!profile) return { content: [{ type: 'text', text: `股票 ${stock_id} 尚未建立框架分類` }], isError: true };

      const [causalLines] = await pool.query('SELECT * FROM company_causal_lines WHERE stock_id = ?', [stock_id]);
      const [hypotheses] = await pool.query('SELECT * FROM company_hypotheses WHERE stock_id = ? ORDER BY sort_order, id', [stock_id]);
      const [events] = await pool.query('SELECT * FROM company_events WHERE stock_id = ? ORDER BY event_date DESC', [stock_id]);
      const [verification] = await pool.query('SELECT * FROM company_verification_items WHERE stock_id = ? ORDER BY sort_order, id', [stock_id]);

      return { content: [{ type: 'text', text: JSON.stringify({ ...profile, causal_lines: causalLines, hypotheses, events, verification_items: verification }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'save_company_profile',
  '寫入個股框架分類（護城河、客戶關係型態、v1投資判斷）。causal_lines/hypotheses 若提供則整批覆寫。' +
  '會將 is_coverage_active 預設為 true——加入這裡的股票之後 FinMind 財報/月營收爬蟲才會抓取。',
  {
    stock_id: z.string().describe('股票代號'),
    industry_map_name: z.string().optional().describe('所屬產業地圖名稱（需已用 save_industry_map 建立）'),
    layer: z.enum(LAYER_ENUM).optional(),
    moat_source: z.enum(MOAT_SOURCE_ENUM).optional(),
    moat_level: z.string().optional(),
    key_structure_status: z.string().optional(),
    relationship_type: z.enum(RELATIONSHIP_ENUM).optional(),
    supplier_multiplicity: z.enum(SUPPLIER_ENUM).optional(),
    integration_risk_notes: z.string().optional().describe('3-5年整合/替代風險'),
    v1_judgment: z.string().optional().describe('例如「Fully priced, watchlist not buy」'),
    v1_reasoning: z.string().optional(),
    business_notes: z.string().optional().describe('商業模式/競爭力補充'),
    open_gaps: z.string().optional().describe('待確認事項（個股層級，不要用樂觀假設填補）'),
    is_coverage_active: z.boolean().optional().describe('不填則沿用既有值；股票第一次建立時預設為 true'),
    causal_lines: z.array(z.object({
      line_type: z.enum(['supply', 'demand', 'inventory']),
      assessment: z.string().optional(),
      evidence: z.string().optional(),
    })).optional(),
    hypotheses: z.array(z.object({
      hypothesis: z.string(),
      falsifying_observation: z.string().optional(),
      current_status: z.string().optional(),
    })).optional(),
    verification_items: z.array(z.object({
      item: z.string().describe('例如「月營收趨勢是否符合假設方向」'),
      is_checked: z.boolean().optional().default(false),
    })).optional().describe('驗證清單：用什麼具體財務數字/事件追蹤假設有沒有成立，跟 hypotheses 是不同的東西'),
  },
  async ({ stock_id, industry_map_name, layer, moat_source, moat_level, key_structure_status,
    relationship_type, supplier_multiplicity, integration_risk_notes, v1_judgment, v1_reasoning,
    business_notes, open_gaps, is_coverage_active, causal_lines, hypotheses, verification_items }) => {
    const conn = await pool.getConnection();
    try {
      const [stockRows] = await conn.query('SELECT stock_id FROM stocks WHERE stock_id=?', [stock_id]);
      if (!stockRows.length) return { content: [{ type: 'text', text: `股票代號 ${stock_id} 不存在` }], isError: true };

      // 只覆寫這次呼叫真的有帶的欄位；沒帶的欄位沿用既有值，避免局部更新把其他欄位清空
      const [[existing]] = await conn.query('SELECT * FROM company_profiles WHERE stock_id=?', [stock_id]);

      let industryMapId = existing ? existing.industry_map_id : null;
      if (industry_map_name) {
        const [[im]] = await conn.query('SELECT id FROM industry_maps WHERE name=?', [industry_map_name]);
        if (!im) return { content: [{ type: 'text', text: `找不到產業地圖「${industry_map_name}」，請先用 save_industry_map 建立` }], isError: true };
        industryMapId = im.id;
      }

      const merged = {
        layer: layer !== undefined ? layer : existing?.layer ?? null,
        moat_source: moat_source !== undefined ? moat_source : existing?.moat_source ?? null,
        moat_level: moat_level !== undefined ? moat_level : existing?.moat_level ?? null,
        key_structure_status: key_structure_status !== undefined ? key_structure_status : existing?.key_structure_status ?? null,
        relationship_type: relationship_type !== undefined ? relationship_type : existing?.relationship_type ?? null,
        supplier_multiplicity: supplier_multiplicity !== undefined ? supplier_multiplicity : existing?.supplier_multiplicity ?? null,
        integration_risk_notes: integration_risk_notes !== undefined ? integration_risk_notes : existing?.integration_risk_notes ?? null,
        v1_judgment: v1_judgment !== undefined ? v1_judgment : existing?.v1_judgment ?? null,
        v1_reasoning: v1_reasoning !== undefined ? v1_reasoning : existing?.v1_reasoning ?? null,
        business_notes: business_notes !== undefined ? business_notes : existing?.business_notes ?? null,
        open_gaps: open_gaps !== undefined ? open_gaps : existing?.open_gaps ?? null,
        is_coverage_active: is_coverage_active !== undefined ? is_coverage_active : (existing ? !!existing.is_coverage_active : true),
      };

      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO company_profiles
         (stock_id, industry_map_id, layer, moat_source, moat_level, key_structure_status,
          relationship_type, supplier_multiplicity, integration_risk_notes,
          v1_judgment, v1_reasoning, business_notes, open_gaps, is_coverage_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
         industry_map_id=VALUES(industry_map_id), layer=VALUES(layer), moat_source=VALUES(moat_source),
         moat_level=VALUES(moat_level), key_structure_status=VALUES(key_structure_status),
         relationship_type=VALUES(relationship_type), supplier_multiplicity=VALUES(supplier_multiplicity),
         integration_risk_notes=VALUES(integration_risk_notes), v1_judgment=VALUES(v1_judgment),
         v1_reasoning=VALUES(v1_reasoning), business_notes=VALUES(business_notes), open_gaps=VALUES(open_gaps),
         is_coverage_active=VALUES(is_coverage_active)`,
        [stock_id, industryMapId, merged.layer, merged.moat_source, merged.moat_level,
         merged.key_structure_status, merged.relationship_type, merged.supplier_multiplicity,
         merged.integration_risk_notes, merged.v1_judgment, merged.v1_reasoning, merged.business_notes,
         merged.open_gaps, merged.is_coverage_active]
      );

      if (causal_lines) {
        await conn.query('DELETE FROM company_causal_lines WHERE stock_id = ?', [stock_id]);
        for (const c of causal_lines) {
          await conn.query(
            `INSERT INTO company_causal_lines (stock_id, line_type, assessment, evidence) VALUES (?,?,?,?)`,
            [stock_id, c.line_type, c.assessment || null, c.evidence || null]
          );
        }
      }

      if (hypotheses) {
        await conn.query('DELETE FROM company_hypotheses WHERE stock_id = ?', [stock_id]);
        for (const [i, h] of hypotheses.entries()) {
          await conn.query(
            `INSERT INTO company_hypotheses (stock_id, hypothesis, falsifying_observation, current_status, sort_order)
             VALUES (?,?,?,?,?)`,
            [stock_id, h.hypothesis, h.falsifying_observation || null, h.current_status || null, i]
          );
        }
      }

      if (verification_items) {
        await conn.query('DELETE FROM company_verification_items WHERE stock_id = ?', [stock_id]);
        for (const [i, it] of verification_items.entries()) {
          await conn.query(
            `INSERT INTO company_verification_items (stock_id, item, is_checked, sort_order) VALUES (?,?,?,?)`,
            [stock_id, it.item, !!it.is_checked, i]
          );
        }
      }

      await conn.commit();
      return { content: [{ type: 'text', text: `已儲存 ${stock_id} 的框架分類` }] };
    } catch (error) {
      await conn.rollback();
      return { content: [{ type: 'text', text: `儲存失敗: ${error.message}` }], isError: true };
    } finally {
      conn.release();
    }
  }
);

server.tool(
  'list_coverage',
  '列出目前的框架覆蓋清單（is_coverage_active=1），也是 FinMind 財報/月營收爬蟲的抓取範圍',
  {},
  async () => {
    try {
      const [rows] = await pool.query(
        `SELECT cp.stock_id, s.stock_name, cp.layer, cp.moat_source, cp.moat_level, cp.v1_judgment, im.name AS industry_name
         FROM company_profiles cp
         JOIN stocks s ON cp.stock_id = s.stock_id
         LEFT JOIN industry_maps im ON cp.industry_map_id = im.id
         WHERE cp.is_coverage_active = 1
         ORDER BY im.name, cp.stock_id`
      );
      return { content: [{ type: 'text', text: JSON.stringify({ count: rows.length, data: rows }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'add_coverage_stock',
  '把股票加入框架覆蓋清單（is_coverage_active=1）。若該股票尚無 company_profiles 資料會建立最基本的一筆。之後 FinMind 財報/月營收爬蟲會抓取這檔股票。',
  { stock_id: z.string().describe('股票代號') },
  async ({ stock_id }) => {
    try {
      const [stockRows] = await pool.query('SELECT stock_id FROM stocks WHERE stock_id=?', [stock_id]);
      if (!stockRows.length) return { content: [{ type: 'text', text: `股票代號 ${stock_id} 不存在` }], isError: true };

      await pool.query(
        `INSERT INTO company_profiles (stock_id, is_coverage_active) VALUES (?, TRUE)
         ON DUPLICATE KEY UPDATE is_coverage_active = TRUE`,
        [stock_id]
      );
      return { content: [{ type: 'text', text: `已將 ${stock_id} 加入框架覆蓋清單` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `錯誤: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'remove_coverage_stock',
  '把股票從框架覆蓋清單移除（is_coverage_active=0），停止 FinMind 財報/月營收爬蟲抓取，但保留既有的框架分類資料',
  { stock_id: z.string().describe('股票代號') },
  async ({ stock_id }) => {
    try {
      const [r] = await pool.query('UPDATE company_profiles SET is_coverage_active = FALSE WHERE stock_id = ?', [stock_id]);
      if (r.affectedRows === 0) return { content: [{ type: 'text', text: `股票 ${stock_id} 尚無框架分類資料` }], isError: true };
      return { content: [{ type: 'text', text: `已將 ${stock_id} 移出框架覆蓋清單` }] };
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
  '從台灣證交所 (TWSE) 同步最新的上市＋上櫃股票清單到資料庫',
  {},
  async () => {
    try {
      const stocks = await fetchAllStockLists();
      return { content: [{ type: 'text', text: `成功同步 ${stocks.length} 檔股票清單（上市＋上櫃）` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `同步失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_daily_prices',
  '從 TWSE 抓取最新每日股價資料並存入資料庫（僅供參考價）',
  {
    stock_id: z.string().optional().describe('指定股票代號,不填則抓取全市場最新股價'),
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
        const result = await fetchAllStocksLatestPrices();
        return { content: [{ type: 'text', text: `成功抓取全市場 ${result.count} 檔股票最新股價（交易日: ${result.tradeDate}）` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `抓取失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_history',
  '智慧補抓全市場歷史股價（僅供參考價）：當月永遠更新，舊月份只補缺漏，不重複抓取已有資料',
  {
    months: z.number().min(1).max(12).optional().describe('往回幾個月，預設 6'),
  },
  async ({ months = 6 }) => {
    try {
      let lastLog = '';
      const result = await syncAllStocksHistory(months, (done, total, stockId) => {
        if (done % 50 === 0 || done === total) {
          lastLog = `進度 ${done}/${total}（最後: ${stockId}）`;
          console.error(lastLog);
        }
      });
      return { content: [{ type: 'text', text: `補抓完成！共處理 ${result.stocks} 檔股票，寫入 ${result.records} 筆資料` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `補抓失敗: ${error.message}` }], isError: true };
    }
  }
);

server.tool(
  'sync_monthly_revenue',
  '抓取月營收資料。不指定 stock_id 且不指定年月時，只抓框架覆蓋清單（company_profiles.is_coverage_active=1）',
  {
    year: z.number().optional().describe('西元年,不填則抓取最近月份'),
    month: z.number().optional().describe('月份 1-12'),
    stock_id: z.string().optional().describe('指定股票代號,不填則抓取覆蓋清單'),
  },
  async ({ year, month, stock_id }) => {
    try {
      let count;
      if (year && month) {
        // 指定年月：直接呼叫 fetchAndSaveMonthlyRevenue（含增率計算）
        count = await fetchAndSaveMonthlyRevenue(year, month, stock_id);
      } else {
        // 不指定年月：自動偵測缺口並循序補抓
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
  '抓取季度財報資料（損益表、財務比率）。不指定 stock_id 且不指定年季時，只抓框架覆蓋清單（company_profiles.is_coverage_active=1）',
  {
    year: z.number().optional().describe('西元年,不填則抓取最近季度'),
    quarter: z.number().optional().describe('季度 1-4'),
    stock_id: z.string().optional().describe('指定股票代號,不填則抓取覆蓋清單'),
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

// ============================================
// 啟動 MCP Server
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('台股供應鏈研究系統 MCP Server v3.0 已啟動 (stdio 模式)');
}

main().catch((error) => {
  console.error('MCP Server 啟動失敗:', error);
  process.exit(1);
});
