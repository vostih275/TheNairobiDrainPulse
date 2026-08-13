require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const axios = require('axios');
const Telemetry = require('../src/models/Telemetry');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/drainpulse';
const API_URL = 'http://localhost:3000/api/v1/ingest/chirpstack';

// Mock ChirpStack v4 HTTP integration payload
const payload = {
  deduplicationId: 'test-001',
  time: new Date().toISOString(),
  deviceInfo: {
    tenantId: '00000000-0000-0000-0000-000000000000',
    tenantName: 'Default',
    applicationId: '00000000-0000-0000-0000-000000000000',
    applicationName: 'DrainPulse',
    deviceProfileId: '00000000-0000-0000-0000-000000000000',
    deviceProfileName: 'DrainPulse Node',
    deviceName: 'Test Node',
    devEui: '0011223344556677',
    tags: {}
  },
  devAddr: '00112233',
  adr: true,
  dr: 5,
  fCnt: 1,
  fPort: 1,
  confirmed: false,
  data: '1gYj',
  object: {
    waterDepth: 1750,
    battery: 3.5
  },
  rxInfo: [
    {
      gatewayId: '00112233445566',
      uplinkId: 1,
      time: new Date().toISOString(),
      rssi: -90,
      snr: 7.5,
      channel: 0,
      rfChain: 1,
      gatewayName: 'test-gateway'
    }
  ],
  txInfo: {
    frequency: 868100000,
    modulation: { lora: { bandwidth: 125000, spreadingFactor: 7, codeRate: '4/5' } }
  }
};

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log('[TEST] Connected to MongoDB');

  try {
    const res = await axios.post(API_URL, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log('[TEST] Webhook response:', res.data);
    if (!res.data.success) throw new Error('Ingest endpoint reported failure');

    // Give the server a moment to persist and then verify the record
    await new Promise(resolve => setTimeout(resolve, 250));
    const latest = await Telemetry.findOne({ nodeId: '0011223344556677' }).sort({ timestamp: -1 }).lean();
    if (!latest) throw new Error('Telemetry record not found in database');

    console.log('[TEST] Persisted telemetry record:', latest);
    console.log('[TEST] ✅ ChirpStack v4 E2E webhook simulation passed');
  } catch (err) {
    console.error('[TEST] ❌', err.message);
    if (err.response) console.error('[TEST] Response:', err.response.data);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
