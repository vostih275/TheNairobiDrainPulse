const express = require('express');
const CentralInventory = require('../models/Central_Inventory');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const items = await CentralInventory.find({}).sort({ sku: 1 }).lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/low-stock', async (req, res) => {
  try {
    const items = await CentralInventory.find({
      $expr: { $lte: ['$quantity', '$minimumThreshold'] }
    }).sort({ sku: 1 }).lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const item = await CentralInventory.create(req.body);
    res.status(201).json({ success: true, item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:sku', async (req, res) => {
  try {
    const item = await CentralInventory.findOneAndUpdate(
      { sku: req.params.sku },
      { ...req.body, lastUpdated: new Date() },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/consume', async (req, res) => {
  try {
    const { sku, quantity = 1, ticketId, notes } = req.body;
    if (!sku) return res.status(400).json({ error: 'sku is required' });
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const item = await CentralInventory.findOne({ sku });
    if (!item) return res.status(404).json({ error: 'Inventory item not found' });
    if (item.quantity < qty) {
      return res.status(409).json({ error: `Only ${item.quantity} ${item.unit} available` });
    }

    item.quantity -= qty;
    item.lastUpdated = new Date();
    await item.save();

    res.json({
      success: true,
      item,
      consumed: qty,
      ticketId: ticketId || null,
      notes: notes || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
