const express = require('express');
const IoT_Asset = require('../models/IoT_Asset');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const assets = await IoT_Asset.find({}).sort({ serialNumber: 1 }).lean();
    res.json(assets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const asset = await IoT_Asset.create(req.body);
    res.status(201).json({ success: true, asset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:serialNumber', async (req, res) => {
  try {
    const asset = await IoT_Asset.findOne({ serialNumber: req.params.serialNumber }).lean();
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:serialNumber/status', async (req, res) => {
  try {
    const { status, nodeId, notes } = req.body;
    const validStatuses = ['in_warehouse', 'installed', 'maintenance_required', 'retired'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${validStatuses.join(', ')}` });
    }
    const update = { status, lastSeen: new Date() };
    if (nodeId != null) update.nodeId = nodeId;
    if (status === 'installed' && !update.installationDate) {
      update.installationDate = new Date();
    }
    if (notes != null) update.notes = notes;

    const asset = await IoT_Asset.findOneAndUpdate(
      { serialNumber: req.params.serialNumber },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json({ success: true, asset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const { serialNumber, action = 'mark_broken', nodeId } = req.body;
    if (!serialNumber) return res.status(400).json({ error: 'serialNumber is required' });

    const statusMap = {
      mark_broken: 'maintenance_required',
      install: 'installed',
      retire: 'retired',
      warehouse: 'in_warehouse'
    };
    const status = statusMap[action];
    if (!status) return res.status(400).json({ error: `Unknown action: ${action}` });

    const update = { status, lastSeen: new Date() };
    if (nodeId != null) update.nodeId = nodeId;
    if (status === 'installed') update.installationDate = new Date();

    const asset = await IoT_Asset.findOneAndUpdate(
      { serialNumber },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, asset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
