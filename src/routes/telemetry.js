const express = require('express');
const router = express.Router();
const Telemetry = require('../models/Telemetry');

router.get('/:nodeId', async (req, res) => {
  try {
    const records = await Telemetry.find({ nodeId: req.params.nodeId })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();
    res.json(records.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
