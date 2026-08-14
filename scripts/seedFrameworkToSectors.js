/**
 * 把 data/framework.json 的 industries / companies 匯入 sectors 表。
 * 建立一個新 group「供應鏈研究框架」，每個 industry 為 subgroup，
 * 公司的 layer 欄位（有值者）作為 section 分區。
 *
 * 若群組已存在則先刪除舊的再重建（保留其他群組不動）。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/database/connection');

const GROUP_NAME = '供應鏈研究框架';

async function main() {
  const jsonPath = path.join(__dirname, '../data/framework.json');
  const { industries, companies } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // 以 industry_name 為 key，整理公司清單
  const companyByIndustry = {};
  for (const c of companies) {
    if (!companyByIndustry[c.industry_name]) companyByIndustry[c.industry_name] = [];
    companyByIndustry[c.industry_name].push(c);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 若舊群組存在就刪除（FK cascade 會清子表）
    const [[existing]] = await conn.query(
      'SELECT id FROM sector_groups WHERE name = ?', [GROUP_NAME]
    );
    if (existing) {
      // 取得所有 subgroup ids
      const [subs] = await conn.query(
        'SELECT id FROM sector_subgroups WHERE group_id = ?', [existing.id]
      );
      const subIds = subs.map(s => s.id);
      if (subIds.length) {
        await conn.query(`DELETE FROM sector_stocks WHERE subgroup_id IN (?)`, [subIds]);
        await conn.query(`DELETE FROM sector_stock_sections WHERE subgroup_id IN (?)`, [subIds]);
      }
      await conn.query('DELETE FROM sector_subgroups WHERE group_id = ?', [existing.id]);
      await conn.query('DELETE FROM sector_groups WHERE id = ?', [existing.id]);
      console.log(`✓ 舊群組「${GROUP_NAME}」已清除`);
    }

    // 建立新群組
    const [gRes] = await conn.query(
      'INSERT INTO sector_groups (name, sort_order) VALUES (?, ?)',
      [GROUP_NAME, 10]
    );
    const groupId = gRes.insertId;
    console.log(`\n群組「${GROUP_NAME}」(id=${groupId})\n`);

    for (let i = 0; i < industries.length; i++) {
      const ind = industries[i];
      const [sRes] = await conn.query(
        'INSERT INTO sector_subgroups (group_id, name, description, sort_order) VALUES (?, ?, ?, ?)',
        [groupId, ind.name, ind.taiwan_participation_notes ?? null, i]
      );
      const subId = sRes.insertId;
      console.log(`  子群組「${ind.name}」(id=${subId})`);

      const comps = companyByIndustry[ind.name] ?? [];

      // 收集有值的 layer，建立 sections
      const layers = [...new Set(comps.map(c => c.layer).filter(Boolean))];
      const layerToSectionId = {};
      for (const [j, layer] of layers.entries()) {
        const [secRes] = await conn.query(
          'INSERT INTO sector_stock_sections (subgroup_id, name, sort_order) VALUES (?, ?, ?)',
          [subId, layer, j]
        );
        layerToSectionId[layer] = secRes.insertId;
        console.log(`    分區「${layer}」(id=${secRes.insertId})`);
      }

      // 插入股票
      let skipped = 0;
      for (const [k, c] of comps.entries()) {
        const [[row]] = await conn.query(
          'SELECT stock_id FROM stocks WHERE stock_id = ?', [c.stock_id]
        );
        if (!row) {
          console.warn(`    ⚠ ${c.stock_id} 不在 stocks 表，跳過`);
          skipped++;
          continue;
        }
        const sectionId = c.layer ? (layerToSectionId[c.layer] ?? null) : null;
        await conn.query(
          'INSERT INTO sector_stocks (subgroup_id, stock_id, sort_order, section_id) VALUES (?, ?, ?, ?)',
          [subId, c.stock_id, k, sectionId]
        );
      }
      const added = comps.length - skipped;
      console.log(`    股票：${added} 筆${skipped ? `（跳過 ${skipped} 筆）` : ''}`);
    }

    await conn.commit();
    console.log(`\n✓ framework.json → sectors 匯入完成`);
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
