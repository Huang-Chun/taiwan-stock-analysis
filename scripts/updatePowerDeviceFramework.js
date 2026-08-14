// One-off script: rewrite 功率元件 (industry_map_id=7) Chapter 0 as pure technical
// background (no company names), and link each covered company's business_notes
// back to the concepts introduced there.
require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 3000}`;

const techBackground = `## 基本功能：功率元件是做什麼用的

想像電路裡的電流像水流。功率元件不處理「資訊」（那是CPU、記憶體在做的事），它處理的是**電力本身**——控制電要不要流、流多少、電壓要不要降下來。任何晶片都需要乾淨、穩定、適當電壓的電才能運作，功率元件就是負責把電源供應器送來的電，加工成晶片能用的樣子。

## 元件分類：二極體/整流器 vs. MOSFET

- **二極體/整流器**：像一個「只能單向開的水閘門」，讓電流只能往一個方向流，不能逆流。不需要外部訊號控制它，裝上去就自動運作。用途通常是保護電路（擋住不該流過來的反向電流）或做基本整流。
- **MOSFET**（全名 Metal-Oxide-Semiconductor Field-Effect Transistor，金屬氧化物半導體場效電晶體）：像一個「可以被遙控開關大小的水龍頭」，需要一個額外的控制訊號（叫「閘極」）告訴它現在該開多大。因為可以被控制，才能拿來做電壓穩壓、快速調節這種比較複雜的工作，也就是接下來要說的 VRM。

一句話記住差異：**二極體/整流器是「被動、單向、不能調」；MOSFET是「主動、可調、能精細控制」。**

## 二極體子類：蕭特基、TVS、齊納

二極體不是只有「整流」這一種角色，同樣是「單向、不能調」的被動元件，依特性可以再分成好幾種，用途完全不同：

- **蕭特基二極體**（Schottky diode）：順向壓降低、切換速度快，適合做保護電路或輔助穩壓。
- **TVS二極體**（全名 Transient Voltage Suppressor，暫態電壓抑制二極體）：專門吸收瞬間突波（例如電源瞬間飆高），反應速度要求極快，是保護電路裡對抗突波的關鍵元件。
- **齊納二極體**（Zener diode）：功能不是整流也不是防突波，而是「電壓鉗制」——電壓超過特定值就導通，把電壓夾在固定範圍內，常用來當電壓參考基準。

這三種都屬於二極體大類，但用途、製程、單價結構都不一樣，不要因為都叫「二極體」就放進同一個籃子比較。

## 材料比較：Si vs. SiC vs. GaN

晶片材料本身也分好幾種，且不是「新款取代舊款」的關係，而是「不同材料適合不同電壓範圍」：

- **Si**（全名 Silicon，矽）：最普遍、最便宜、技術最成熟，但物理特性在電壓很高或頻率很高的情況下表現比較差。
- **SiC**（全名 Silicon Carbide，碳化矽）：耐高壓（600伏特以上），適合電動車、工業用電這種大電流大電壓場景。
- **GaN**（全名 Gallium Nitride，氮化鎵）：切換速度快、效率高，適合低電壓但要求快速反應的場景（例如快速充電器）。

長期趨勢：**SiC會在「高電壓」這端把Si比下去，GaN會在「低電壓」這端把Si比下去**——Si材料正被兩邊夾擊，這是整個產業的結構性風險，跟哪家公司做得好不好無關。

## 電源設計層級：VRM 與 SPS

- **VRM**（全名 Voltage Regulator Module，電源穩壓模組）：晶片旁邊那一整組負責把電源供應器送來的電，降壓、穩壓、快速調整成晶片能用電壓的零件組合，MOSFET就是裝在這裡面。
- **SPS**（全名 Smart Power Stage，智慧功率級）：VRM裡比較先進的做法，把MOSFET跟控制它的驅動晶片（driver IC）包在一起賣，比單獨賣MOSFET貴、也更難做。

## 護城河來源

功率元件的護城河很少來自材料壟斷（因為主流材料Si很普及），大部分來自**客戶已經認證過這個產品，不會輕易換供應商**——這種認證需要時間累積，不是有錢就能馬上追上，但也不是永久的城牆。長期真正的威脅是材料被換掉（SiC/GaN），不是被同業搶單。`;

const companyNotes = {
  '2481': '台灣最大二極體IDM廠之一，產品組合橫跨前置技術背景中的**整流二極體、蕭特基、TVS**，另外也生產MOSFET、IGBT、SiC元件，不只做蕭特基單一產品線。在GB200中擔任LDO（全名 Low-Dropout Regulator，低壓差穩壓器）輔助電路的反向電流保護角色（蕭特基），不是VRM電源路徑的核心元件。2026年功率元件全面漲價潮中，公司整體產品線都被算入漲價敘事，非單一產品線受惠。',
  '3675': '產品屬於前置技術背景中的**整流器**角色（被動、單向），材料為Si，車用為主，不是VRM電源路徑的核心元件。',
  '8255': '產品屬於前置技術背景中的**整流器**角色（被動、單向），材料為Si，車用為主，不是VRM電源路徑的核心元件。',
  '8261': '產品屬於前置技術背景中的**MOSFET**角色（主動、可調），材料為Si，是VRM（電源穩壓模組）核心電源路徑元件，目前也在往「從賣分立MOSFET升級成賣SPS（智慧功率級）」的產品組合方向轉型。',
};

async function main() {
  const industryId = 7; // 功率元件
  const r = await fetch(`${BASE}/api/industries/${industryId}`);
  const j = await r.json();
  if (!j.success) throw new Error('load industry failed: ' + j.error);
  const current = j.data;

  const putIndustry = await fetch(`${BASE}/api/industries/${industryId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: current.name,
      tech_background_notes: techBackground,
      taiwan_participation_notes: current.taiwan_participation_notes,
      customer_relationship_notes: current.customer_relationship_notes,
      open_gaps: current.open_gaps,
    }),
  });
  console.log('industry tech_background_notes updated:', (await putIndustry.json()).success);

  for (const [stockId, note] of Object.entries(companyNotes)) {
    const r2 = await fetch(`${BASE}/api/stocks/${stockId}/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_notes: note }),
    });
    const j2 = await r2.json();
    console.log(stockId, 'business_notes updated:', j2.success);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
