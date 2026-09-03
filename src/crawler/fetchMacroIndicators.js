const { pool } = require('../database/connection');
const { fetchFredData } = require('./fredApi');

/**
 * 查詢 series 所屬的 release_id（用來查發布行事曆）
 */
async function getReleaseId(seriesId) {
  const data = await fetchFredData('series/release', { series_id: seriesId });
  return data.releases?.[0]?.id || null;
}

/**
 * 查詢某個 release 最近的過去公布日（actual）跟下一次公布日（expected）
 * release/dates 的 realtime_start/realtime_end 是「公布日範圍」過濾，不是 vintage，
 * 用一個涵蓋近期的時間窗避免抓到幾十年前的歷史公布紀錄
 */
async function getNextAndLastReleaseDates(releaseId) {
  const today = new Date();
  const windowStart = new Date(today); windowStart.setDate(windowStart.getDate() - 60);
  const windowEnd = new Date(today); windowEnd.setDate(windowEnd.getDate() + 120);
  const fmt = d => d.toISOString().slice(0, 10);

  const data = await fetchFredData('release/dates', {
    release_id: releaseId,
    realtime_start: fmt(windowStart),
    realtime_end: fmt(windowEnd),
    sort_order: 'asc',
    include_release_dates_with_no_data: 'true',
  });

  const dates = (data.release_dates || []).map(d => d.date).sort();
  const todayStr = fmt(today);
  const past = dates.filter(d => d <= todayStr);
  const future = dates.filter(d => d > todayStr);

  return {
    actual_release_date: past.length ? past[past.length - 1] : null,
    expected_date: future.length ? future[0] : null,
  };
}

/**
 * 抓最新一筆觀測值（FRED 缺值以 '.' 表示）
 */
async function getLatestObservation(seriesId) {
  const data = await fetchFredData('series/observations', {
    series_id: seriesId, sort_order: 'desc', limit: 1,
  });
  const obs = data.observations?.[0];
  if (!obs || obs.value === '.') return null;
  return { date: obs.date, value: parseFloat(obs.value) };
}

/**
 * 把觀測日期換算成 period key：每月 'YYYY-MM'，每季 'YYYY-Qn'
 */
function computePeriod(dateStr, frequency) {
  const [y, m] = dateStr.split('-');
  if (frequency && frequency.includes('季')) {
    const q = Math.ceil(parseInt(m, 10) / 3);
    return `${y}-Q${q}`;
  }
  return `${y}-${m}`;
}

/**
 * 同步所有有 fred_series_id 的美股總經指標：抓最新數值 + 下次/上次公布日，
 * upsert 進 macro_indicator_releases（source='fred'）
 */
async function syncMacroIndicators() {
  const [indicators] = await pool.query(
    'SELECT id, name, frequency, fred_series_id, fred_release_id FROM macro_indicators WHERE fred_series_id IS NOT NULL'
  );

  let updated = 0;
  for (const ind of indicators) {
    try {
      let releaseId = ind.fred_release_id;
      if (!releaseId) {
        releaseId = await getReleaseId(ind.fred_series_id);
        if (releaseId) {
          await pool.query('UPDATE macro_indicators SET fred_release_id = ? WHERE id = ?', [releaseId, ind.id]);
        }
      }

      const obs = await getLatestObservation(ind.fred_series_id);
      if (!obs) {
        console.warn(`⚠ ${ind.name}（${ind.fred_series_id}）：無最新觀測值`);
        continue;
      }

      let expectedDate = null, actualReleaseDate = null;
      if (releaseId) {
        const dates = await getNextAndLastReleaseDates(releaseId);
        expectedDate = dates.expected_date;
        actualReleaseDate = dates.actual_release_date;
      }

      const period = computePeriod(obs.date, ind.frequency);

      await pool.query(
        `INSERT INTO macro_indicator_releases
         (indicator_id, period, expected_date, actual_release_date, value, source)
         VALUES (?,?,?,?,?,'fred')
         ON DUPLICATE KEY UPDATE
         expected_date = VALUES(expected_date), actual_release_date = VALUES(actual_release_date),
         value = VALUES(value), source = 'fred'`,
        [ind.id, period, expectedDate, actualReleaseDate, obs.value]
      );

      console.log(`✓ ${ind.name}（${ind.fred_series_id}）：${period} = ${obs.value}`);
      updated++;
    } catch (error) {
      console.error(`✗ ${ind.name}（${ind.fred_series_id}）同步失敗:`, error.message);
    }
  }

  return updated;
}

if (require.main === module) {
  syncMacroIndicators()
    .then(count => { console.log(`完成！共更新 ${count} 個指標。`); process.exit(0); })
    .catch(error => { console.error(error); process.exit(1); });
}

module.exports = { syncMacroIndicators };
