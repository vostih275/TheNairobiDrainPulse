const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
  vehicleId: { type: String, required: true, unique: true },
  callSign: { type: String, required: true },
  crewName: { type: String, required: true },
  type: { type: String, required: true },
  status: {
    type: String,
    enum: ['Available', 'Dispatched', 'Maintenance', 'Offline'],
    default: 'Available'
  },
  location: {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  currentInventory: [{ type: String }],
  capacityKg: { type: Number, default: 5000 },
  lastSeen: { type: Date, default: Date.now }
});

VehicleSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Vehicle', VehicleSchema);
