const mongoose = require('mongoose');

const IoT_AssetSchema = new mongoose.Schema({
  serialNumber: { type: String, required: true, unique: true, index: true },
  assetType: {
    type: String,
    enum: ['sensor', 'gateway', 'camera', 'pump', 'telemetry_unit'],
    required: true
  },
  model: { type: String },
  nodeId: { type: String, default: null },
  status: {
    type: String,
    enum: ['in_warehouse', 'installed', 'maintenance_required', 'retired'],
    default: 'in_warehouse'
  },
  installationDate: { type: Date, default: null },
  warrantyExpiry: { type: Date },
  firmwareVersion: { type: String },
  lastSeen: { type: Date, default: Date.now },
  notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('IoT_Asset', IoT_AssetSchema);
