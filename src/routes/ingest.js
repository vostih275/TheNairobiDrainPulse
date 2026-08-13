const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { decodePayload } = require('../lib/decoder');
const { computeHealthScore } = require('../lib/healthScore');
const { predictRisk } = require('../lib/predictiveEngine');
const { checkBlockageAnomaly } = require('../lib/anomalyEngine');
const DrainNode = require('../models/DrainNode');
const Telemetry = require('../models/Telemetry');
const MaintenanceTicket = require('../models/MaintenanceTicket');

function requireApiKey(req, res, next) {
  if (req.body && req.body.deviceInfo) return next();
  const expected = process.env.INGEST_API_KEY;
  const provided = (req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || '').toString();
  if (!expected || !provided) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API key' });
  }
  try {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    if (expectedBuf.length !== providedBuf.length) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API key' });
    }
    if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API key' });
    }
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API key' });
  }
  next();
}

function extractRadioMeta(reqBody) {
  const rxInfo = Array.isArray(reqBody.rxInfo) ? reqBody.rxInfo : [];
  const first = rxInfo[0] || {};
  return { rssi: first.rssi, snr: first.snr };
}

async function handleChirpStackV4(req, res) {
  const { deviceInfo, object, rxInfo, data } = req.body;
  const nodeId = deviceInfo?.devEui || deviceInfo?.deviceName;
  if (!nodeId) return res.status(400).json({ error: 'deviceInfo.devEui is required' });

  const node = await DrainNode.findOne({ nodeId });
  const waterDepth = Number(object?.waterDepth ?? 0);
  const battery = Number(object?.battery ?? 0);
  const flowSpeed = Number(object?.flowSpeed ?? 0);
  const isBlocked = Boolean(object?.isBlocked);
  const isTampered = Boolean(object?.isTampered);

  const emptyDistanceMm = node ? node.emptyDistanceMm : 1800;
  const distance = Math.max(0, emptyDistanceMm - waterDepth);

  let score = 100;
  if (node) {
    const health = await computeHealthScore({
      nodeId,
      waterDepth,
      emptyDistanceMm,
      isBlocked,
      isTampered
    });
    score = health.score;
  }

  const { rssi, snr } = extractRadioMeta(req.body);

  const telemetry = await Telemetry.create({
    nodeId,
    rawPayload: data || JSON.stringify(object),
    distance,
    waterDepth,
    battery,
    flowSpeed,
    rssi,
    snr,
    isBlocked,
    isTampered,
    drainHealthScore: score
  });

  const result = {
    nodeId,
    waterDepth,
    battery,
    flowSpeed,
    rssi,
    snr,
    isBlocked,
    isTampered,
    drainHealthScore: score,
    timestamp: telemetry.timestamp
  };

  if (node) {
    const newStatus = score < 70 ? 'Maintenance Required' : 'Optimal';
    node.status = newStatus;
    node.lastSeen = new Date();
    await node.save();

    const allNodes = await DrainNode.find({}).lean();
    const prediction = await predictRisk(node, waterDepth, allNodes);

    const [longitude, latitude] = node.location.coordinates;
    const io = req.app.get('io');
    const pushPayload = {
      nodeId,
      locationName: node.locationName,
      location: node.location,
      latitude,
      longitude,
      county: node.county,
      subCounty: node.subCounty,
      ward: node.ward,
      waterDepth,
      drainHealthScore: score,
      battery,
      flowSpeed,
      rssi,
      snr,
      isBlocked,
      isTampered,
      status: newStatus,
      timestamp: telemetry.timestamp,
      predictiveRisk: prediction
    };
    io.emit('telemetry_update', pushPayload);

    if (prediction.riskStatus === 'CRITICAL_IMPENDING') {
      io.emit('predictiveAlert', {
        nodeId,
        locationName: node.locationName,
        subCounty: node.subCounty,
        ward: node.ward,
        riskStatus: prediction.riskStatus,
        predictedMinutesToOverflow: prediction.predictedMinutesToOverflow,
        waterDepth,
        timestamp: telemetry.timestamp
      });
      console.log(`[PREDICTIVE ALERT] CRITICAL_IMPENDING => Node: ${nodeId} | ${node.locationName} | Overflow in ~${prediction.predictedMinutesToOverflow} min`);
    }

    const anomaly = checkBlockageAnomaly(node, telemetry, prediction.rainfallRateMmHr);
    if (anomaly.isAnomaly) {
      const existingAnomalyTicket = await MaintenanceTicket.findOne({
        nodeId,
        status: { $in: ['Pending', 'Assigned'] },
        notes: { $regex: 'Inverse Flow Anomaly' }
      });
      if (!existingAnomalyTicket) {
        const ticket = await MaintenanceTicket.create({
          ticketId: `TKT-${uuidv4().slice(0, 8).toUpperCase()}`,
          nodeId,
          locationName: node.locationName,
          severity: 'High',
          notes: anomaly.reason,
          status: 'Pending'
        });
        io.emit('new_ticket', ticket);
        console.log(`[ANOMALY ALERT] ${anomaly.reason} | Ticket: ${ticket.ticketId}`);
      }
    }

    if (score < 40) {
      const existingTicket = await MaintenanceTicket.findOne({ nodeId, status: { $in: ['Pending', 'Assigned'] } });
      if (!existingTicket) {
        const severity = score < 20 ? 'Critical' : 'Medium';
        const ticket = await MaintenanceTicket.create({
          ticketId: `TKT-${uuidv4().slice(0, 8).toUpperCase()}`,
          nodeId,
          locationName: node.locationName,
          severity,
          status: 'Pending'
        });
        io.emit('new_ticket', ticket);
        console.log(`[ALERT] SMS Broadcast => Node: ${nodeId} | Location: ${node.locationName} | Score: ${score} | Severity: ${severity} | Ticket: ${ticket.ticketId}`);
      }
    }

    result.predictiveRisk = prediction;
    result.status = newStatus;
  }

  res.json({ success: true, telemetry: result });
}

