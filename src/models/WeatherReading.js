const mongoose = require('mongoose');

const WeatherReadingSchema = new mongoose.Schema({
  subCounty: { type: String, required: true },
  rainfallRateMmHr: { type: Number, required: true, default: 0 },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WeatherReading', WeatherReadingSchema);
