/**
 * 一次性匯入腳本：把 taiwan-supply-chain-framework.zip 裡 coverage/coverage-status.md
 * 已記錄的研究成果寫入 industry_maps / company_profiles 系列表，作為框架的初始資料。
 *
 * 資料來源是質化研究筆記，很多欄位（六層地圖細節、正式因果線判斷）尚未系統化，
 * 保持空白或寫進 open_gaps，不用樂觀假設填補（符合框架 CLAUDE.md 的守則）。
 *
 * 執行後這些股票的 is_coverage_active=1，之後 FinMind 財報/月營收爬蟲就會抓這批股票。
 */
require('dotenv').config();
const { pool } = require('../src/database/connection');

const INDUSTRIES = [
  {
    name: '功率元件',
    taiwan_participation_notes:
      '台廠幾乎完全缺席 SiC/GaN，中長期替代壓力是結構性的（SiC 吃掉 Si 高壓段、GaN 吃掉 Si 低壓段）。',
    open_gaps:
      '六層地圖表格尚待補建（目前只有護城河結論與部分個股定位，未整理成六層表格）。富鼎已建成完整個股模板，其餘三檔尚待補齊。',
  },
  {
    name: '導線架',
    taiwan_participation_notes:
      '護城河判斷：中等，可靠資本與時間複製，偏規模型而非材料壟斷型。界霖毛利率關鍵驅動：浮動計價機制反應速度 + 稼動率回升至 70-75% + 產品組合往高規格移動。',
    open_gaps: '原材料/關鍵材料層、設備層、產品組合矩陣、可證偽假設、v1 投資判斷皆尚待補齊。',
    causal_lines: [
      { line_type: 'supply', assessment: '供給結構性收縮（初步結論，細節待補證據）' },
      { line_type: 'demand', assessment: '需求缺口——車用回補 vs. AI/HVDC 敘事 vs. 實際認列營收的落差（待進一步拆解證據）' },
      { line_type: 'inventory', assessment: '庫存週期定位（尚待確認目前所在階段）' },
    ],
  },
  {
    name: '載板/PCB',
    tech_background_notes: '待補：Chapter 0 技術背景（CCL vs. ABF 材料與壓合差異），確認納入下次匯入。',
    taiwan_participation_notes:
      '載板三雄定位：欣興 3037（全球龍頭，美系雲端 AI ASIC ~70%份額，NVIDIA Blackwell 第二供應商）、南電 8046（800G switch ASIC，議價彈性高）、景碩 3189（份額最小 ~4%，第三供應商進入 AI GPU 供應鏈，母公司和碩）。',
    open_gaps:
      'Kyber NVL144 midplane 代工廠身分未確認，待法說會/通路查核。Kyber NVL144 delay 已用三條獨立因果線拆解：PCB midplane 良率、CPO 成熟度、Rubin Ultra die downgrade——細節待補進對應因果線欄位。',
  },
  {
    name: '被動元件',
    open_gaps: '尚未系統化進 Notion，僅有個股定位判斷，六層地圖/護城河分類/因果線/可證偽假設待建置。',
  },
  {
    name: '先進封裝',
    open_gaps: '尚未系統化進 Notion，僅 ASE(日月光投控) 3711 有明確個股分析。',
  },
];

