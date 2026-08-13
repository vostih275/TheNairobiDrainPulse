const mongoose = require('mongoose');

const CatchmentBasinSchema = new mongoose.Schema({
  basinId: { type: String, required: true, unique: true },
  subCounty: { type: String, required: true },
  county: { type: String, required: true, default: 'Nairobi' },
  name: { type: String, required: true },
  geometry: {
    type: { type: String, enum: ['Polygon'], required: true },
    coordinates: { type: [[[Number]]], required: true }
  },
  catchmentAreaSqKm: { type: Number, required: true, default: 5.0 },
  surfaceCoefficients: {
    paved: { type: Number, default: 0.95 },
    grass: { type: Number, default: 0.35 },
    bare: { type: Number, default: 0.65 },
    urbanMixed: { type: Number, default: 0.85 }
  },
  description: { type: String }
});

CatchmentBasinSchema.index({ geometry: '2dsphere' });

module.exports = mongoose.model('CatchmentBasin', CatchmentBasinSchema);
