const axios = require('axios');
const { pool } = require('../database/connection');

/**
 * 從台灣證交所抓取上市股票清單
 */
async function fetchStockList() {
  try {
    console.log('開始抓取股票清單...');

    // 使用證交所的股票代號查詢 API
    const url = 'https://isin.twse.com.tw/isin/class_main.jsp?market=1&issuetype=1';
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = response.data;
    const stocks = [];

    // 使用正則表達式找出所有股票代號和名稱
    // 格式：<td>股票代號 股票名稱</td>
    const regex = /(\d{4})\u3000([^\<\u3000]+)/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const stockId = match[1];
      const stockName = match[2].trim();
      
      // 過濾掉 DR、ETF 等非普通股票
      if (stockName && 
          !stockName.includes('DR') && 
          !stockName.includes('存託憑證') &&
          !stockName.includes('ETF') &&
          !stockName.includes('指數股票型')) {
        stocks.push({
          stock_id: stockId,
          stock_name: stockName,
          market_type: '上市'
        });
      }
    }

    console.log(`找到 ${stocks.length} 檔股票`);

    if (stocks.length === 0) {
      console.log('⚠️ 未找到股票，嘗試手動新增幾檔熱門股票...');
      
      // 手動新增一些熱門股票作為示範
      const popularStocks = [
        { stock_id: '2330', stock_name: '台積電', market_type: '上市' },
        { stock_id: '2317', stock_name: '鴻海', market_type: '上市' },
        { stock_id: '2454', stock_name: '聯發科', market_type: '上市' },
        { stock_id: '2412', stock_name: '中華電', market_type: '上市' },
        { stock_id: '2882', stock_name: '國泰金', market_type: '上市' },
        { stock_id: '2881', stock_name: '富邦金', market_type: '上市' },
        { stock_id: '2886', stock_name: '兆豐金', market_type: '上市' },
        { stock_id: '2891', stock_name: '中信金', market_type: '上市' },
        { stock_id: '2303', stock_name: '聯電', market_type: '上市' },
        { stock_id: '2308', stock_name: '台達電', market_type: '上市' }
      ];
      
      stocks.push(...popularStocks);
      console.log(`已新增 ${popularStocks.length} 檔熱門股票`);
    }

    // 寫入資料庫
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const stock of stocks) {
        await connection.query(
          `INSERT INTO stocks (stock_id, stock_name, market_type, is_active)
           VALUES (?, ?, ?, TRUE)
           ON DUPLICATE KEY UPDATE 
           stock_name = VALUES(stock_name),
           market_type = VALUES(market_type),
           updated_at = CURRENT_TIMESTAMP`,
          [stock.stock_id, stock.stock_name, stock.market_type]
        );
      }

      await connection.commit();
      console.log(`✓ 成功寫入 ${stocks.length} 檔股票到資料庫`);

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return stocks;

  } catch (error) {
    console.error('❌ 抓取股票清單失敗:', error.message);
    throw error;
  }
}

// 如果直接執行此檔案
if (require.main === module) {
  fetchStockList()
    .then(() => {
      console.log('完成！');
      process.exit(0);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { fetchStockList };