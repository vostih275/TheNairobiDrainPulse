const mongoose = require('mongoose');

const ToolManifestSchema = new mongoose.Schema({
  blockageType: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  requiredTools: [{ type: String, required: true }],
  description: { type: String }
});

module.exports = mongoose.model('ToolManifest', ToolManifestSchema);
