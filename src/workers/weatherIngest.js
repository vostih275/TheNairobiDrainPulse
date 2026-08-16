const axios = require('axios');
const cron = require('node-cron');
const DrainNode = require('../models/DrainNode');
const WeatherReading = require('../models/WeatherReading');
const WeatherForecast = require('../models/WeatherForecast');
const { generateInspectionTickets } = require('../utils/inspectionTicketEngine');

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

async function fetchForecastForSubCounty(subCounty) {
  try {
    const node = await DrainNode.findOne({ subCounty }).lean();
    if (!node) return null;
    const [longitude, latitude] = node.location.coordinates;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=precipitation_sum,temperature_2m_max,windspeed_10m_max&timezone=Africa%2FNairobi&forecast_days=7`;
    const res = await axios.get(url, { timeout: 15000 });
    const daily = res.data.daily;
    const today = new Date().toISOString().slice(0, 10);
    const days = [];
    for (let i = 0; i < daily.time.length; i++) {
      days.push({
        date: daily.time[i],
        precipitationMm: Number(daily.precipitation_sum[i]) || 0,
        maxTempC: Number(daily.temperature_2m_max[i]) || null,
        windSpeedKmh: Number(daily.windspeed_10m_max[i]) || null
      });
    }
    return await WeatherForecast.create({
      subCounty,
      source: 'open-meteo',
      forecastFor: today,
      days
    });
  } catch (err) {
    console.error(`[WEATHER FORECAST] Failed for ${subCounty}:`, err.message);
    return null;
  }
}

async function runForecastJob() {
  const subCounties = await DrainNode.distinct('subCounty');
  if (!subCounties.length) return;

  await Promise.all(subCounties.map(fetchForecastForSubCounty));
  console.log(`[WEATHER FORECAST] Fetched 7-day forecast for ${subCounties.length} sub-county(ies)`);

  await generateInspectionTickets();
}

function startWeatherWorker() {
  if (!cron.validate('*/15 * * * *') || !cron.validate('0 6 * * *')) {
    console.error('[WEATHER] Invalid cron schedule');
    return;
  }

  // Run immediately on boot, then every 15 minutes
  runWeatherJob().catch(err => console.error('[WEATHER] Initial job failed:', err.message));
  runForecastJob().catch(err => console.error('[WEATHER] Initial forecast job failed:', err.message));
  cron.schedule('*/15 * * * *', () => {
    runWeatherJob().catch(err => console.error('[WEATHER] Cron job failed:', err.message));
  });
  // Forecast refresh + inspection ticket generation at 06:00 daily
  cron.schedule('0 6 * * *', () => {
    runForecastJob().catch(err => console.error('[WEATHER] Forecast job failed:', err.message));
  });
  console.log('[WEATHER] Worker scheduled every 15 minutes; forecast refresh at 06:00');
}

module.exports = { startWeatherWorker, runWeatherJob, runForecastJob };
