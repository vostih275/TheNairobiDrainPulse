const mongoose = require('mongoose');

const DrainNodeSchema = new mongoose.Schema({
  nodeId: { type: String, required: true, unique: true },
  locationName: { type: String, required: true },
  location: {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  county: { type: String, required: true, default: 'Nairobi' },
  subCounty: { type: String, required: true },
  ward: { type: String, required: true },
  elevationMeters: { type: Number, required: true },
  catchmentAreaSqKm: { type: Number, default: 1.5 },
  surfaceType: { type: String, enum: ['paved', 'grass', 'bare', 'urbanMixed'], default: 'urbanMixed' },
  drainCrossSectionAreaSqM: { type: Number, required: true },
  catchmentBasinId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatchmentBasin', required: true },
  maxDrainCapacityMm: { type: Number, required: true },
  emptyDistanceMm: { type: Number, required: true, default: 1800 },
  status: { type: String, enum: ['Optimal', 'Maintenance Required', 'Offline'], default: 'Optimal' },
  lastSeen: { type: Date, default: Date.now }
});

DrainNodeSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('DrainNode', DrainNodeSchema);
