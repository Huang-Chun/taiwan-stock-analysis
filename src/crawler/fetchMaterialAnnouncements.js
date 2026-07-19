/**
 * 官方重大訊息：注意股清單 / 因股價異常波動被要求公佈自結損益 / 財報董事會實際排定日期
 *
 * 資料源（TWSE OpenAPI，皆為「當日」快照，無需參數）：
 * - /announcement/notice      集中市場當日公布注意股票
 * - /opendata/t187ap04_L      上市公司每日重大訊息，從中篩選三種類型：
 *   1. 符合條款第51款 + 含「自結」字樣 → self_disclosure（股價異常波動被要求公佈自結財務數字）
 *   2. 符合條款第31款 + 含「董事會預計召開日期」 → earnings_schedule（財報將提董事會決議的實際排定日期，
 *      比法定截止日 5/15、8/14、11/14、3/31 精準）
 *   3. 符合條款第31款 + 含「提報董事會或經董事會決議日期」（已決議通過） → earnings_announced
 */
const axios = require('axios');
const { pool } = require('../database/connection');

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

// "1150717" → "2026-07-17"
function rocDateToIso(rocStr) {
  if (!rocStr || rocStr.length < 7) return null;
  const year = parseInt(rocStr.slice(0, 3)) + 1911;
  const month = rocStr.slice(3, 5);
  const day = rocStr.slice(5, 7);
  return `${year}-${month}-${day}`;
}

// "115/07/28" → "2026-07-28"
function rocSlashDateToIso(str) {
  const m = str.match(/(\d{3})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  return `${parseInt(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

const CN_QUARTER = { '一': 1, '二': 2, '三': 3, '四': 4, '1': 1, '2': 2, '3': 3, '4': 4 };

// 從「115年第二季」「115年第2季」「民國115年第2季合併財務報告」「2026年第2季」等格式解析出 "2026Q2"
// 年份可能是民國(3碼，如115)或西元(4碼，如2026)，依碼數判斷，不能統一當民國年處理
function parseTargetPeriod(text) {
  const m = text.match(/(\d{3,4})年第?([一二三四1234])季/);
  if (!m) return null;
  const rawYear = parseInt(m[1]);
  const year = m[1].length === 4 ? rawYear : rawYear + 1911;
  const quarter = CN_QUARTER[m[2]];
  return quarter ? `${year}Q${quarter}` : null;
}

async function fetchAttentionStocks() {
  const { data } = await axios.get('https://openapi.twse.com.tw/v1/announcement/notice', { headers: HEADERS, timeout: 20000 });
  if (!Array.isArray(data)) return [];
  return data.filter(r => r.Code && r.Code.trim());
}

async function fetchDailyMaterialFeed() {
  const { data } = await axios.get('https://openapi.twse.com.tw/v1/opendata/t187ap04_L', { headers: HEADERS, timeout: 20000 });
  return Array.isArray(data) ? data : [];
}

function classifyMaterialRecord(r) {
  const clause = r['符合條款'] || '';
  const subject = (r['主旨 '] || r['主旨'] || '').trim();
  const detail = r['說明'] || '';
  const text = subject + detail;

  if (clause.includes('51') && (text.includes('自結') || text.includes('注意交易資訊'))) {
    return { category: 'self_disclosure', subject, detail, eventDate: null, targetPeriod: null };
  }

  if (clause.includes('31') && text.includes('董事會') && (text.includes('財務報告') || text.includes('自結財務'))) {
    const scheduleMatch = detail.match(/董事會預計召開日期[:：]\s*(\d{3}\/\d{2}\/\d{2})/);
    if (scheduleMatch) {
      return {
        category: 'earnings_schedule', subject, detail,
        eventDate: rocSlashDateToIso(scheduleMatch[1]),
        targetPeriod: parseTargetPeriod(detail),
      };
    }
    const decidedMatch = detail.match(/(?:提報董事會或經董事會決議日期|董事會決議日期)[:：]\s*(\d{3}\/\d{2}\/\d{2})/);
    if (decidedMatch) {
      return {
        category: 'earnings_announced', subject, detail,
        eventDate: rocSlashDateToIso(decidedMatch[1]),
        targetPeriod: parseTargetPeriod(detail),
      };
    }
  }

  // 法人說明會（法說會）排程：符合條款第12款，法規要求開會前一日須公告
  if (clause.includes('12') && (text.includes('法人說明會') || text.includes('法說會'))) {
    const callMatch = detail.match(/召開法人說明會之日期[:：]\s*(\d{3}\/\d{2}\/\d{2})/);
    if (callMatch) {
      return {
        category: 'earnings_call', subject, detail,
        eventDate: rocSlashDateToIso(callMatch[1]),
        targetPeriod: parseTargetPeriod(detail),
      };
    }
  }

  return null;
}

/**
 * 抓取並存入資料庫，只保留系統內已存在的股票代號（避免外鍵約束錯誤）
 */
async function syncMaterialAnnouncements() {
  const [validRows] = await pool.query('SELECT stock_id FROM stocks');
  const validIds = new Set(validRows.map(r => r.stock_id));
  const today = new Date().toISOString().slice(0, 10);

  const counts = { attention: 0, self_disclosure: 0, earnings_schedule: 0, earnings_announced: 0, earnings_call: 0 };

  try {
    const attention = await fetchAttentionStocks();
    for (const r of attention) {
      if (!validIds.has(r.Code)) continue;
      const [result] = await pool.query(
        `INSERT IGNORE INTO material_announcements (stock_id, announced_date, category, subject, detail)
         VALUES (?,?,?,?,?)`,
        [r.Code, r.Date ? rocDateToIso(r.Date) || today : today, 'attention',
         `列入當日注意股票（累計次數 ${r.NumberOfAnnouncement || '?'}）`, r.TradingInfoForAttention || null]
      );
      if (result.affectedRows > 0) counts.attention++;
    }
  } catch (e) {
    console.error('[material] 注意股清單抓取失敗:', e.message);
  }

  try {
    const feed = await fetchDailyMaterialFeed();
    for (const raw of feed) {
      const stockId = raw['公司代號'];
      if (!validIds.has(stockId)) continue;
      const classified = classifyMaterialRecord(raw);
      if (!classified) continue;

      const announcedDate = rocDateToIso(raw['發言日期']) || today;
      const [result] = await pool.query(
        `INSERT IGNORE INTO material_announcements (stock_id, announced_date, event_date, target_period, category, subject, detail)
         VALUES (?,?,?,?,?,?,?)`,
        [stockId, announcedDate, classified.eventDate, classified.targetPeriod,
         classified.category, classified.subject, classified.detail]
      );
      if (result.affectedRows > 0) counts[classified.category]++;
    }
  } catch (e) {
    console.error('[material] 重大訊息抓取失敗:', e.message);
  }

  console.log(`[material] 注意股 ${counts.attention}、自結 ${counts.self_disclosure}、財報排程 ${counts.earnings_schedule}、財報已決議 ${counts.earnings_announced}、法說會 ${counts.earnings_call}（新增）`);
  return counts;
}

if (require.main === module) {
  syncMaterialAnnouncements()
    .then(r => { console.log('結果:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { fetchAttentionStocks, fetchDailyMaterialFeed, classifyMaterialRecord, syncMaterialAnnouncements };
