require('dotenv').config();
const { pool } = require('./connection');

async function createSectorTables() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sector_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sector_subgroups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES sector_groups(id) ON DELETE CASCADE
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sector_stocks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        subgroup_id INT NOT NULL,
        stock_id VARCHAR(10) NOT NULL,
        sort_order INT DEFAULT 0,
        FOREIGN KEY (subgroup_id) REFERENCES sector_subgroups(id) ON DELETE CASCADE,
        UNIQUE KEY uq_sub_stock (subgroup_id, stock_id)
      )
    `);
    console.log('Sector tables created.');
  } finally {
    conn.release();
  }
  process.exit(0);
}

createSectorTables().catch(e => { console.error(e); process.exit(1); });
