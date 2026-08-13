require('dotenv').config();
const mongoose = require('mongoose');
const MaintenanceTicket = require('../models/MaintenanceTicket');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const result = await MaintenanceTicket.deleteMany({
      ticketId: { $regex: 'TEST-DIAG', $options: 'i' }
    });
    console.log(`[CLEANUP] Removed ${result.deletedCount} test ticket(s).`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[CLEANUP ERROR]', err.message);
    process.exit(1);
  }
})();
