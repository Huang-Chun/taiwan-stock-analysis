require('dotenv').config();
const { pool } = require('./connection');

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sector_stock_sections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        subgroup_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        sort_order INT DEFAULT 0,
        FOREIGN KEY (subgroup_id) REFERENCES sector_subgroups(id) ON DELETE CASCADE
      )
    `);
    // Add section_id to sector_stocks if not exists
    const [cols] = await conn.query(`SHOW COLUMNS FROM sector_stocks LIKE 'section_id'`);
    if (!cols.length) {
      await conn.query(`ALTER TABLE sector_stocks ADD COLUMN section_id INT NULL`);
      await conn.query(`ALTER TABLE sector_stocks ADD CONSTRAINT fk_stock_section FOREIGN KEY (section_id) REFERENCES sector_stock_sections(id) ON DELETE SET NULL`);
    }
    console.log('Sector sections migration done.');
  } finally {
    conn.release();
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