router.post('/chirpstack', requireApiKey, async (req, res) => {
  try {
    if (req.body.deviceInfo) {
      return await handleChirpStackV4(req, res);
    }
    const { nodeId, payload } = req.body;
    if (!nodeId || !payload) return res.status(400).json({ error: 'nodeId and payload are required' });

    let hexPayload = payload;
    if (/^[A-Za-z0-9+/=]+$/.test(payload) && payload.length % 4 === 0 && !/^[0-9a-fA-F]+$/.test(payload)) {
      hexPayload = Buffer.from(payload, 'base64').toString('hex');
    }

    const node = await DrainNode.findOne({ nodeId });
    if (!node) return res.status(404).json({ error: `Node ${nodeId} not found` });

    const decoded = decodePayload(hexPayload);
    const waterDepth = Math.max(0, node.emptyDistanceMm - decoded.distance);
    const { rssi, snr } = extractRadioMeta(req.body);

    const { score } = await computeHealthScore({
      nodeId,
      waterDepth,
      emptyDistanceMm: node.emptyDistanceMm,
      isBlocked: decoded.isBlocked,
      isTampered: decoded.isTampered
    });

    const telemetry = await Telemetry.create({
      nodeId,
      rawPayload: hexPayload,
      distance: decoded.distance,
      waterDepth,
      battery: decoded.battery,
      flowSpeed: decoded.flowSpeed,
      rssi,
      snr,
      isBlocked: decoded.isBlocked,
      isTampered: decoded.isTampered,
      drainHealthScore: score
    });

    const newStatus = score < 40 ? 'Maintenance Required' : score < 70 ? 'Maintenance Required' : 'Optimal';
    node.status = newStatus;
    node.lastSeen = new Date();
    await node.save();

    const allNodes = await DrainNode.find({}).lean();
    const prediction = await predictRisk(node, waterDepth, allNodes);

    const [longitude, latitude] = node.location.coordinates;
    const io = req.app.get('io');
    const pushPayload = {
      nodeId,
      locationName: node.locationName,
      location: node.location,
      latitude,
      longitude,
      county: node.county,
      subCounty: node.subCounty,
      ward: node.ward,
      waterDepth,
      drainHealthScore: score,
      battery: decoded.battery,
      flowSpeed: decoded.flowSpeed,
      rssi,
      snr,
      isBlocked: decoded.isBlocked,
      isTampered: decoded.isTampered,
      status: newStatus,
      timestamp: telemetry.timestamp,
      predictiveRisk: prediction
    };
    io.emit('telemetry_update', pushPayload);

    if (prediction.riskStatus === 'CRITICAL_IMPENDING') {
      io.emit('predictiveAlert', {
        nodeId,
        locationName: node.locationName,
        subCounty: node.subCounty,
        ward: node.ward,
        riskStatus: prediction.riskStatus,
        predictedMinutesToOverflow: prediction.predictedMinutesToOverflow,
        waterDepth,
        timestamp: telemetry.timestamp
      });
      console.log(`[PREDICTIVE ALERT] CRITICAL_IMPENDING => Node: ${nodeId} | ${node.locationName} | Overflow in ~${prediction.predictedMinutesToOverflow} min`);
    }

    const anomaly = checkBlockageAnomaly(node, telemetry, prediction.rainfallRateMmHr);
    if (anomaly.isAnomaly) {
      const existingAnomalyTicket = await MaintenanceTicket.findOne({
        nodeId,
        status: { $in: ['Pending', 'Assigned'] },
        notes: { $regex: 'Inverse Flow Anomaly' }
      });
      if (!existingAnomalyTicket) {
        const ticket = await MaintenanceTicket.create({
          ticketId: `TKT-${uuidv4().slice(0, 8).toUpperCase()}`,
          nodeId,
          locationName: node.locationName,
          severity: 'High',
          notes: anomaly.reason,
          status: 'Pending'
        });
        io.emit('new_ticket', ticket);
        console.log(`[ANOMALY ALERT] ${anomaly.reason} | Ticket: ${ticket.ticketId}`);
      }
    }

    if (score < 40) {
      const existingTicket = await MaintenanceTicket.findOne({ nodeId, status: { $in: ['Pending', 'Assigned'] } });
      if (!existingTicket) {
        const severity = score < 20 ? 'Critical' : 'Medium';
        const ticket = await MaintenanceTicket.create({
          ticketId: `TKT-${uuidv4().slice(0, 8).toUpperCase()}`,
          nodeId,
          locationName: node.locationName,
          severity,
          status: 'Pending'
        });
        io.emit('new_ticket', ticket);
        console.log(`[ALERT] SMS Broadcast => Node: ${nodeId} | Location: ${node.locationName} | Score: ${score} | Severity: ${severity} | Ticket: ${ticket.ticketId}`);
      }
    }

    res.json({ success: true, telemetry: pushPayload });
  } catch (err) {
    console.error('[INGEST ERROR]', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
