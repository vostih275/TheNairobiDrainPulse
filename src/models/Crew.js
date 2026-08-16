const mongoose = require('mongoose');

const CrewMemberSchema = new mongoose.Schema({
  memberId: { type: String },
  name: { type: String, required: true },
  role: { type: String, required: true },
  pin: { type: String }
});

const CrewSchema = new mongoose.Schema({
  crewName: { type: String, required: true },
  loginIdentifier: { type: String, required: true, unique: true },
  leaderPassword: { type: String, required: true },
  sharedPassword: { type: String, default: null },
  members: [CrewMemberSchema],
  reliabilityScore: { type: Number, default: 100, min: 0, max: 100 },
  avgResolutionMinutes: { type: Number, default: 0 },
  proofCompliance: { type: Number, default: 100, min: 0, max: 100 },
  resolvedTicketsCount: { type: Number, default: 0 },
  lastScoredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Crew', CrewSchema);
