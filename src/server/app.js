const express = require('express');
const { pool } = require('../database/connection');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

// ── Sectors snapshot ──────────────────────────────────────────────
const SECTORS_FILE = path.join(__dirname, '../../data/sectors.json');

async function saveSectorsSnapshot() {
  const [groups]   = await pool.query('SELECT * FROM sector_groups ORDER BY sort_order, id');
  const [subs]     = await pool.query('SELECT * FROM sector_subgroups ORDER BY sort_order, id');
  const [sections] = await pool.query('SELECT * FROM sector_stock_sections ORDER BY sort_order, id');
  const [stocks]   = await pool.query('SELECT * FROM sector_stocks ORDER BY sort_order, stock_id');

  const data = groups.map(g => ({
    name: g.name,
    sort_order: g.sort_order,
    subgroups: subs.filter(s => s.group_id === g.id).map(s => ({
      name: s.name,
      description: s.description,
      sort_order: s.sort_order,
      sections: sections.filter(sec => sec.subgroup_id === s.id).map(sec => ({
        name: sec.name,
        sort_order: sec.sort_order,
      })),
      stocks: stocks.filter(st => st.subgroup_id === s.id).map(st => {
        const sec = sections.find(sec => sec.id === st.section_id);
        return { stock_id: st.stock_id, section_name: sec ? sec.name : null, sort_order: st.sort_order };
      }),
    })),
  }));

  await fs.mkdir(path.dirname(SECTORS_FILE), { recursive: true });
  await fs.writeFile(SECTORS_FILE, JSON.stringify({ exported_at: new Date().toISOString(), groups: data }, null, 2));
}

async function autoImportSectorsIfEmpty() {
  // sectors.json 是唯一真相來源，存在就全量同步進 DB
  let raw;
  try { raw = await fs.readFile(SECTORS_FILE, 'utf8'); }
  catch (e) { return; } // 檔案不存在，不動 DB

  try {
    const { groups } = JSON.parse(raw);
    if (!groups || !groups.length) return;

    // 清空舊資料（FK cascade 會連帶刪 subgroups/stocks/sections）
    await pool.query('DELETE FROM sector_groups');

    for (const g of groups) {
      const [gr] = await pool.query(
        'INSERT INTO sector_groups (name, sort_order) VALUES (?,?)', [g.name, g.sort_order ?? 0]
      );
      const groupId = gr.insertId;

      for (const s of (g.subgroups || [])) {
        const [sr] = await pool.query(
          'INSERT INTO sector_subgroups (group_id, name, description, sort_order) VALUES (?,?,?,?)',
          [groupId, s.name, s.description || '', s.sort_order ?? 0]
        );
        const subId = sr.insertId;
        const sectionMap = {};

        for (const sec of (s.sections || [])) {
          const [secr] = await pool.query(
            'INSERT INTO sector_stock_sections (subgroup_id, name, sort_order) VALUES (?,?,?)',
            [subId, sec.name, sec.sort_order ?? 0]
          );
          sectionMap[sec.name] = secr.insertId;
        }

        for (const st of (s.stocks || [])) {
          const secId = st.section_name ? (sectionMap[st.section_name] ?? null) : null;
          await pool.query(
            'INSERT IGNORE INTO sector_stocks (subgroup_id, stock_id, section_id, sort_order) VALUES (?,?,?,?)',
            [subId, st.stock_id, secId, st.sort_order ?? 0]
          );
        }
      }
    }
    console.log(`[Sectors] 從 sectors.json 同步完成`);
  } catch (e) {
    console.error('[Sectors] 同步失敗:', e.message);
  }
}

// ── 供應鏈框架快照（跟 sectors.json 同一套模式，讓框架研究內容可以透過 git 帶到別台電腦）──────
// 股價/月營收/財報這些原始市場資料不放進來，太大也沒必要，到新電腦重跑一次同步就有了
const FRAMEWORK_FILE = path.join(__dirname, '../../data/framework.json');

async function saveFrameworkSnapshot() {
  const [industries]  = await pool.query('SELECT * FROM industry_maps ORDER BY name');
  const [layers]       = await pool.query(`SELECT * FROM industry_map_layers ORDER BY ${LAYER_ORDER}`);
  const [causalLines]  = await pool.query('SELECT * FROM industry_map_causal_lines');
  const [matrix]        = await pool.query('SELECT * FROM industry_map_matrix_cells ORDER BY id');
  const [hyps]           = await pool.query('SELECT * FROM industry_map_hypotheses ORDER BY sort_order, id');
  const [terms]           = await pool.query('SELECT * FROM industry_map_terms ORDER BY sort_order, id');

  const [companies]        = await pool.query(
    `SELECT cp.*, im.name AS industry_name FROM company_profiles cp
     LEFT JOIN industry_maps im ON cp.industry_map_id = im.id ORDER BY cp.stock_id`
  );
  const [compCausal]        = await pool.query('SELECT * FROM company_causal_lines');
  const [compHyps]           = await pool.query('SELECT * FROM company_hypotheses ORDER BY sort_order, id');
  const [compEvents]          = await pool.query('SELECT * FROM company_events ORDER BY event_date DESC');
  const [compVerif]            = await pool.query('SELECT * FROM company_verification_items ORDER BY sort_order, id');

  const data = {
    exported_at: new Date().toISOString(),
    industries: industries.map(im => ({
      name: im.name,
      tech_background_notes: im.tech_background_notes,
      taiwan_participation_notes: im.taiwan_participation_notes,
      customer_relationship_notes: im.customer_relationship_notes,
      open_gaps: im.open_gaps,
      layers: layers.filter(l => l.industry_map_id === im.id)
        .map(({ layer, players, scarcity_source, moat_level, key_structure, sort_order }) => ({ layer, players, scarcity_source, moat_level, key_structure, sort_order })),
      causal_lines: causalLines.filter(c => c.industry_map_id === im.id)
        .map(({ line_type, assessment, evidence }) => ({ line_type, assessment, evidence })),
      matrix: matrix.filter(m => m.industry_map_id === im.id)
        .map(({ stock_id, product_line, application, note }) => ({ stock_id, product_line, application, note })),
      hypotheses: hyps.filter(h => h.industry_map_id === im.id)
        .map(({ hypothesis, falsifying_observation, current_status, sort_order }) => ({ hypothesis, falsifying_observation, current_status, sort_order })),
      terms: terms.filter(t => t.industry_map_id === im.id)
        .map(({ term, definition, sort_order }) => ({ term, definition, sort_order })),
    })),
    companies: companies.map(cp => ({
      stock_id: cp.stock_id,
      industry_name: cp.industry_name,
      layer: cp.layer, moat_source: cp.moat_source, moat_level: cp.moat_level,
      key_structure_status: cp.key_structure_status, relationship_type: cp.relationship_type,
      supplier_multiplicity: cp.supplier_multiplicity, integration_risk_notes: cp.integration_risk_notes,
      v1_judgment: cp.v1_judgment, v1_reasoning: cp.v1_reasoning, business_notes: cp.business_notes,
      open_gaps: cp.open_gaps, is_coverage_active: !!cp.is_coverage_active,
      causal_lines: compCausal.filter(c => c.stock_id === cp.stock_id)
        .map(({ line_type, assessment, evidence }) => ({ line_type, assessment, evidence })),
      hypotheses: compHyps.filter(h => h.stock_id === cp.stock_id)
        .map(({ hypothesis, falsifying_observation, current_status, sort_order }) => ({ hypothesis, falsifying_observation, current_status, sort_order })),
      events: compEvents.filter(e => e.stock_id === cp.stock_id)
        .map(({ event_date, event_desc, affected_hypothesis, impact_on_judgment }) => ({ event_date, event_desc, affected_hypothesis, impact_on_judgment })),
      verification_items: compVerif.filter(v => v.stock_id === cp.stock_id)
        .map(({ item, is_checked, sort_order }) => ({ item: item, is_checked: !!is_checked, sort_order })),
    })),
  };

  await fs.mkdir(path.dirname(FRAMEWORK_FILE), { recursive: true });
  await fs.writeFile(FRAMEWORK_FILE, JSON.stringify(data, null, 2));
}

