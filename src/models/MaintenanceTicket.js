const mongoose = require('mongoose');

const { dispatchTicket } = require('../services/alertDispatcher');

const MaintenanceTicketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  nodeId: { type: String, required: true },
  locationName: { type: String, required: true },
  severity: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
  notes: { type: String },
  diagnostic: { type: String },
  resolutionNotes: { type: String },
  status: { type: String, enum: ['Pending', 'Assigned', 'Dispatched', 'Resolved'], default: 'Pending' },
  assignedCrew: { type: String, default: 'Unit 4 - Vacuum Truck' },
  beforePhotoUrl: { type: String },
  afterPhotoUrl: { type: String },
  actionAudit: {
    resolvedByMemberId: { type: String },
    resolvedByMemberName: { type: String }
  },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date }
});

MaintenanceTicketSchema.post('save', function (doc) {
  dispatchTicket(doc);
});

module.exports = mongoose.model('MaintenanceTicket', MaintenanceTicketSchema);
