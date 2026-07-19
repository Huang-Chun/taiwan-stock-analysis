/**
 * 從 data/sectors.json 匯入/更新 sector_groups / sector_subgroups /
 * sector_stock_sections / sector_stocks 四張表。
 * 採用「清空後重建」策略，確保資料與 JSON 完全一致。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/database/connection');

async function main() {
  const jsonPath = path.join(__dirname, '../data/sectors.json');
  const { groups } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 清空舊資料（FK 順序：子表先刪）
    await conn.query('DELETE FROM sector_stocks');
    await conn.query('DELETE FROM sector_stock_sections');
    await conn.query('DELETE FROM sector_subgroups');
    await conn.query('DELETE FROM sector_groups');
    console.log('✓ 舊資料已清除');

    for (const group of groups) {
      const [gRes] = await conn.query(
        'INSERT INTO sector_groups (name, sort_order) VALUES (?, ?)',
        [group.name, group.sort_order ?? 0]
      );
      const groupId = gRes.insertId;
      console.log(`\n群組「${group.name}」(id=${groupId})`);

      for (const sub of group.subgroups ?? []) {
        const [sRes] = await conn.query(
          'INSERT INTO sector_subgroups (group_id, name, description, sort_order) VALUES (?, ?, ?, ?)',
          [groupId, sub.name, sub.description ?? null, sub.sort_order ?? 0]
        );
        const subId = sRes.insertId;
        console.log(`  子群組「${sub.name}」(id=${subId})`);

        // sections
        const sectionNameToId = {};
        for (const sec of sub.sections ?? []) {
          const [secRes] = await conn.query(
            'INSERT INTO sector_stock_sections (subgroup_id, name, sort_order) VALUES (?, ?, ?)',
            [subId, sec.name, sec.sort_order ?? 0]
          );
          sectionNameToId[sec.name] = secRes.insertId;
          console.log(`    分區「${sec.name}」(id=${secRes.insertId})`);
        }

        // stocks
        let skipped = 0;
        for (const s of sub.stocks ?? []) {
          // 確認股票存在
          const [[row]] = await conn.query(
            'SELECT stock_id FROM stocks WHERE stock_id = ?', [s.stock_id]
          );
          if (!row) {
            console.warn(`    ⚠ ${s.stock_id} 不在 stocks 表，跳過`);
            skipped++;
            continue;
          }
          const sectionId = s.section_name ? (sectionNameToId[s.section_name] ?? null) : null;
          await conn.query(
            'INSERT INTO sector_stocks (subgroup_id, stock_id, sort_order, section_id) VALUES (?, ?, ?, ?)',
            [subId, s.stock_id, s.sort_order ?? 0, sectionId]
          );
        }
        const added = (sub.stocks?.length ?? 0) - skipped;
        console.log(`    股票：${added} 筆${skipped ? `（跳過 ${skipped} 筆）` : ''}`);
      }
    }

    await conn.commit();
    console.log('\n✓ sectors.json 匯入完成');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    process.exit(0);
  }
}

main().catch(e => {
  console.error('匯入失敗:', e.message);
  process.exit(1);
});
