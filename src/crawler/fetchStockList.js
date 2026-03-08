const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { pool } = require('../database/connection');

/**
 * 共用：從 ISIN 頁面抓取股票清單
 * @param {string} url - ISIN 查詢 URL
 * @param {string} defaultMarketType - 若頁面無 market 欄位時的預設值
 */
async function fetchStockListFromISIN(url, defaultMarketType) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    responseType: 'arraybuffer'
  });

  // 網頁編碼為 MS950 (Big5)，需要轉換
  const html = iconv.decode(Buffer.from(response.data), 'big5');
  const $ = cheerio.load(html);
  const stocks = [];

  // 解析表格每一列，欄位順序：頁碼、國際編碼、代號、名稱、市場別、證券別、產業別、日期、CFI、備註
  $('table.h4 tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 7) return;

    const stockId = $(cells[2]).text().trim();
    const stockName = $(cells[3]).text().trim();
    const marketType = $(cells[4]).text().trim() || defaultMarketType;
    const securityType = $(cells[5]).text().trim();
    const industry = $(cells[6]).text().trim();

    // 只保留 4 碼數字的普通股票
    if (!/^\d{4}$/.test(stockId)) return;
    if (securityType !== '股票') return;

    // 過濾掉 DR、ETF 等
    if (stockName.includes('DR') ||
        stockName.includes('存託憑證') ||
        stockName.includes('ETF') ||
        stockName.includes('指數股票型')) return;

    stocks.push({
      stock_id: stockId,
      stock_name: stockName,
      market_type: marketType.trim(),
      industry: industry || null
    });
  });

  return stocks;
}

/**
 * 從台灣證交所抓取上市股票清單（TWSE）
 */
async function fetchTWSEStockList() {
  const url = 'https://isin.twse.com.tw/isin/class_main.jsp?market=1&issuetype=1';
  return fetchStockListFromISIN(url, '上市');
}

/**
 * 從台灣證交所抓取上櫃股票清單（TPEx/OTC）
 */
async function fetchOTCStockList() {
  const url = 'https://isin.twse.com.tw/isin/class_main.jsp?market=2&issuetype=4';
  return fetchStockListFromISIN(url, '上櫃');
}

/**
 * 寫入股票清單到資料庫
 */
async function saveStocksToDb(stocks) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const stock of stocks) {
      await connection.query(
        `INSERT INTO stocks (stock_id, stock_name, market_type, industry, is_active)
         VALUES (?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE
         stock_name = VALUES(stock_name),
         market_type = VALUES(market_type),
         industry = VALUES(industry),
         updated_at = CURRENT_TIMESTAMP`,
        [stock.stock_id, stock.stock_name, stock.market_type, stock.industry]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 同時抓取上市 + 上櫃股票清單並合併寫入資料庫
 */
async function fetchAllStockLists() {
  try {
    console.log('開始抓取股票清單（上市 + 上櫃）...');

    const [twseStocks, otcStocks] = await Promise.all([
      fetchTWSEStockList(),
      fetchOTCStockList()
    ]);

    console.log(`上市: ${twseStocks.length} 檔，上櫃: ${otcStocks.length} 檔`);

    const allStocks = [...twseStocks, ...otcStocks];

    if (allStocks.length === 0) {
      throw new Error('未能取得任何股票資料，請檢查網路連線或網站是否正常');
    }

    await saveStocksToDb(allStocks);
    console.log(`✓ 成功寫入 ${allStocks.length} 檔股票到資料庫（上市 ${twseStocks.length} + 上櫃 ${otcStocks.length}）`);

    return allStocks;
  } catch (error) {
    console.error('❌ 抓取股票清單失敗:', error.message);
    throw error;
  }
}

/**
 * 從台灣證交所抓取上市股票清單（對外相容介面，僅抓上市）
 * @deprecated 建議改用 fetchAllStockLists() 以涵蓋上市 + 上櫃
 */
async function fetchStockList() {
  try {
    console.log('開始抓取股票清單...');

    const stocks = await fetchTWSEStockList();

    console.log(`找到 ${stocks.length} 檔股票`);

    if (stocks.length === 0) {
      throw new Error('未能從 TWSE 取得任何股票資料，請檢查網路連線或網站是否正常');
    }

    await saveStocksToDb(stocks);
    console.log(`✓ 成功寫入 ${stocks.length} 檔股票到資料庫`);

    return stocks;
  } catch (error) {
    console.error('❌ 抓取股票清單失敗:', error.message);
    throw error;
  }
}

// 如果直接執行此檔案
if (require.main === module) {
  fetchAllStockLists()
    .then(() => {
      console.log('完成！');
      process.exit(0);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { fetchStockList, fetchTWSEStockList, fetchOTCStockList, fetchAllStockLists };
