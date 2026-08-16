const { v4: uuidv4 } = require('uuid');
const WeatherForecast = require('../models/WeatherForecast');
const MaintenanceTicket = require('../models/MaintenanceTicket');
const Telemetry = require('../models/Telemetry');
const DrainNode = require('../models/DrainNode');

const RAIN_THRESHOLD_MM = 20; // daily precipitation that triggers inspection
const SiltATION_LOOKBACK_DAYS = 14;
const HEALTH_SCORE_THRESHOLD = 50;

async function fetchHighSiltationNodes(subCounty) {
  const since = new Date(Date.now() - SiltATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const nodes = await DrainNode.find({ subCounty }).lean();
  const nodeIds = nodes.map(n => n.nodeId);

  const healthAgg = await Telemetry.aggregate([
    { $match: { nodeId: { $in: nodeIds }, timestamp: { $gte: since } } },
    { $group: { _id: '$nodeId', avgHealth: { $avg: '$drainHealthScore' }, blockedCount: { $sum: { $cond: ['$isBlocked', 1, 0] } } } }
  ]);

  const healthByNode = healthAgg.reduce((acc, h) => {
    acc[h._id] = { avgHealth: h.avgHealth, blockedCount: h.blockedCount };
    return acc;
  }, {});

  return nodes.filter(n => {
    const h = healthByNode[n.nodeId] || {};
    return (h.avgHealth !== undefined && h.avgHealth < HEALTH_SCORE_THRESHOLD) || (h.blockedCount || 0) > 0;
  });
}

async function generateInspectionTickets() {
  try {
    const latestForecasts = await WeatherForecast.aggregate([
      { $sort: { subCounty: 1, fetchedAt: -1 } },
      { $group: { _id: '$subCounty', doc: { $first: '$$ROOT' } } }
    ]);

    let created = 0;
    for (const f of latestForecasts) {
      const { subCounty, days, forecastFor } = f.doc;
      const highRiskDays = days.filter(d => d.precipitationMm >= RAIN_THRESHOLD_MM);
      if (!highRiskDays.length) continue;

      const highSiltationNodes = await fetchHighSiltationNodes(subCounty);
      if (!highSiltationNodes.length) continue;

      for (const day of highRiskDays) {
        for (const node of highSiltationNodes) {
          const existing = await MaintenanceTicket.findOne({
            nodeId: node.nodeId,
            blockageType: 'preventive_inspection',
            status: { $in: ['Pending', 'Assigned', 'Dispatched'] },
            forecastDate: day.date
          });
          if (existing) continue;

          const ticketId = `INS-${uuidv4().slice(0, 8).toUpperCase()}`;
          await MaintenanceTicket.create({
            ticketId,
            nodeId: node.nodeId,
            locationName: node.locationName,
            severity: 'Low',
            diagnostic: `Pre-emptive inspection for ${day.precipitationMm} mm rainfall forecast on ${day.date}`,
            diagnosticSummary: `Heavy rainfall forecasted (${day.precipitationMm} mm on ${day.date}). Node ${node.nodeId} has recent siltation/blockage history and needs inspection before the event.`,
            notes: `Forecast trigger: ${day.date} | Source: ${f.doc.source || 'open-meteo'} | Siltation threshold: ${HEALTH_SCORE_THRESHOLD}`,
            blockageType: 'preventive_inspection',
            forecastDate: day.date,
            requiredTools: ['inspection_camera', 'shovel'],
            status: 'Pending'
          });
          created++;
        }
      }
    }

    console.log(`[INSPECTION] Created ${created} pre-emptive inspection ticket(s)`);
    return created;
  } catch (err) {
    console.error('[INSPECTION] Generation failed:', err.message);
    return 0;
  }
}

module.exports = { generateInspectionTickets };
