const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function initDatabase() {
  let connection;
  
  try {
    // 先連接到 MySQL（不指定資料庫）
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT
    });

    console.log('✓ 成功連接到 MySQL');

    // 建立資料庫
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✓ 資料庫 ${process.env.DB_NAME} 已建立或已存在`);

    // 使用該資料庫
    await connection.query(`USE ${process.env.DB_NAME}`);

    // 讀取 schema 檔案
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // 分割 SQL 語句（先去除整行註解，避免以註解開頭的敘述被誤判為註解而整段跳過）
    const noComments = schema
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    const statements = noComments
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // 執行每個 SQL 語句
    for (const statement of statements) {
      try {
        await connection.query(statement);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.error('執行 SQL 時發生錯誤:', statement.substring(0, 100));
          throw error;
        }
      }
    }

    console.log('✓ 資料表結構建立完成');
    console.log('\n資料庫初始化成功！');
    console.log('你現在可以執行以下指令：');
    console.log('  npm run fetch-stocks      - 抓取股票清單');
    console.log('  npm run fetch-prices       - 抓取股價資料');
    console.log('  npm run server            - 啟動網頁伺服器');

  } catch (error) {
    console.error('❌ 初始化失敗:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

initDatabase();
