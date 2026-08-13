const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const IMG = path.join(__dirname, 'public/images/drainpulse-logo.png');

async function main() {
  try {
    const ticketsRes = await axios.get(`${BASE}/api/v1/tickets`);
    const pending = ticketsRes.data.find(t => t.status !== 'Resolved' && t.status !== 'Closed');
    if (!pending) {
      console.error('No pending ticket found');
      return;
    }
    console.log('Resolving ticket:', pending.ticketId);

    const form = new FormData();
    form.append('photos', fs.createReadStream(IMG), { filename: 'photo1.png' });
    form.append('photos', fs.createReadStream(IMG), { filename: 'photo2.png' });
    form.append('resolutionNotes', 'Multi photo test');
    form.append('memberId', 'M001');
    form.append('memberName', 'Test Operator');

    const resolveRes = await axios.patch(
      `${BASE}/api/v1/tickets/${pending.ticketId}/resolve`,
      form,
      { headers: form.getHeaders() }
    );
    console.log('Resolve response:', JSON.stringify(resolveRes.data, null, 2));
    if (!resolveRes.data.ticket.photoUrls || resolveRes.data.ticket.photoUrls.length !== 2) {
      throw new Error('Expected 2 photo URLs');
    }
    console.log('PASS: 2 photo URLs saved:', resolveRes.data.ticket.photoUrls);

    const report = require('./src/workers/reportGenerator');
    const reportPath = await report.generateReport();
    console.log('PASS: Report generated at', reportPath);
  } catch (err) {
    console.error('FAIL:', err.response?.data || err.message);
    process.exit(1);
  }
}

main();
