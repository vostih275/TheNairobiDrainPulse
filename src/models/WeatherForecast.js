const mongoose = require('mongoose');

const DailyForecastSchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD
  precipitationMm: { type: Number, default: 0 },
  maxTempC: { type: Number },
  windSpeedKmh: { type: Number }
});

const WeatherForecastSchema = new mongoose.Schema({
  subCounty: { type: String, required: true },
  source: { type: String, default: 'open-meteo' },
  forecastFor: { type: String, required: true }, // YYYY-MM-DD (run date)
  days: [DailyForecastSchema],
  fetchedAt: { type: Date, default: Date.now }
});

WeatherForecastSchema.index({ subCounty: 1, forecastFor: -1 });

module.exports = mongoose.model('WeatherForecast', WeatherForecastSchema);
