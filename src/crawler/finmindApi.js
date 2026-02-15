const axios = require('axios');
require('dotenv').config();

const FINMIND_BASE_URL = 'https://api.finmindtrade.com/api/v4/data';

// Sliding window rate limiter: 550 requests per hour (safe margin under 600)
const RATE_LIMIT = 550;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const requestTimestamps = [];

async function waitForRateLimit() {
  const now = Date.now();
  // Remove timestamps older than the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT) {
    const waitMs = requestTimestamps[0] + RATE_WINDOW_MS - now + 100;
    console.log(`FinMind 限速：等待 ${Math.ceil(waitMs / 1000)} 秒...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  requestTimestamps.push(Date.now());
}

/**
 * 呼叫 FinMind API
 * @param {string} dataset - 資料集名稱
 * @param {object} params - 查詢參數 (data_id, start_date, end_date 等)
 * @returns {Array} data 陣列
 */
async function fetchFinMindData(dataset, params = {}) {
  await waitForRateLimit();

  const queryParams = {
    dataset,
    ...params,
  };

  const token = process.env.FINMIND_TOKEN;
  if (token) {
    queryParams.token = token;
  }

  const response = await axios.get(FINMIND_BASE_URL, {
    params: queryParams,
    timeout: 30000,
    validateStatus: () => true, // 不讓 axios 對非 2xx 拋錯，自行處理
  });

  if (response.status !== 200) {
    const msg = response.data?.msg || response.statusText;
    throw new Error(`FinMind API HTTP ${response.status}: ${msg}`);
  }

  if (response.data.status !== 200) {
    throw new Error(`FinMind API 錯誤: ${response.data.msg} (status: ${response.data.status})`);
  }

  return response.data.data;
}

module.exports = { fetchFinMindData };
