/**
 * 一次性匯入腳本：把「總經分析框架.md」的內容寫入 macro_indicators 系列表。
 *
 * priority_tier 只在原文「三層優先級」章節明確分類時才填值，其餘留 NULL，
 * 不用樂觀假設填補（同 seedFrameworkData.js 的原則）。
 */
require('dotenv').config();
const { pool } = require('../src/database/connection');

const INDICATORS = [
  // 美國（每月）
  { name: 'ISM製造業PMI', country: '美國', dimension: '經濟成長動能', priority_tier: '重要',
    frequency: '每月', release_timing: '第1週(約第3個營業日)', publisher: 'ISM',
    interpretation_notes: '>50擴張、<50收縮；新訂單、客戶存貨分項最關鍵，判斷需求回溫vs庫存回補' },
  { name: 'ISM服務業PMI', country: '美國', dimension: '經濟成長動能', priority_tier: '重要',
    frequency: '每月', release_timing: '第1週', publisher: 'ISM',
    interpretation_notes: '美國經濟七成是服務業，代表性更高' },
  { name: '非農就業報告(NFP)', country: '美國', dimension: '勞動市場緊俏度', priority_tier: '核心必追',
    frequency: '每月', release_timing: '每月第1個週五', publisher: '勞工統計局(BLS)',
    interpretation_notes: '新增就業、失業率、時薪年增率(通膨領先線索)；當月最重要單一數據',
    fred_series_id: 'PAYEMS' },
  { name: 'CPI', country: '美國', dimension: '通膨與物價壓力', priority_tier: '核心必追',
    frequency: '每月', release_timing: '約每月10-13日', publisher: 'BLS',
    interpretation_notes: '核心CPI(排除食品能源)是Fed關注重點；公布時常是台股夜盤波動最大時點',
    fred_series_id: 'CPIAUCSL' },
  { name: 'PPI', country: '美國', dimension: '通膨與物價壓力', priority_tier: '重要',
    frequency: '每月', release_timing: 'CPI後1-2天', publisher: 'BLS',
    interpretation_notes: '領先CPI的通膨管線；留意半導體/電子零組件細項，驗證上游成本傳導',
    fred_series_id: 'PPIACO' },
  { name: '零售銷售', country: '美國', dimension: '經濟成長動能', priority_tier: '參考即可',
    frequency: '每月', release_timing: '約每月15日', publisher: '商務部',
    interpretation_notes: '美國消費力直接讀數，影響終端電子需求預期',
    fred_series_id: 'RSAFS' },
  { name: '工業生產指數', country: '美國', dimension: '經濟成長動能', priority_tier: null,
    frequency: '每月', release_timing: '每月中下旬', publisher: 'Fed',
    interpretation_notes: '製造業實際產出，與PMI互相驗證',
    fred_series_id: 'INDPRO' },
  { name: 'PCE物價指數', country: '美國', dimension: '通膨與物價壓力', priority_tier: null,
    frequency: '每月', release_timing: '每月最後週五左右', publisher: '商務部(BEA)',
    interpretation_notes: 'Fed官方通膨目標指標(2%目標指PCE非CPI)，重要性高於CPI但市場反應通常較小',
    fred_series_id: 'PCEPI' },
  { name: '消費者信心指數', country: '美國', dimension: '經濟成長動能', priority_tier: '參考即可',
    frequency: '每月', release_timing: '每月下旬', publisher: 'Conference Board / 密大',
    interpretation_notes: '領先消費行為的軟指標（FRED僅有密大版免費資料，Conference Board版非公開API）',
    fred_series_id: 'UMCSENT' },

  // 台灣（每月）
  { name: '上市櫃公司月營收', country: '台灣', dimension: null, priority_tier: '核心必追',
    frequency: '每月', release_timing: '每月10日前', publisher: '公開資訊觀測站',
    interpretation_notes: '公司層核心數據；全世界只有台灣有月頻率的公司營收揭露' },
  { name: '台灣出口值', country: '台灣', dimension: '經濟成長動能', priority_tier: '重要',
    frequency: '每月', release_timing: '每月7-8日左右', publisher: '財政部關務署',
    interpretation_notes: '驗證半導體產業鏈景氣，可跟公司月營收交叉驗證（含電子零組件細項）' },
  { name: '台灣外銷訂單', country: '台灣', dimension: '經濟成長動能', priority_tier: null,
    frequency: '每月', release_timing: '每月下旬', publisher: '經濟部',
    interpretation_notes: '領先出口1-3個月，「接單」先於「出貨」' },
  { name: '台灣製造業PMI', country: '台灣', dimension: '經濟成長動能', priority_tier: null,
    frequency: '每月', release_timing: '每月初', publisher: '中經院',
    interpretation_notes: '台灣版PMI，對電子業景氣更直接' },
  { name: '台灣CPI', country: '台灣', dimension: '通膨與物價壓力', priority_tier: null,
    frequency: '每月', release_timing: '每月5日左右', publisher: '主計總處',
    interpretation_notes: '影響央行利率決策' },

  // 每季/不定期
  { name: 'FOMC利率決議', country: '美國', dimension: '資金成本與貨幣政策', priority_tier: '核心必追',
    frequency: '每6週一次(一年8次)', release_timing: '3、6、9、12月附點陣圖與經濟預測(SEP)最重要', publisher: 'Fed',
    interpretation_notes: '3、6、9、12月附點陣圖與經濟預測(SEP)，這4次最重要' },
  { name: '美國GDP', country: '美國', dimension: '經濟成長動能', priority_tier: '參考即可',
    frequency: '每季', release_timing: '初值/修正值/終值', publisher: '商務部',
    interpretation_notes: '初值市場反應最大；留意個人消費和企業投資分項',
    fred_series_id: 'GDPC1' },
  { name: '台灣GDP', country: '台灣', dimension: '經濟成長動能', priority_tier: '參考即可',
    frequency: '每季', release_timing: null, publisher: '主計總處',
    interpretation_notes: '主計總處公布，留意出口貢獻度' },
  { name: '美股科技大廠財報+資本支出guidance', country: '美國', dimension: null, priority_tier: '重要',
    frequency: '每季財報季(1、4、7、10月)', release_timing: '財報季(1、4、7、10月)',
    publisher: 'NVIDIA/微軟/Google/Meta/Amazon',
    interpretation_notes: 'capex財測——領先台廠月營收1-2季的下游需求指標（原文稱CSP資本支出guidance）' },
  { name: '台灣上市櫃季報', country: '台灣', dimension: null, priority_tier: '重要',
    frequency: '每季財報季', release_timing: '5/15、8/14、11/14截止', publisher: '公開資訊觀測站',
    interpretation_notes: '毛利率、營業利益率、現金流量表只有季頻率(CFO/淨利背離只能靠這個驗證)' },
  { name: 'SEMI B/B Ratio、WSTS半導體銷售額', country: '美國', dimension: null, priority_tier: null,
    frequency: '每月/每季', release_timing: null, publisher: 'SEMI / WSTS',
    interpretation_notes: '產業層驗證數據' },
  { name: '央行理監事會議(台灣)', country: '台灣', dimension: '資金成本與貨幣政策', priority_tier: '參考即可',
    frequency: '不定期(3、6、9、12月)', release_timing: '不定期(3、6、9、12月)', publisher: '中央銀行',
    interpretation_notes: '影響新台幣匯率走向' },
];

