// One-off script: fill in 功率元件 (industry_map_id=7) five-layer supply chain map
// + 設備 focus layer, sourced from the user's existing Notion page
// "功率元件產業地圖（Power Semiconductor）", and refresh open_gaps to reflect
// what's actually still missing after this import.
require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 3000}`;

const layers = [
  {
    layer: '設備',
    players: 'Si製程設備（離子佈植、蝕刻、擴散爐、曝光機，技術成熟）；SiC晶碇生長爐（頭部廠商自製自用，不對外銷售）；SiC/GaN磊晶爐（少數歐美設備商寡占）',
    scarcity_source: '設備買不買得到、交期多長，決定每一層能多快擴產',
    moat_level: '高（SiC設備段）',
    key_structure: 'SiC晶碇生長爐是SiC供給的物理瓶頸，擴產無法靠錢解決；分析任一層供給彈性時都要回來問「設備買得到嗎、交期多長」',
  },
  {
    layer: '原材料',
    players: '矽（Si，石英砂提煉）、SiC粉末、GaN原材料、銅（封裝導線架）',
    scarcity_source: '地理分布——有錢就買得到，只是價格問題',
    moat_level: '低',
    key_structure: '矽、銅走大宗商品市場定價；SiC粉末、GaN原材料因供應商少屬寡占定價',
  },
  {
    layer: '關鍵材料',
    players: 'SiC晶圓（美國廠主導，中國新進者追趕）、GaN磊晶片（美日台皆有參與）、導線架（壁壘較低）',
    scarcity_source: '製程know-how——有錢也買不到同等品質，只有少數廠商做得出來',
    moat_level: '高（最難複製）',
    key_structure: 'SiC晶圓靠高溫晶碇生長（2000°C以上，長一根要1-2週）後切片，是SiC整條鏈最核心稀缺節點；台灣整體在這層參與有限',
  },
  {
    layer: '零組件製造',
    players: '富鼎8261、強茂2481、德微3675、朋程8255（Si元件主戰場）；SiC/GaN由歐美日IDM主導，台灣結構性缺席',
    scarcity_source: '製程精度＋客戶設計-in——一旦進BOM，重新認證成本高，客戶不輕易換',
    moat_level: '中等',
    key_structure: '材料替代方向是本產業最重要的慢變量：SiC取代高壓段Si、GaN取代低壓段Si',
  },
  {
    layer: '模組整合',
    players: 'PSU：台達電、光寶（台灣強勢）；VRM與SiC模組由國際IDM主導',
    scarcity_source: '系統設計能力＋與終端客戶的規格共同開發關係',
    moat_level: '中高',
    key_structure: '這層是功率元件的直接採購者——PSU/VRM廠決定BOM用誰的元件，是上游元件廠的需求入口',
  },
  {
    layer: '終端產品',
    players: 'AI伺服器（48V架構）、電動車（800V化）、工業設備、再生能源、消費電子',
    scarcity_source: '不適用（需求源頭，非稀缺節點）',
    moat_level: '不適用',
    key_structure: '需求拉力由此往上傳遞，規格要求也由此往上定義',
  },
];

const newOpenGaps = `五層地圖＋設備關注區已從 Notion「功率元件產業地圖」匯入完成（2026-08-12）。
尚待補齊：
- 名詞解釋卡片（MOSFET/Diode/IGBT/Si-SiC-GaN/晶碇/磊晶/VRM/PSU/PFC-LLC，Notion 已有現成速查表）
- 第0章可再補電力流程圖（市電→整流→MOSFET→濾波→儲能→VRM→晶片）與 IGBT/晶碇/磊晶/PSU/PFC-LLC 幾個目前沒收錄的名詞
- 主題中性矩陣、三條因果線（產業層級）、可證偽假設（產業層級）都還沒做
- 強茂/德微/朋程三檔的因果線、可證偽假設、驗證清單都還沒建（目前只有富鼎做完整套）`;

async function main() {
  const industryId = 7;
  const r = await fetch(`${BASE}/api/industries/${industryId}/layers`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layers }),
  });
  console.log('layers saved:', (await r.json()).success);

  const r2 = await fetch(`${BASE}/api/industries/${industryId}`);
  const current = (await r2.json()).data;
  const r3 = await fetch(`${BASE}/api/industries/${industryId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: current.name,
      tech_background_notes: current.tech_background_notes,
      taiwan_participation_notes: current.taiwan_participation_notes,
      customer_relationship_notes: current.customer_relationship_notes,
      open_gaps: newOpenGaps,
    }),
  });
  console.log('open_gaps refreshed:', (await r3.json()).success);
}

main().catch(e => { console.error(e); process.exit(1); });
