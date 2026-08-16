const mongoose = require('mongoose');

const Central_InventorySchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  category: { type: String },
  quantity: { type: Number, required: true, default: 0, min: 0 },
  minimumThreshold: { type: Number, required: true, default: 10, min: 0 },
  unit: { type: String, default: 'pcs' },
  unitCost: { type: Number, default: 0, min: 0 },
  supplierEmail: { type: String },
  preferredSupplier: { type: String },
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

Central_InventorySchema.virtual('isLowStock').get(function () {
  return this.quantity <= this.minimumThreshold;
});

Central_InventorySchema.set('toJSON', { virtuals: true });
Central_InventorySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Central_Inventory', Central_InventorySchema);
