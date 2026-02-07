const mysql = require('mysql2/promise');
require('dotenv').config();

// 建立連接池
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

// 測試連接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✓ 資料庫連接成功');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ 資料庫連接失敗:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  testConnection
};
