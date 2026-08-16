const cron = require('node-cron');
const CentralInventory = require('../models/Central_Inventory');
const { generatePurchaseOrder } = require('../utils/purchaseOrderGenerator');
const { sendEmail, getProcurementEmail } = require('../utils/mailer');

async function runDailyProcurementCheck() {
  try {
    const lowStock = await CentralInventory.find({
      $expr: { $lte: ['$quantity', '$minimumThreshold'] }
    }).lean();

    if (lowStock.length === 0) {
      console.log('[PROCUREMENT] No low-stock items today.');
      return;
    }

    console.log(`[PROCUREMENT] ${lowStock.length} item(s) below threshold.`);
    const { poNumber, filePath, fileName } = await generatePurchaseOrder(lowStock);

    const itemList = lowStock
      .map(i => `- ${i.sku} ${i.name}: ${i.quantity}/${i.minimumThreshold} ${i.unit}`)
      .join('\n');

    await sendEmail({
      to: getProcurementEmail(),
      subject: `DrainPulse Purchase Order ${poNumber} – ${lowStock.length} low-stock items`,
      text: `The following items are at or below their minimum thresholds:\n\n${itemList}\n\nA PDF purchase order has been attached.`,
      attachments: [{ filename: fileName, path: filePath }]
    });

    console.log(`[PROCUREMENT] PO ${poNumber} generated and emailed.`);
  } catch (err) {
    console.error('[PROCUREMENT] Daily check failed:', err.message);
  }
}

function startProcurementWorker() {
  // Run every day at 08:00
  cron.schedule('0 8 * * *', runDailyProcurementCheck, { scheduled: true, timezone: 'Africa/Nairobi' });
  console.log('[PROCUREMENT] Scheduled daily low-stock check at 08:00 EAT');

  // Also run once on startup in non-blocking way
  setTimeout(runDailyProcurementCheck, 5000);
}

module.exports = { startProcurementWorker, runDailyProcurementCheck };