async function autoImportFrameworkIfEmpty() {
  // framework.json 是唯一真相來源，存在就全量同步進 DB（跟 sectors 同一套邏輯：
  // 如果在別台電腦有還沒 commit 的本機修改，重啟伺服器會被 git 版本蓋掉，這是刻意的權衡）
  let raw;
  try { raw = await fs.readFile(FRAMEWORK_FILE, 'utf8'); }
  catch (e) { return; }

  try {
    const { industries, companies } = JSON.parse(raw);
    if (!industries && !companies) return;

    await pool.query('DELETE FROM industry_maps');   // cascade 連帶刪 layers/causal_lines/matrix/hypotheses/terms
    await pool.query('DELETE FROM company_profiles'); // cascade 連帶刪 causal_lines/hypotheses/events/verification_items

    const nameToId = {};
    for (const ind of (industries || [])) {
      const [r] = await pool.query(
        `INSERT INTO industry_maps (name, tech_background_notes, taiwan_participation_notes, customer_relationship_notes, open_gaps)
         VALUES (?,?,?,?,?)`,
        [ind.name, ind.tech_background_notes || null, ind.taiwan_participation_notes || null, ind.customer_relationship_notes || null, ind.open_gaps || null]
      );
      const id = r.insertId;
      nameToId[ind.name] = id;

      for (const l of (ind.layers || [])) {
        await pool.query(
          `INSERT INTO industry_map_layers (industry_map_id, layer, players, scarcity_source, moat_level, key_structure, sort_order) VALUES (?,?,?,?,?,?,?)`,
          [id, l.layer, l.players || null, l.scarcity_source || null, l.moat_level || null, l.key_structure || null, l.sort_order || 0]
        );
      }
      for (const c of (ind.causal_lines || [])) {
        await pool.query(
          `INSERT INTO industry_map_causal_lines (industry_map_id, line_type, assessment, evidence) VALUES (?,?,?,?)`,
          [id, c.line_type, c.assessment || null, c.evidence || null]
        );
      }
      for (const m of (ind.matrix || [])) {
        await pool.query(
          `INSERT INTO industry_map_matrix_cells (industry_map_id, stock_id, product_line, application, note) VALUES (?,?,?,?,?)`,
          [id, m.stock_id || null, m.product_line || null, m.application || null, m.note || null]
        );
      }
      for (const h of (ind.hypotheses || [])) {
        await pool.query(
          `INSERT INTO industry_map_hypotheses (industry_map_id, hypothesis, falsifying_observation, current_status, sort_order) VALUES (?,?,?,?,?)`,
          [id, h.hypothesis, h.falsifying_observation || null, h.current_status || null, h.sort_order || 0]
        );
      }
      for (const t of (ind.terms || [])) {
        await pool.query(
          `INSERT INTO industry_map_terms (industry_map_id, term, definition, sort_order) VALUES (?,?,?,?)`,
          [id, t.term, t.definition || null, t.sort_order || 0]
        );
      }
    }

    for (const c of (companies || [])) {
      const [stockExists] = await pool.query('SELECT stock_id FROM stocks WHERE stock_id=?', [c.stock_id]);
      if (!stockExists.length) continue; // 股票清單還沒同步過，這檔先略過，下次重新匯入時會補上

      const industryMapId = c.industry_name ? (nameToId[c.industry_name] ?? null) : null;
      await pool.query(
        `INSERT INTO company_profiles
         (stock_id, industry_map_id, layer, moat_source, moat_level, key_structure_status,
          relationship_type, supplier_multiplicity, integration_risk_notes,
          v1_judgment, v1_reasoning, business_notes, open_gaps, is_coverage_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [c.stock_id, industryMapId, c.layer || null, c.moat_source || null, c.moat_level || null,
         c.key_structure_status || null, c.relationship_type || null, c.supplier_multiplicity || null,
         c.integration_risk_notes || null, c.v1_judgment || null, c.v1_reasoning || null, c.business_notes || null,
         c.open_gaps || null, !!c.is_coverage_active]
      );
      for (const cl of (c.causal_lines || [])) {
        await pool.query(
          `INSERT INTO company_causal_lines (stock_id, line_type, assessment, evidence) VALUES (?,?,?,?)`,
          [c.stock_id, cl.line_type, cl.assessment || null, cl.evidence || null]
        );
      }
      for (const h of (c.hypotheses || [])) {
        await pool.query(
          `INSERT INTO company_hypotheses (stock_id, hypothesis, falsifying_observation, current_status, sort_order) VALUES (?,?,?,?,?)`,
          [c.stock_id, h.hypothesis, h.falsifying_observation || null, h.current_status || null, h.sort_order || 0]
        );
      }
      for (const e of (c.events || [])) {
        await pool.query(
          `INSERT INTO company_events (stock_id, event_date, event_desc, affected_hypothesis, impact_on_judgment) VALUES (?,?,?,?,?)`,
          [c.stock_id, e.event_date, e.event_desc, e.affected_hypothesis || null, e.impact_on_judgment || null]
        );
      }
      for (const v of (c.verification_items || [])) {
        await pool.query(
          `INSERT INTO company_verification_items (stock_id, item, is_checked, sort_order) VALUES (?,?,?,?)`,
          [c.stock_id, v.item, !!v.is_checked, v.sort_order || 0]
        );
      }
    }
    console.log('[Framework] 從 framework.json 同步完成');
  } catch (e) {
    console.error('[Framework] 同步失敗:', e.message);
  }
}

const { analyzeRevenueTrend, calculateValuation, getFinancialSummary } = require('../analysis/fundamentalAnalysis');
const { getPriceFreshness, getRevenueFreshness, getFinancialFreshness } = require('../utils/dataFreshness');
const { runDailySync } = require('../crawler/dailySync');
const { getNextQuarterDeadline } = require('../crawler/fetchFinancialStatements');
const { getNextRevenueDeadline } = require('../crawler/fetchMonthlyRevenue');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// dateStrings:true 讓 mysql2 回傳字串，直接取前 10 碼即為 YYYY-MM-DD
const toDateStr = d => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 框架相關寫入後自動儲存 snapshot（跟 sectors 同一套模式）
// /api/stocks 底下只有框架相關的子路由(profile/causal-lines/hypotheses/events/verification)會用到 POST/PUT/DELETE，
// 基本查詢路由都是 GET，不會被下面這段影響
function frameworkSnapshotMiddleware(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const orig = res.json.bind(res);
    res.json = (data) => {
      orig(data);
      if (data && data.success) saveFrameworkSnapshot().catch(e => console.error('[Framework] snapshot 失敗:', e.message));
    };
  }
  next();
}
app.use('/api/industries', frameworkSnapshotMiddleware);
app.use('/api/stocks', frameworkSnapshotMiddleware);

// ============================================
// 股票基本 API
// ============================================

app.get('/api/stocks', async (req, res) => {
  try {
    const { keyword } = req.query;
    let query = 'SELECT stock_id, stock_name, industry, market_type FROM stocks WHERE is_active = TRUE';
    const params = [];

    if (keyword) {
      query += ' AND (stock_id LIKE ? OR stock_name LIKE ?)';
      const like = `%${keyword}%`;
      params.push(like, like);
    }

    query += ' ORDER BY stock_id LIMIT 100';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    const [rows] = await pool.query('SELECT * FROM stocks WHERE stock_id = ?', [stockId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '股票不存在' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/prices', async (req, res) => {
  try {
    const { stockId } = req.params;
    const { limit = 30 } = req.query;
    const [rows] = await pool.query(
      `SELECT * FROM daily_prices WHERE stock_id = ? ORDER BY trade_date DESC LIMIT ?`,
      [stockId, parseInt(limit)]
    );
    res.json({ success: true, data: rows.reverse() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 最新參考價（僅價格，不含技術指標——框架不使用技術面）
app.get('/api/stocks/:stockId/latest', async (req, res) => {
  try {
    const { stockId } = req.params;
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
      [stockId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '無資料' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 基本面 API
// ============================================

app.get('/api/stocks/:stockId/revenue', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;
    const result = await analyzeRevenueTrend(req.params.stockId, months);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/financial', async (req, res) => {
  try {
    const result = await getFinancialSummary(req.params.stockId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stocks/:stockId/valuation', async (req, res) => {
  try {
    const result = await calculateValuation(req.params.stockId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 供應鏈研究框架 — 產業地圖 API
// 六層供應鏈骨架 / 護城河分類 / 三條因果線 / 主題中性矩陣 / 可證偽假設
// ============================================

const LAYER_ORDER = "FIELD(layer,'設備','原材料','關鍵材料','零組件製造','模組整合','終端產品')";

app.get('/api/industries', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, created_at, updated_at FROM industry_maps ORDER BY name');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/industries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [[map]] = await pool.query('SELECT * FROM industry_maps WHERE id = ?', [id]);
    if (!map) return res.status(404).json({ success: false, error: '產業地圖不存在' });

    const [layers] = await pool.query(
      `SELECT * FROM industry_map_layers WHERE industry_map_id = ? ORDER BY ${LAYER_ORDER}`, [id]
    );
    const [causalLines] = await pool.query(
      'SELECT * FROM industry_map_causal_lines WHERE industry_map_id = ?', [id]
    );
    const [matrix] = await pool.query(
      'SELECT * FROM industry_map_matrix_cells WHERE industry_map_id = ? ORDER BY id', [id]
    );
    const [hypotheses] = await pool.query(
      'SELECT * FROM industry_map_hypotheses WHERE industry_map_id = ? ORDER BY sort_order, id', [id]
    );
    const [terms] = await pool.query(
      'SELECT * FROM industry_map_terms WHERE industry_map_id = ? ORDER BY sort_order, id', [id]
    );
    const [companies] = await pool.query(
      `SELECT cp.stock_id, s.stock_name, cp.layer, cp.moat_source, cp.moat_level, cp.relationship_type,
              cp.v1_judgment, cp.is_coverage_active
       FROM company_profiles cp JOIN stocks s ON cp.stock_id = s.stock_id
       WHERE cp.industry_map_id = ? ORDER BY cp.stock_id`, [id]
    );

    res.json({ success: true, data: { ...map, layers, causal_lines: causalLines, matrix, hypotheses, terms, companies } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/industries', async (req, res) => {
  try {
    const { name, tech_background_notes, taiwan_participation_notes, customer_relationship_notes, open_gaps } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const [r] = await pool.query(
      `INSERT INTO industry_maps (name, tech_background_notes, taiwan_participation_notes, customer_relationship_notes, open_gaps)
       VALUES (?,?,?,?,?)`,
      [name, tech_background_notes || null, taiwan_participation_notes || null, customer_relationship_notes || null, open_gaps || null]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/industries/:id', async (req, res) => {
  try {
    // 只覆寫這次請求裡真的有帶的欄位；沒帶的欄位沿用既有值，避免局部更新把其他欄位清空
    const [[existing]] = await pool.query('SELECT * FROM industry_maps WHERE id=?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: '產業地圖不存在' });
    const pick = (field) => req.body[field] !== undefined ? req.body[field] : existing[field];

    const name = pick('name');
    const tech_background_notes = pick('tech_background_notes');
    const taiwan_participation_notes = pick('taiwan_participation_notes');
    const customer_relationship_notes = pick('customer_relationship_notes');
    const open_gaps = pick('open_gaps');

    await pool.query(
      `UPDATE industry_maps SET name=?, tech_background_notes=?, taiwan_participation_notes=?,
       customer_relationship_notes=?, open_gaps=? WHERE id=?`,
      [name, tech_background_notes || null, taiwan_participation_notes || null, customer_relationship_notes || null, open_gaps || null, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/industries/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM industry_maps WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 六層供應鏈地圖：整批覆寫
app.put('/api/industries/:id/layers', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { layers = [] } = req.body;
    await conn.beginTransaction();
    await conn.query('DELETE FROM industry_map_layers WHERE industry_map_id = ?', [req.params.id]);
    for (const l of layers) {
      await conn.query(
        `INSERT INTO industry_map_layers (industry_map_id, layer, players, scarcity_source, moat_level, key_structure, sort_order)
         VALUES (?,?,?,?,?,?,?)`,
        [req.params.id, l.layer, l.players || null, l.scarcity_source || null, l.moat_level || null, l.key_structure || null, l.sort_order || 0]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, error: e.message });
  } finally { conn.release(); }
});

// 三條因果線（產業層級）：整批覆寫
app.put('/api/industries/:id/causal-lines', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { causal_lines = [] } = req.body;
    await conn.beginTransaction();
    await conn.query('DELETE FROM industry_map_causal_lines WHERE industry_map_id = ?', [req.params.id]);
    for (const c of causal_lines) {
      await conn.query(
        `INSERT INTO industry_map_causal_lines (industry_map_id, line_type, assessment, evidence) VALUES (?,?,?,?)`,
        [req.params.id, c.line_type, c.assessment || null, c.evidence || null]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, error: e.message });
  } finally { conn.release(); }
});

// 主題中性矩陣（公司 × 產品 × 應用）：整批覆寫
app.put('/api/industries/:id/matrix', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { cells = [] } = req.body;
    await conn.beginTransaction();
    await conn.query('DELETE FROM industry_map_matrix_cells WHERE industry_map_id = ?', [req.params.id]);
    for (const c of cells) {
      await conn.query(
        `INSERT INTO industry_map_matrix_cells (industry_map_id, stock_id, product_line, application, note)
         VALUES (?,?,?,?,?)`,
        [req.params.id, c.stock_id || null, c.product_line || null, c.application || null, c.note || null]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, error: e.message });
  } finally { conn.release(); }
});

// 可證偽假設（產業層級）：逐筆 CRUD，因為狀態會隨時間個別更新
app.post('/api/industries/:id/hypotheses', async (req, res) => {
  try {
    const { hypothesis, falsifying_observation, current_status, sort_order } = req.body;
    if (!hypothesis) return res.status(400).json({ success: false, error: 'hypothesis required' });
    const [r] = await pool.query(
      `INSERT INTO industry_map_hypotheses (industry_map_id, hypothesis, falsifying_observation, current_status, sort_order)
       VALUES (?,?,?,?,?)`,
      [req.params.id, hypothesis, falsifying_observation || null, current_status || null, sort_order || 0]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/industries/:id/hypotheses/:hid', async (req, res) => {
  try {
    const { hypothesis, falsifying_observation, current_status, sort_order } = req.body;
    await pool.query(
      `UPDATE industry_map_hypotheses SET hypothesis=?, falsifying_observation=?, current_status=?, sort_order=?
       WHERE id=? AND industry_map_id=?`,
      [hypothesis, falsifying_observation || null, current_status || null, sort_order || 0, req.params.hid, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/industries/:id/hypotheses/:hid', async (req, res) => {
  try {
    await pool.query('DELETE FROM industry_map_hypotheses WHERE id=? AND industry_map_id=?', [req.params.hid, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 名詞解釋：整批覆寫
app.put('/api/industries/:id/terms', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { terms = [] } = req.body;
    await conn.beginTransaction();
    await conn.query('DELETE FROM industry_map_terms WHERE industry_map_id = ?', [req.params.id]);
    for (const [i, t] of terms.entries()) {
      await conn.query(
        `INSERT INTO industry_map_terms (industry_map_id, term, definition, sort_order) VALUES (?,?,?,?)`,
        [req.params.id, t.term, t.definition || null, i]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, error: e.message });
  } finally { conn.release(); }
});

// ============================================
// 供應鏈研究框架 — 個股層級 API
// 護城河分類 / 客戶關係類型學 / 三條因果線 / 可證偽假設 / 事件日誌
// company_profiles.is_coverage_active 同時決定 FinMind 財報/月營收爬蟲的抓取範圍
// ============================================

app.get('/api/stocks/:stockId/profile', async (req, res) => {
  try {
    const [[profile]] = await pool.query(
      `SELECT cp.*, im.name AS industry_name FROM company_profiles cp
       LEFT JOIN industry_maps im ON cp.industry_map_id = im.id
       WHERE cp.stock_id = ?`,
      [req.params.stockId]
    );
    if (!profile) return res.status(404).json({ success: false, error: '尚未建立框架分類' });

    const [causalLines] = await pool.query('SELECT * FROM company_causal_lines WHERE stock_id = ?', [req.params.stockId]);
    const [hypotheses] = await pool.query('SELECT * FROM company_hypotheses WHERE stock_id = ? ORDER BY sort_order, id', [req.params.stockId]);
    const [events] = await pool.query('SELECT * FROM company_events WHERE stock_id = ? ORDER BY event_date DESC', [req.params.stockId]);
    const [verification] = await pool.query('SELECT * FROM company_verification_items WHERE stock_id = ? ORDER BY sort_order, id', [req.params.stockId]);

    res.json({ success: true, data: { ...profile, causal_lines: causalLines, hypotheses, events, verification_items: verification } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/stocks/:stockId/profile', async (req, res) => {
  try {
    const { stockId } = req.params;
    const [stockRows] = await pool.query('SELECT stock_id FROM stocks WHERE stock_id=?', [stockId]);
    if (!stockRows.length) return res.status(404).json({ success: false, error: '股票代號不存在' });

    // 只覆寫這次請求裡真的有帶的欄位；沒帶的欄位沿用既有值，避免局部更新把其他欄位清空
    const [[existing]] = await pool.query('SELECT * FROM company_profiles WHERE stock_id=?', [stockId]);
    const pick = (field, fallback) => req.body[field] !== undefined ? req.body[field] : (existing ? existing[field] : fallback);

    const industry_map_id = pick('industry_map_id', null);
    const layer = pick('layer', null);
    const moat_source = pick('moat_source', null);
    const moat_level = pick('moat_level', null);
    const key_structure_status = pick('key_structure_status', null);
    const relationship_type = pick('relationship_type', null);
    const supplier_multiplicity = pick('supplier_multiplicity', null);
    const integration_risk_notes = pick('integration_risk_notes', null);
    const v1_judgment = pick('v1_judgment', null);
    const v1_reasoning = pick('v1_reasoning', null);
    const business_notes = pick('business_notes', null);
    const open_gaps = pick('open_gaps', null);
    const is_coverage_active = pick('is_coverage_active', true);

    await pool.query(
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
      [stockId, industry_map_id || null, layer || null, moat_source || null, moat_level || null,
       key_structure_status || null, relationship_type || null, supplier_multiplicity || null,
       integration_risk_notes || null, v1_judgment || null, v1_reasoning || null, business_notes || null,
       open_gaps || null, !!is_coverage_active]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 驗證清單：財務數字用來驗證商業論點是否成立，跟可證偽假設是不同的東西，整批覆寫
app.put('/api/stocks/:stockId/verification', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { items = [] } = req.body;
    await conn.beginTransaction();
    await conn.query('DELETE FROM company_verification_items WHERE stock_id = ?', [req.params.stockId]);
    for (const [i, it] of items.entries()) {
      await conn.query(
        `INSERT INTO company_verification_items (stock_id, item, is_checked, sort_order) VALUES (?,?,?,?)`,
        [req.params.stockId, it.item, !!it.is_checked, i]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, error: e.message });
  } finally { conn.release(); }
});

// 三條因果線在個股的具體展現：整批覆寫
app.put('/api/stocks/:stockId/causal-lines', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { causal_lines = [] } = req.body;
    await conn.beginTransaction();
    await conn.query('DELETE FROM company_causal_lines WHERE stock_id = ?', [req.params.stockId]);
    for (const c of causal_lines) {
      await conn.query(
        `INSERT INTO company_causal_lines (stock_id, line_type, assessment, evidence) VALUES (?,?,?,?)`,
        [req.params.stockId, c.line_type, c.assessment || null, c.evidence || null]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ success: false, error: e.message });
  } finally { conn.release(); }
});

// 可證偽假設（個股層級）
app.get('/api/stocks/:stockId/hypotheses', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM company_hypotheses WHERE stock_id = ? ORDER BY sort_order, id', [req.params.stockId]);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/stocks/:stockId/hypotheses', async (req, res) => {
  try {
    const { hypothesis, falsifying_observation, current_status, sort_order } = req.body;
    if (!hypothesis) return res.status(400).json({ success: false, error: 'hypothesis required' });
    const [r] = await pool.query(
      `INSERT INTO company_hypotheses (stock_id, hypothesis, falsifying_observation, current_status, sort_order)
       VALUES (?,?,?,?,?)`,
      [req.params.stockId, hypothesis, falsifying_observation || null, current_status || null, sort_order || 0]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/stocks/:stockId/hypotheses/:hid', async (req, res) => {
  try {
    const { hypothesis, falsifying_observation, current_status, sort_order } = req.body;
    await pool.query(
      `UPDATE company_hypotheses SET hypothesis=?, falsifying_observation=?, current_status=?, sort_order=?
       WHERE id=? AND stock_id=?`,
      [hypothesis, falsifying_observation || null, current_status || null, sort_order || 0, req.params.hid, req.params.stockId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/stocks/:stockId/hypotheses/:hid', async (req, res) => {
  try {
    await pool.query('DELETE FROM company_hypotheses WHERE id=? AND stock_id=?', [req.params.hid, req.params.stockId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 事件日誌（財報公布 / 法說會 / guidance / 關鍵結構改變）
app.get('/api/stocks/:stockId/events', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM company_events WHERE stock_id = ? ORDER BY event_date DESC', [req.params.stockId]);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/stocks/:stockId/events', async (req, res) => {
  try {
    const { event_date, event_desc, affected_hypothesis, impact_on_judgment } = req.body;
    if (!event_date || !event_desc) return res.status(400).json({ success: false, error: 'event_date, event_desc required' });
    const [r] = await pool.query(
      `INSERT INTO company_events (stock_id, event_date, event_desc, affected_hypothesis, impact_on_judgment)
       VALUES (?,?,?,?,?)`,
      [req.params.stockId, event_date, event_desc, affected_hypothesis || null, impact_on_judgment || null]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/stocks/:stockId/events/:eid', async (req, res) => {
  try {
    const { event_date, event_desc, affected_hypothesis, impact_on_judgment } = req.body;
    await pool.query(
      `UPDATE company_events SET event_date=?, event_desc=?, affected_hypothesis=?, impact_on_judgment=?
       WHERE id=? AND stock_id=?`,
      [event_date, event_desc, affected_hypothesis || null, impact_on_judgment || null, req.params.eid, req.params.stockId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/stocks/:stockId/events/:eid', async (req, res) => {
  try {
    await pool.query('DELETE FROM company_events WHERE id=? AND stock_id=?', [req.params.eid, req.params.stockId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 目前的框架覆蓋清單（也是 FinMind 財報/月營收爬蟲的抓取範圍）
app.get('/api/coverage', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cp.stock_id, s.stock_name, cp.layer, cp.moat_source, cp.moat_level, cp.v1_judgment, im.name AS industry_name
       FROM company_profiles cp
       JOIN stocks s ON cp.stock_id = s.stock_id
       LEFT JOIN industry_maps im ON cp.industry_map_id = im.id
       WHERE cp.is_coverage_active = 1
       ORDER BY im.name, cp.stock_id`
    );
    res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================
// 管理用：一鍵同步（SSE 串流進度）
// 同步範圍：股價（全市場參考價）+ 財報/月營收（框架覆蓋清單，見 company_profiles.is_coverage_active）
// ============================================

app.post('/api/admin/sync', async (req, res) => {
  const { syncAllStocksHistory } = require('../crawler/fetchDailyPrices');
  const { fetchRecentFinancialStatements } = require('../crawler/fetchFinancialStatements');
  const { fetchRecentMonthlyRevenue } = require('../crawler/fetchMonthlyRevenue');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    emit({ step: 'prices', status: 'start', msg: '正在補抓全市場股價（近2個月，僅供參考）...' });
    const pr = await syncAllStocksHistory(2);
    emit({ step: 'prices', status: 'done', msg: `股價更新完成：${pr.stocks} 檔，寫入 ${pr.records} 筆` });

    emit({ step: 'financial', status: 'start', msg: '正在同步覆蓋清單財報（最近4季）...' });
    const finCount = await fetchRecentFinancialStatements();
    emit({ step: 'financial', status: 'done', msg: `財報同步完成：${finCount} 筆` });

    emit({ step: 'revenue', status: 'start', msg: '正在同步覆蓋清單月營收...' });
    const revCount = await fetchRecentMonthlyRevenue();
    emit({ step: 'revenue', status: 'done', msg: `月營收同步完成：${revCount} 筆` });

    emit({ done: true });
  } catch (error) {
    emit({ error: error.message });
  }
  res.end();
});

// ============================================
// 補歷史股價資料（SSE 串流，支援大範圍回補；僅供參考價，非框架核心資料）
// ============================================

app.post('/api/admin/sync-history', async (req, res) => {
  const { syncAllStocksHistory } = require('../crawler/fetchDailyPrices');

  const months = Math.min(Math.max(1, parseInt(req.body?.months) || 12), 120);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    emit({ step: 'prices', status: 'start', msg: `正在回補近 ${months} 個月股價（可能需要數分鐘）...` });

    let lastPct = 0;
    const pr = await syncAllStocksHistory(months, (done, total, stockId) => {
      const pct = Math.round(done / total * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        emit({ step: 'prices', status: 'start', msg: `補抓中 ${pct}%（${done}/${total}）${stockId}` });
      }
    });
    emit({ step: 'prices', status: 'done', msg: `股價回補完成：${pr.stocks} 檔，共 ${pr.records} 筆` });

    emit({ done: true });
  } catch (error) {
    emit({ error: error.message });
  }
  res.end();
});

// ============================================
// 健康檢查
// ============================================

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, status: 'unhealthy', error: error.message });
  }
});

