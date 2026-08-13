const express = require('express');
const router = express.Router();
const DrainNode = require('../models/DrainNode');
const Telemetry = require('../models/Telemetry');
const { predictRisk } = require('../lib/predictiveEngine');

router.get('/', async (req, res) => {
  try {
    const { county, subCounty, ward } = req.query;
    const filter = {};
    if (county) filter.county = county;
    if (subCounty) filter.subCounty = subCounty;
    if (ward) filter.ward = ward;

    const nodes = await DrainNode.find(filter).lean();
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:nodeId/predictive-risk', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await DrainNode.findOne({ nodeId }).lean();
    if (!node) return res.status(404).json({ error: `Node ${nodeId} not found` });

    const latest = await Telemetry.findOne({ nodeId }).sort({ timestamp: -1 }).lean();
    const waterDepth = latest ? latest.waterDepth : 0;

    const allNodes = await DrainNode.find({}).lean();
    const risk = await predictRisk(node, waterDepth, allNodes);

    res.json({ nodeId, locationName: node.locationName, waterDepth, ...risk });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
