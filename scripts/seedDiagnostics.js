require('dotenv').config();
const mongoose = require('mongoose');
const MaintenanceTicket = require('../src/models/MaintenanceTicket');
const DrainNode = require('../src/models/DrainNode');
const Telemetry = require('../src/models/Telemetry');
const WeatherReading = require('../src/models/WeatherReading');
const { generateDiagnosticSummary } = require('../src/utils/diagnosticEngine');

const DB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/drainpulse';

async function getLatestRainfall(subCounty) {
  const reading = await WeatherReading.findOne({ subCounty }).sort({ timestamp: -1 }).lean();
  return reading ? reading.rainfallRateMmHr : 0;
}

async function run() {
  await mongoose.connect(DB_URI);
  console.log('[SEED DIAGNOSTICS] Connected to MongoDB');

  const tickets = await MaintenanceTicket.find({
    $or: [
      { diagnosticSummary: { $exists: false } },
      { diagnosticSummary: null },
      { diagnosticSummary: '' }
    ]
  }).lean();

  console.log(`[SEED DIAGNOSTICS] Found ${tickets.length} ticket(s) to backfill`);

  for (const ticket of tickets) {
    try {
      const [node, telemetry] = await Promise.all([
        DrainNode.findOne({ nodeId: ticket.nodeId }).lean(),
        Telemetry.findOne({ nodeId: ticket.nodeId }).sort({ timestamp: -1 }).lean()
      ]);

      const rainfall = node ? await getLatestRainfall(node.subCounty) : 0;
      const siltation = telemetry ? Math.min(100, Math.max(0, 100 - Math.round(telemetry.drainHealthScore))) : 0;
      const zeroFlow = telemetry ? (telemetry.flowSpeed === 0 || telemetry.isBlocked) : false;

      const summary = telemetry && node
        ? generateDiagnosticSummary({
            rainfall,
            flowSpeed: telemetry.flowSpeed,
            waterDepth: telemetry.waterDepth,
            capacity: node.maxDrainCapacityMm,
            siltation,
            siltationFlag: siltation > 80 || zeroFlow
          })
        : (ticket.diagnostic || 'Historical ticket — no live telemetry diagnostic available.');

      await MaintenanceTicket.updateOne(
        { _id: ticket._id },
        { $set: { diagnosticSummary: summary } }
      );
      console.log(`[SEED DIAGNOSTICS] ${ticket.ticketId}: ${summary}`);
    } catch (err) {
      console.error(`[SEED DIAGNOSTICS] ${ticket.ticketId} failed:`, err.message);
    }
  }

  console.log('[SEED DIAGNOSTICS] Done');
  await mongoose.connection.close();
}

run().catch(err => {
  console.error('[SEED DIAGNOSTICS] Fatal error:', err);
  process.exit(1);
});
