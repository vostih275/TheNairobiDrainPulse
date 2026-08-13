const express = require('express');
const router = express.Router();
const DrainNode = require('../models/DrainNode');
const Telemetry = require('../models/Telemetry');
const { predictRisk } = require('../lib/predictiveEngine');

router.get('/', async (req, res) => {
  try {
    const nodes = await DrainNode.find({}).lean();
    const predictions = await Promise.all(
      nodes.map(async (node) => {
        const latest = await Telemetry.findOne({ nodeId: node.nodeId })
          .sort({ timestamp: -1 })
          .lean();
        const waterDepth = latest ? latest.waterDepth : 0;
        const prediction = await predictRisk(node, waterDepth, nodes);
        return {
          nodeId: node.nodeId,
          locationName: node.locationName,
          subCounty: node.subCounty,
          coordinates: node.location?.coordinates || [],
          rainfallRateMmHr: prediction.rainfallRateMmHr,
          runoffInflowMmPerMin: prediction.runoffInflowMmPerMin,
          runoffQ: prediction.runoffQ,
          riskStatus: prediction.riskStatus,
          predictedMinutesToOverflow: prediction.predictedMinutesToOverflow
        };
      })
    );
    res.json(predictions);
  } catch (err) {
    console.error('[PREDICTIONS ROUTE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