// ============================================
// 觀察總覽 — 每日自動同步的狀態與變化
// 「數字」自動更新；護城河/因果線/假設等「敘事」欄位仍由人工覆盤更新
// ============================================

// 待更新總覽：目前覆蓋清單裡每檔股票的資料新鮮度（同步前就能看出「什麼將要更新」）
app.get('/api/dashboard', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cp.stock_id, s.stock_name, im.name AS industry_name, cp.v1_judgment
       FROM company_profiles cp
       JOIN stocks s ON cp.stock_id = s.stock_id
       LEFT JOIN industry_maps im ON cp.industry_map_id = im.id
       WHERE cp.is_coverage_active = 1
       ORDER BY im.name IS NULL, im.name, cp.stock_id`
    );

    const data = await Promise.all(rows.map(async (r) => {
      const [price, revenue, financial] = await Promise.all([
        getPriceFreshness(r.stock_id),
        getRevenueFreshness(r.stock_id),
        getFinancialFreshness(r.stock_id),
      ]);

      const [[latestRev]] = await pool.query(
        'SELECT year, month FROM monthly_revenue WHERE stock_id=? ORDER BY year DESC, month DESC LIMIT 1', [r.stock_id]
      );
      const [[latestFin]] = await pool.query(
        'SELECT year, quarter FROM financial_statements WHERE stock_id=? ORDER BY year DESC, quarter DESC LIMIT 1', [r.stock_id]
      );
      const nextRevenue = getNextRevenueDeadline(latestRev?.year, latestRev?.month);
      const nextFinancialEstimate = getNextQuarterDeadline(latestFin?.year, latestFin?.quarter);

      // 官方已公告的財報董事會日期比法定截止日精準，優先採用
      const [[officialSchedule]] = await pool.query(
        `SELECT event_date, target_period FROM material_announcements
         WHERE stock_id=? AND category IN ('earnings_schedule','earnings_announced')
           AND target_period = ? AND event_date IS NOT NULL
         ORDER BY announced_date DESC LIMIT 1`,
        [r.stock_id, `${nextFinancialEstimate.year}Q${nextFinancialEstimate.quarter}`]
      );

      // 法說會是例行揭露，獨立一個欄位，不跟警示訊號混在一起
      const [[upcomingCall]] = await pool.query(
        `SELECT event_date, target_period, subject FROM material_announcements
         WHERE stock_id=? AND category='earnings_call' AND event_date >= CURDATE()
         ORDER BY event_date ASC LIMIT 1`,
        [r.stock_id]
      );

      // 重大訊息只留真正的風險/異常訊號（注意股、被要求公佈自結），財報排程/已決議已經在財報欄位反映了
      const [recentAnnouncements] = await pool.query(
        `SELECT category, announced_date, event_date, target_period, subject FROM material_announcements
         WHERE stock_id=? AND category IN ('attention','self_disclosure')
           AND announced_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         ORDER BY announced_date DESC`, [r.stock_id]
      );

      return {
        ...r,
        freshness: { price, revenue, financial },
        next_revenue: { period: `${nextRevenue.year}-${String(nextRevenue.month).padStart(2, '0')}`, expected_date: nextRevenue.expected_date, source: 'estimated' },
        next_financial: officialSchedule
          ? { period: officialSchedule.target_period, expected_date: officialSchedule.event_date, source: 'official' }
          : { period: `${nextFinancialEstimate.year}Q${nextFinancialEstimate.quarter}`, expected_date: nextFinancialEstimate.expected_date, source: 'estimated' },
        next_earnings_call: upcomingCall
          ? { period: upcomingCall.target_period, expected_date: upcomingCall.event_date, source: 'official', subject: upcomingCall.subject }
          : null,
        recent_announcements: recentAnnouncements,
      };
    }));

    const grouped = {};
    for (const s of data) {
      const key = s.industry_name || '未分類';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(s);
    }
    const industries = Object.keys(grouped).map(name => ({ name, stocks: grouped[name] }));

    const [[latestRun]] = await pool.query(
      'SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1'
    );

    res.json({ success: true, industries, latest_run: latestRun || null });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 本週待公布：覆蓋清單裡哪些股票會在指定天數內公布月營收或財報
// 財報優先採用官方已公告的董事會日期（source=official），沒有的話用法定截止日推算（source=estimated）
app.get('/api/dashboard/upcoming', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);

    const [rows] = await pool.query(
      `SELECT cp.stock_id, s.stock_name, im.name AS industry_name
       FROM company_profiles cp
       JOIN stocks s ON cp.stock_id = s.stock_id
       LEFT JOIN industry_maps im ON cp.industry_map_id = im.id
       WHERE cp.is_coverage_active = 1`
    );

    const upcoming = [];
    for (const r of rows) {
      const [[latestRev]] = await pool.query(
        'SELECT year, month FROM monthly_revenue WHERE stock_id=? ORDER BY year DESC, month DESC LIMIT 1', [r.stock_id]
      );
      const [[latestFin]] = await pool.query(
        'SELECT year, quarter FROM financial_statements WHERE stock_id=? ORDER BY year DESC, quarter DESC LIMIT 1', [r.stock_id]
      );
      const nextRevenue = getNextRevenueDeadline(latestRev?.year, latestRev?.month);
      const nextFinancialEstimate = getNextQuarterDeadline(latestFin?.year, latestFin?.quarter);

      const [[officialSchedule]] = await pool.query(
        `SELECT event_date, target_period FROM material_announcements
         WHERE stock_id=? AND category IN ('earnings_schedule','earnings_announced')
           AND target_period = ? AND event_date IS NOT NULL
         ORDER BY announced_date DESC LIMIT 1`,
        [r.stock_id, `${nextFinancialEstimate.year}Q${nextFinancialEstimate.quarter}`]
      );

      const financial = officialSchedule
        ? { period: officialSchedule.target_period, expected_date: officialSchedule.event_date, source: 'official' }
        : { period: `${nextFinancialEstimate.year}Q${nextFinancialEstimate.quarter}`, expected_date: nextFinancialEstimate.expected_date, source: 'estimated' };

      const revenue = { period: `${nextRevenue.year}-${String(nextRevenue.month).padStart(2, '0')}`, expected_date: nextRevenue.expected_date, source: 'estimated' };

      // 法說會沒有法定截止日可推算，只有公司自己公告才會出現，找最近一筆尚未發生的
      const [[upcomingCall]] = await pool.query(
        `SELECT event_date, target_period FROM material_announcements
         WHERE stock_id=? AND category='earnings_call' AND event_date >= CURDATE()
         ORDER BY event_date ASC LIMIT 1`,
        [r.stock_id]
      );
      const metrics = [['月營收', revenue], ['財報', financial]];
      if (upcomingCall) {
        metrics.push(['法說會', { period: upcomingCall.target_period || '—', expected_date: upcomingCall.event_date, source: 'official' }]);
      }

      for (const [metric, info] of metrics) {
        const daysUntil = Math.ceil((new Date(info.expected_date) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
        if (daysUntil >= 0 && daysUntil <= days) {
          upcoming.push({
            stock_id: r.stock_id, stock_name: r.stock_name, industry_name: r.industry_name,
            metric, period: info.period, expected_date: info.expected_date, source: info.source, days_until: daysUntil,
          });
        }
      }
    }

    upcoming.sort((a, b) => a.expected_date.localeCompare(b.expected_date));
    res.json({ success: true, days, data: upcoming });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 近期官方重大訊息（注意股 / 因股價異常波動被要求公佈自結）
app.get('/api/material-announcements', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 14, 90);
    const coverageOnly = req.query.coverage_only !== 'false';
    const categories = req.query.categories ? req.query.categories.split(',').map(s => s.trim()).filter(Boolean) : null;

    const conditions = ['ma.announced_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)'];
    const params = [days];
    if (coverageOnly) conditions.push("EXISTS (SELECT 1 FROM company_profiles cp WHERE cp.stock_id = ma.stock_id AND cp.is_coverage_active = 1)");
    if (categories && categories.length) {
      conditions.push(`ma.category IN (${categories.map(() => '?').join(',')})`);
      params.push(...categories);
    }

    const [rows] = await pool.query(
      `SELECT ma.*, s.stock_name FROM material_announcements ma
       JOIN stocks s ON ma.stock_id = s.stock_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ma.announced_date DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 最近一次同步的變化清單（「這次更新抓到什麼值」），預設回傳最新一次 run；可用 ?run_id= 指定
app.get('/api/sync-runs/latest', async (req, res) => {
  try {
    const runId = req.query.run_id;
    const [[run]] = runId
      ? await pool.query('SELECT * FROM sync_runs WHERE id=?', [runId])
      : await pool.query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1');
    if (!run) return res.json({ success: true, run: null, changes: [] });

    const [changes] = await pool.query(
      `SELECT dcl.*, s.stock_name FROM data_change_log dcl
       JOIN stocks s ON dcl.stock_id = s.stock_id
       WHERE dcl.run_id = ? ORDER BY dcl.is_significant DESC, dcl.stock_id`,
      [run.id]
    );
    res.json({ success: true, run, changes });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 近期同步紀錄列表
app.get('/api/sync-runs', async (req, res) => {
  try {
    const [runs] = await pool.query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20');
    res.json({ success: true, data: runs });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 手動立即觸發一次同步（跟每日排程呼叫同一個函式）
app.post('/api/admin/daily-sync', async (req, res) => {
  try {
    const result = await runDailySync();
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Sectors ──────────────────────────────────────────────────

// 寫入後自動儲存 snapshot
app.use('/api/sectors', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const orig = res.json.bind(res);
    res.json = (data) => {
      orig(data);
      if (data && data.success) saveSectorsSnapshot().catch(e => console.error('[Sectors] snapshot 失敗:', e.message));
    };
  }
  next();
});

// GET all groups with subgroups
app.get('/api/sectors', async (req, res) => {
  try {
    const [groups] = await pool.query('SELECT * FROM sector_groups ORDER BY sort_order, id');
    const [subgroups] = await pool.query('SELECT * FROM sector_subgroups ORDER BY sort_order, id');
    const tree = groups.map(g => ({
      ...g,
      subgroups: subgroups.filter(s => s.group_id === g.id)
    }));
    res.json({ success: true, data: tree });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST create group
app.post('/api/sectors/groups', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const [r] = await pool.query('INSERT INTO sector_groups (name) VALUES (?)', [name]);
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PUT reorder groups (must come before /:id route)
app.put('/api/sectors/groups/reorder', async (req, res) => {
  try {
    const { order } = req.body; // array of group ids in new order
    if (!Array.isArray(order)) return res.status(400).json({ success: false, error: 'order array required' });
    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE sector_groups SET sort_order=? WHERE id=?', [i, order[i]]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PUT update group
app.put('/api/sectors/groups/:id', async (req, res) => {
  try {
    const { name } = req.body;
    await pool.query('UPDATE sector_groups SET name=? WHERE id=?', [name, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE group
app.delete('/api/sectors/groups/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sector_groups WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST create subgroup
app.post('/api/sectors/groups/:gid/subgroups', async (req, res) => {
  try {
    const { name, description = '' } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const [r] = await pool.query(
      'INSERT INTO sector_subgroups (group_id, name, description) VALUES (?,?,?)',
      [req.params.gid, name, description]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PUT update subgroup
app.put('/api/sectors/subgroups/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    await pool.query('UPDATE sector_subgroups SET name=?, description=? WHERE id=?',
      [name, description, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE subgroup
app.delete('/api/sectors/subgroups/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sector_subgroups WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET stocks in subgroup (with latest price + change_percent)
app.get('/api/sectors/subgroups/:id/stocks', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ss.stock_id, st.stock_name, ss.section_id,
             dp.close_price, dp.change_percent
      FROM sector_stocks ss
      JOIN stocks st ON ss.stock_id = st.stock_id
      LEFT JOIN daily_prices dp ON ss.stock_id = dp.stock_id
        AND dp.trade_date = (SELECT MAX(trade_date) FROM daily_prices WHERE stock_id = ss.stock_id)
      WHERE ss.subgroup_id = ?
      ORDER BY ss.sort_order, ss.stock_id
    `, [req.params.id]);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST add stock to subgroup
app.post('/api/sectors/subgroups/:id/stocks', async (req, res) => {
  try {
    const { stock_id } = req.body;
    if (!stock_id) return res.status(400).json({ success: false, error: 'stock_id required' });
    // verify stock exists
    const [rows] = await pool.query('SELECT stock_id FROM stocks WHERE stock_id=?', [stock_id]);
    if (!rows.length) return res.status(404).json({ success: false, error: '股票代號不存在' });
    await pool.query('INSERT IGNORE INTO sector_stocks (subgroup_id, stock_id) VALUES (?,?)',
      [req.params.id, stock_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE stock from subgroup
app.delete('/api/sectors/subgroups/:sid/stocks/:stockId', async (req, res) => {
  try {
    await pool.query('DELETE FROM sector_stocks WHERE subgroup_id=? AND stock_id=?',
      [req.params.sid, req.params.stockId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Sections CRUD
app.get('/api/sectors/subgroups/:id/sections', async (req, res) => {
  try {
    const [sections] = await pool.query(
      'SELECT * FROM sector_stock_sections WHERE subgroup_id=? ORDER BY sort_order, id',
      [req.params.id]
    );
    res.json({ success: true, data: sections });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/sectors/subgroups/:id/sections', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const [r] = await pool.query(
      'INSERT INTO sector_stock_sections (subgroup_id, name) VALUES (?,?)',
      [req.params.id, name]
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/sectors/sections/:id', async (req, res) => {
  try {
    const { name } = req.body;
    await pool.query('UPDATE sector_stock_sections SET name=? WHERE id=?', [name, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/sectors/sections/:id', async (req, res) => {
  try {
    // Nullify section_id for stocks in this section
    await pool.query('UPDATE sector_stocks SET section_id=NULL WHERE section_id=?', [req.params.id]);
    await pool.query('DELETE FROM sector_stock_sections WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Move stock to section (or unassign with section_id: null)
app.put('/api/sectors/subgroups/:sid/stocks/:stockId/section', async (req, res) => {
  try {
    const { section_id } = req.body; // null = uncategorized
    await pool.query(
      'UPDATE sector_stocks SET section_id=? WHERE subgroup_id=? AND stock_id=?',
      [section_id || null, req.params.sid, req.params.stockId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 首頁由 public/index.html 靜態服務

// ── 每日自動同步排程 ──────────────────────────────────────────
// 每天 20:00（台股當日資料與月營收都已穩定公布後）自動跑一次；
// 只更新數字，護城河/因果線/假設等敘事欄位不受影響，仍由人工在 /dashboard.html 覆盤
cron.schedule('0 20 * * *', () => {
  console.log('[cron] 開始每日自動同步...');
  runDailySync()
    .then(r => console.log(`[cron] 同步完成：${r.changeCount} 筆變化（${r.significantCount} 筆需留意）`))
    .catch(e => console.error('[cron] 同步失敗:', e.message));
});

app.listen(PORT, async () => {
  console.log(`\n台股供應鏈研究系統 v3.0 啟動成功！`);
  console.log(`網址: http://localhost:${PORT}`);
  console.log(`每日自動同步排程：每天 20:00`);
  console.log(`按 Ctrl+C 停止伺服器\n`);
  await autoImportSectorsIfEmpty();
  await autoImportFrameworkIfEmpty();
});

module.exports = app;