const TRANSMISSION_NOTES = [
  {
    indicator_name: '非農就業報告(NFP)',
    title: 'NFP如何影響功率半導體股',
    description:
      'NFP透過四個管道傳導至個股：\n' +
      '1. 估值折現率：就業強勁 → Fed偏鷹 → 折現率上升 → 高本益比股票估值壓縮\n' +
      '2. USD/TWD匯率：影響台廠出口營收換算與外資資金流向\n' +
      '3. 外資風險偏好：就業/通膨數據影響外資對新興市場科技股的配置意願\n' +
      '4. 實體經濟需求：就業與時薪數據反映終端消費力，間接影響電子/AI伺服器需求\n\n' +
      '高本益比持股(如強茂)對利率驅動的估值壓縮最敏感，NFP/CPI公布時需特別留意。',
  },
];

const ANALYSIS_PRINCIPLES = [
  { principle: 'CFO/淨利背離是紅旗訊號：毛利率擴張但營運現金流未同步改善，代表獲利品質可能有疑慮',
    source_case: '強茂2026Q1案例' },
  { principle: 'IDM vs Fabless對原料成本的不對稱反應：晶圓價格上漲時，IDM是margin擴張，Fabless是成本轉嫁壓力，方向相反',
    source_case: null },
  { principle: 'AI伺服器需求是主要成長引擎，非車用出貨量：48V/800V HVDC電源架構升級(需要更高規格MOSFET)是結構性需求驅動；車用出貨平穩，缺乏AI滲透的公司上檔有限',
    source_case: null },
  { principle: 'Nexperia事件屬地緣政治，非美國政策驅動：源自荷蘭政府介入與中國出口管制，與美國去中化主題屬不同分析脈絡，需分開處理',
    source_case: 'Nexperia事件' },
  { principle: '敘事 vs 實際供應鏈滲透：衛星/題材股常提前反映敘事，出手前需驗證實際營收占比',
    source_case: null },
];

