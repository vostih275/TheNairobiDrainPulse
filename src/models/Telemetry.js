const mongoose = require('mongoose');

const TelemetrySchema = new mongoose.Schema({
  nodeId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  rawPayload: { type: String, required: true },
  distance: { type: Number, required: true },
  waterDepth: { type: Number, required: true },
  battery: { type: Number, required: true },
  flowSpeed: { type: Number, required: true },
  rssi: { type: Number },
  snr: { type: Number },
  isBlocked: { type: Boolean, default: false },
  isTampered: { type: Boolean, default: false },
  drainHealthScore: { type: Number, required: true }
});

TelemetrySchema.index({ nodeId: 1, timestamp: -1 });

module.exports = mongoose.model('Telemetry', TelemetrySchema);
