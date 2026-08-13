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
  members: [CrewMemberSchema]
});

module.exports = mongoose.model('Crew', CrewSchema);
