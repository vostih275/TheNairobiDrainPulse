const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { generateReport, LATEST_REPORT } = require('../workers/reportGenerator');

router.get('/latest', async (req, res) => {
  try {
    await generateReport();
    if (!fs.existsSync(LATEST_REPORT)) {
      return res.status(500).json({ error: 'Report was not generated' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="drainpulse-report.pdf"');
    res.sendFile(LATEST_REPORT);
  } catch (err) {
    console.error('[REPORTS]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