const COMPANIES = [
  // 功率元件
  { stock_id: '8261', industry: '功率元件', layer: '零組件製造', v1_judgment: 'Fully priced, watchlist not buy',
    business_notes: '低壓 MOSFET，VRM 核心電源路徑，VRM 定位最強。' },
  { stock_id: '2481', industry: '功率元件', layer: '零組件製造',
    business_notes: '蕭特基二極體為主，GB200 輔助電路中的 LDO 二極體角色。' },
  { stock_id: '3675', industry: '功率元件', layer: '零組件製造',
    business_notes: '整流器/車用為主。' },
  { stock_id: '8255', industry: '功率元件', layer: '零組件製造',
    business_notes: '整流器/車用為主。' },

  // 導線架
  { stock_id: '2351', industry: '導線架', layer: '零組件製造', moat_level: '中等' },
  { stock_id: '6548', industry: '導線架', layer: '零組件製造', moat_level: '中等' },
  { stock_id: '5285', industry: '導線架', layer: '零組件製造', moat_level: '中等',
    business_notes: '毛利率關鍵驅動：浮動計價機制反應速度 + 稼動率回升至 70-75% + 產品組合往高規格移動。' },
  { stock_id: '2486', industry: '導線架', layer: '零組件製造', moat_level: '中等' },

  // 載板/PCB
  { stock_id: '3037', industry: '載板/PCB', layer: '零組件製造',
    business_notes: '全球龍頭，美系雲端 AI ASIC ~70%份額，NVIDIA Blackwell 第二供應商。' },
  { stock_id: '8046', industry: '載板/PCB', layer: '零組件製造',
    business_notes: '800G switch ASIC，議價彈性高。' },
  { stock_id: '3189', industry: '載板/PCB', layer: '零組件製造',
    business_notes: '份額最小 ~4%，第三供應商進入 AI GPU 供應鏈，母公司和碩。' },

  // 被動元件（已研究但尚未系統化）
  { stock_id: '3026', industry: '被動元件', moat_level: '最高',
    business_notes: '高壓 NP0 MLCC，直接切入 Vera Rubin BOM，毛利 35-40%，護城河最高。' },
  { stock_id: '6449', industry: '被動元件',
    business_notes: '固態高分子電容，NVIDIA Vchip 約 80% 份額，毛利 30-35%。' }, // 鈺邦；coverage-status.md 原記載為 5364，經比對資料庫實為 6449，已更正
  { stock_id: '2327', industry: '被動元件',
    business_notes: '鉭質電容(KEMET)+MLCC+電阻，毛利 38-42%（最高），但 AI 曝險屬混合型（漲價+轉單，非純結構性）。' },
  { stock_id: '6862', industry: '被動元件',
    business_notes: 'TLVR 電感，滲透 NVIDIA 每一代平台，毛利 33-38%。' },
  { stock_id: '3357', industry: '被動元件',
    business_notes: 'TLVR 電感，車用為主/AI為輔。' },
  { stock_id: '2492', industry: '被動元件',
    business_notes: '標準 MLCC+車用，轉型中。' },
  { stock_id: '2472', industry: '被動元件',
    business_notes: '半固態鋁質電解電容，新進入 Vera Rubin BOM。' },
  { stock_id: '2375', industry: '被動元件',
    business_notes: '鋁質電解電容，傳統市場轉單外溢。' },

  // 先進封裝
  { stock_id: '3711', industry: '先進封裝', layer: '模組整合',
    business_notes: '兩大業務：半導體封測(~64%) + USI 的 EMS(~35%)。台灣廠 CoWoS-L 產出的主要合作夥伴（尤其 NVIDIA）。' +
      '中期風險：客戶晶圓產能轉移到 Arizona 會擴大 Amkor 可觸及份額，壓縮 ASE 邊際利潤。' },
];

async function seedIndustryMaps() {
  const nameToId = {};
  for (const ind of INDUSTRIES) {
    const [[existing]] = await pool.query('SELECT id FROM industry_maps WHERE name = ?', [ind.name]);
    let id;
    if (existing) {
      id = existing.id;
      await pool.query(
        `UPDATE industry_maps SET tech_background_notes=?, taiwan_participation_notes=?, open_gaps=? WHERE id=?`,
        [ind.tech_background_notes || null, ind.taiwan_participation_notes || null, ind.open_gaps || null, id]
      );
    } else {
      const [r] = await pool.query(
        `INSERT INTO industry_maps (name, tech_background_notes, taiwan_participation_notes, open_gaps) VALUES (?,?,?,?)`,
        [ind.name, ind.tech_background_notes || null, ind.taiwan_participation_notes || null, ind.open_gaps || null]
      );
      id = r.insertId;
    }
    nameToId[ind.name] = id;

    if (ind.causal_lines) {
      for (const c of ind.causal_lines) {
        await pool.query(
          `INSERT INTO industry_map_causal_lines (industry_map_id, line_type, assessment, evidence)
           VALUES (?,?,?,?)
           ON DUPLICATE KEY UPDATE assessment=VALUES(assessment), evidence=VALUES(evidence)`,
          [id, c.line_type, c.assessment || null, c.evidence || null]
        );
      }
    }
    console.log(`✓ 產業地圖「${ind.name}」(id=${id})`);
  }
  return nameToId;
}

async function seedCompanyProfiles(nameToId) {
  let count = 0;
  for (const c of COMPANIES) {
    const [stockRows] = await pool.query('SELECT stock_id, stock_name FROM stocks WHERE stock_id = ?', [c.stock_id]);
    if (!stockRows.length) {
      console.warn(`⚠ 找不到股票代號 ${c.stock_id}，跳過`);
      continue;
    }
    const industryMapId = nameToId[c.industry] || null;
    await pool.query(
      `INSERT INTO company_profiles
       (stock_id, industry_map_id, layer, moat_level, v1_judgment, business_notes, is_coverage_active)
       VALUES (?,?,?,?,?,?,TRUE)
       ON DUPLICATE KEY UPDATE
       industry_map_id=VALUES(industry_map_id), layer=VALUES(layer), moat_level=VALUES(moat_level),
       v1_judgment=VALUES(v1_judgment), business_notes=VALUES(business_notes), is_coverage_active=TRUE`,
      [c.stock_id, industryMapId, c.layer || null, c.moat_level || null, c.v1_judgment || null, c.business_notes || null]
    );
    console.log(`✓ ${c.stock_id} ${stockRows[0].stock_name}（${c.industry}）`);
    count++;
  }
  return count;
}

async function main() {
  console.log('開始匯入框架初始資料...\n');
  const nameToId = await seedIndustryMaps();
  console.log('');
  const count = await seedCompanyProfiles(nameToId);
  console.log(`\n完成！共建立 ${INDUSTRIES.length} 個產業地圖、${count} 檔覆蓋清單股票。`);
  process.exit(0);
}

main().catch(e => {
  console.error('匯入失敗:', e);
  process.exit(1);
});