const FRAMEWORK_NOTES = [
  { section_key: 'minimal_set', title: '時間有限時的最小追蹤組合',
    content: '時間有限時，每月只追四個：NFP、CPI、FOMC（當月有開會）、台股月營收——涵蓋總經層+公司層最關鍵節點。' },
  { section_key: 'tracking_rhythm', title: '建議每月追蹤節奏',
    content:
      '月初(1-10日)：ISM PMI → NFP → 台灣出口值 → 台股月營收(10日截止)——資訊密度最高的時段\n' +
      '月中(10-15日)：CPI → PPI → 零售銷售\n' +
      '月底(25-31日)：PCE → 消費者信心 → 台灣外銷訂單\n' +
      '季度加碼：FOMC(尤其3/6/9/12月)、美股科技財報季capex guidance、台灣季報現金流量表' },
  { section_key: 'data_sources', title: '資料來源',
    content:
      '美國總經數據：BLS、Fed、Conference Board、商務部(BEA)\n' +
      '台灣總經數據：公開資訊觀測站、財政部關務署、經濟部、中經院、主計總處\n' +
      '產業驗證數據：SEMI B/B Ratio、WSTS半導體銷售額\n' +
      '個股財務：公開資訊觀測站月營收/季報現金流量表' },
];

async function seedIndicators() {
  const nameToId = {};
  let sortOrder = 0;
  for (const ind of INDICATORS) {
    const [r] = await pool.query(
      `INSERT INTO macro_indicators
       (name, country, dimension, priority_tier, frequency, release_timing, publisher, interpretation_notes, sort_order, fred_series_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
       country=VALUES(country), dimension=VALUES(dimension), priority_tier=VALUES(priority_tier),
       frequency=VALUES(frequency), release_timing=VALUES(release_timing), publisher=VALUES(publisher),
       interpretation_notes=VALUES(interpretation_notes), sort_order=VALUES(sort_order),
       fred_series_id=VALUES(fred_series_id)`,
      [ind.name, ind.country, ind.dimension, ind.priority_tier, ind.frequency,
       ind.release_timing, ind.publisher, ind.interpretation_notes, sortOrder++, ind.fred_series_id || null]
    );
    const [[row]] = await pool.query('SELECT id FROM macro_indicators WHERE name = ?', [ind.name]);
    nameToId[ind.name] = row.id;
    console.log(`✓ 指標「${ind.name}」(id=${row.id})`);
  }
  return nameToId;
}

async function seedTransmissionNotes(nameToId) {
  for (let i = 0; i < TRANSMISSION_NOTES.length; i++) {
    const t = TRANSMISSION_NOTES[i];
    const indicatorId = t.indicator_name ? nameToId[t.indicator_name] || null : null;
    const [existing] = await pool.query('SELECT id FROM macro_transmission_notes WHERE title = ?', [t.title]);
    if (existing.length) {
      await pool.query(
        'UPDATE macro_transmission_notes SET indicator_id=?, description=?, sort_order=? WHERE id=?',
        [indicatorId, t.description, i, existing[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO macro_transmission_notes (indicator_id, title, description, sort_order) VALUES (?,?,?,?)',
        [indicatorId, t.title, t.description, i]
      );
    }
    console.log(`✓ 傳導機制「${t.title}」`);
  }
}

async function seedAnalysisPrinciples() {
  const [existingRows] = await pool.query('SELECT COUNT(*) AS c FROM macro_analysis_principles');
  if (existingRows[0].c > 0) {
    console.log('macro_analysis_principles 已有資料，清空後重新匯入以維持與 md 一致');
    await pool.query('DELETE FROM macro_analysis_principles');
  }
  for (let i = 0; i < ANALYSIS_PRINCIPLES.length; i++) {
    const p = ANALYSIS_PRINCIPLES[i];
    await pool.query(
      'INSERT INTO macro_analysis_principles (principle, source_case, sort_order) VALUES (?,?,?)',
      [p.principle, p.source_case, i]
    );
  }
  console.log(`✓ 匯入 ${ANALYSIS_PRINCIPLES.length} 條分析原則`);
}

async function seedFrameworkNotes() {
  for (let i = 0; i < FRAMEWORK_NOTES.length; i++) {
    const n = FRAMEWORK_NOTES[i];
    await pool.query(
      `INSERT INTO macro_framework_notes (section_key, title, content, sort_order)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content), sort_order=VALUES(sort_order)`,
      [n.section_key, n.title, n.content, i]
    );
    console.log(`✓ 框架說明「${n.title}」`);
  }
}

async function main() {
  console.log('開始匯入總經分析框架...\n');
  const nameToId = await seedIndicators();
  console.log('');
  await seedTransmissionNotes(nameToId);
  console.log('');
  await seedAnalysisPrinciples();
  console.log('');
  await seedFrameworkNotes();
  console.log('\n完成！');
  process.exit(0);
}

main().catch(e => {
  console.error('匯入失敗:', e);
  process.exit(1);
});
