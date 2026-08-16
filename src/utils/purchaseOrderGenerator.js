const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const ORDERS_DIR = path.join(__dirname, '../../reports/purchase-orders');

function ensureDir() {
  if (!fs.existsSync(ORDERS_DIR)) fs.mkdirSync(ORDERS_DIR, { recursive: true });
}

function formatMoney(amount) {
  return Number(amount).toFixed(2);
}

function generatePurchaseOrder(items) {
  ensureDir();
  const poNumber = `PO-${Date.now()}`;
  const fileName = `${poNumber}.pdf`;
  const filePath = path.join(ORDERS_DIR, fileName);
  const now = new Date();

  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(18).text('DrainPulse Automated Purchase Order', 50, 50);
  doc.fontSize(10).text(`PO Number: ${poNumber}`, 50, 75);
  doc.text(`Date: ${now.toLocaleDateString('en-GB')}`, 50, 90);
  doc.text(`Procurement Manager: ${process.env.PROCUREMENT_EMAIL || 'Not configured'}`, 50, 105);

  doc.moveDown(2);
  doc.fontSize(12).text('Items below minimum threshold', 50, 140);
  doc.moveDown(0.5);

  const startY = 170;
  const rowHeight = 22;
  const colX = [50, 120, 260, 340, 420, 500];
  const headers = ['SKU', 'Name', 'Category', 'Qty', 'Threshold', 'Est. Cost'];

  doc.fontSize(10);
  headers.forEach((h, i) => doc.text(h, colX[i], startY));
  doc.moveTo(50, startY + 14).lineTo(560, startY + 14).stroke();

  let y = startY + 20;
  let total = 0;
  items.forEach((item) => {
    const restockQty = Math.max(item.minimumThreshold, 20);
    const lineCost = restockQty * (item.unitCost || 0);
    total += lineCost;
    doc.text(item.sku, colX[0], y);
    doc.text(item.name.substring(0, 22), colX[1], y);
    doc.text(item.category || '—', colX[2], y);
    doc.text(String(item.quantity), colX[3], y);
    doc.text(String(item.minimumThreshold), colX[4], y);
    doc.text(`KES ${formatMoney(lineCost)}`, colX[5], y);
    y += rowHeight;
  });

  doc.moveDown(2);
  doc.fontSize(12).text(`Estimated Total: KES ${formatMoney(total)}`, 50, y + 10);
  doc.moveDown(1);
  doc.fontSize(10).text('This PO was generated automatically by the DrainPulse inventory monitoring system.', 50);

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ poNumber, filePath, fileName }));
    stream.on('error', reject);
  });
}

module.exports = { generatePurchaseOrder };
