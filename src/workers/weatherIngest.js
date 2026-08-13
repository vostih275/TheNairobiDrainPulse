const axios = require('axios');
const cron = require('node-cron');
const DrainNode = require('../models/DrainNode');
const WeatherReading = require('../models/WeatherReading');

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function generateMockRainfall(subCounty) {
  const now = Date.now();
  const base = (hashString(subCounty) % 25); // 0-24
  const oscillation = Math.sin(now / 600000) * 10;
  const rate = Math.max(0, base + oscillation);
  return Number(rate.toFixed(2));
}

async function fetchRainfallRate(subCounty) {
  if (!OPENWEATHER_API_KEY) {
    return generateMockRainfall(subCounty);
  }
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(subCounty)},KE&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res = await axios.get(url, { timeout: 10000 });
    const rain1h = res.data?.rain?.['1h'] || 0;
    return Number(rain1h.toFixed(2));
  } catch (err) {
    console.error(`[WEATHER] OpenWeatherMap fetch failed for ${subCounty}: ${err.message}. Falling back to mock.`);
    return generateMockRainfall(subCounty);
  }
}

async function runWeatherJob() {
  const subCounties = await DrainNode.distinct('subCounty');
  if (!subCounties.length) {
    console.log('[WEATHER] No subCounties found, skipping weather job.');
    return;
  }

  const timestamp = new Date();
  const results = await Promise.all(
    subCounties.map(async (subCounty) => {
      const rate = await fetchRainfallRate(subCounty);
      const reading = await WeatherReading.create({
        subCounty,
        rainfallRateMmHr: rate,
        timestamp
      });
      return { subCounty, rate, readingId: reading._id };
    })
  );
  console.log(`[WEATHER] Inserted ${results.length} readings at ${timestamp.toISOString()}:`, results.map(r => `${r.subCounty}=${r.rate}mm/hr`).join(', '));
}

function startWeatherWorker() {
  if (!cron.validate('*/15 * * * *')) {
    console.error('[WEATHER] Invalid cron schedule');
    return;
  }

  // Run immediately on boot, then every 15 minutes
  runWeatherJob().catch(err => console.error('[WEATHER] Initial job failed:', err.message));
  cron.schedule('*/15 * * * *', () => {
    runWeatherJob().catch(err => console.error('[WEATHER] Cron job failed:', err.message));
  });
  console.log('[WEATHER] Worker scheduled every 15 minutes');
}

module.exports = { startWeatherWorker, runWeatherJob };
