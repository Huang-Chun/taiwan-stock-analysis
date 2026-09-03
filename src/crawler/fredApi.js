const axios = require('axios');
require('dotenv').config();

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred';

// Sliding window rate limiter: FRED 上限是 120 次/分鐘，留餘裕設 100
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60 * 1000; // 1 分鐘
const requestTimestamps = [];

async function waitForRateLimit() {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT) {
    const waitMs = requestTimestamps[0] + RATE_WINDOW_MS - now + 100;
    console.log(`FRED 限速：等待 ${Math.ceil(waitMs / 1000)} 秒...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  requestTimestamps.push(Date.now());
}

/**
 * 呼叫 FRED API
 * @param {string} endpoint - 端點路徑 (e.g. 'series/observations', 'series/release', 'release/dates')
 * @param {object} params - 查詢參數 (series_id, release_id 等)
 * @returns {object} 回應的 JSON 內容
 */
async function fetchFredData(endpoint, params = {}) {
  await waitForRateLimit();

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 FRED_API_KEY，請至 https://fred.stlouisfed.org/docs/api/api_key.html 註冊並寫入 .env');
  }

  const response = await axios.get(`${FRED_BASE_URL}/${endpoint}`, {
    params: { ...params, api_key: apiKey, file_type: 'json' },
    timeout: 30000,
    validateStatus: () => true, // 不讓 axios 對非 2xx 拋錯，自行處理
  });

  if (response.status !== 200) {
    const msg = response.data?.error_message || response.statusText;
    throw new Error(`FRED API HTTP ${response.status}: ${msg}`);
  }

  return response.data;
}

module.exports = { fetchFredData };
