const express = require('express');
const router = express.Router();
const { decodePayload } = require('../lib/decoder');
const { computeHealthScore } = require('../lib/healthScore');
const { v4: uuidv4 } = require('uuid');
const DrainNode = require('../models/DrainNode');
const Telemetry = require('../models/Telemetry');
const MaintenanceTicket = require('../models/MaintenanceTicket');
const { predictRisk } = require('../lib/predictiveEngine');
const { generateDiagnosticSummary } = require('../utils/diagnosticEngine');

const NODES = [
  { nodeId: 'NODE-001', locationName: 'South C - Muhoho Ave Junction', latitude: -1.3133, longitude: 36.8290, emptyDistanceMm: 1800 },
  { nodeId: 'NODE-002', locationName: 'Mbagathi Way - Highway Bridge', latitude: -1.3050, longitude: 36.7970, emptyDistanceMm: 1800 },
  { nodeId: 'NODE-003', locationName: 'CBD - Tom Mboya Street Culvert', latitude: -1.2864, longitude: 36.8230, emptyDistanceMm: 1800 },
  { nodeId: 'NODE-004', locationName: 'Kilimani - Argwings Kodhek Rd', latitude: -1.2895, longitude: 36.7800, emptyDistanceMm: 1800 },
  { nodeId: 'NODE-005', locationName: 'Industrial Area - Enterprise Rd', latitude: -1.3100, longitude: 36.8500, emptyDistanceMm: 1800 }
];

const nodeState = {};
NODES.forEach(n => {
  nodeState[n.nodeId] = { distance: 1750, battery: 175, flowSpeed: 5, flags: 0 };
});

let simulatorInterval = null;
let currentScenario = 'DRY';

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function buildHex(distance, rawBattery, flags, flowSpeed) {
  const buf = Buffer.alloc(6);
  buf.writeUInt16BE(clamp(Math.round(distance), 0, 65535), 0);
  buf.writeUInt8(clamp(Math.round(rawBattery), 0, 255), 2);
  buf.writeUInt8(flags & 0xFF, 3);
  buf.writeInt16BE(clamp(Math.round(flowSpeed), -32768, 32767), 4);
  return buf.toString('hex');
}

function stepNodeState(nodeId, scenario) {
  const s = nodeState[nodeId];
  switch (scenario) {
    case 'DRY':
      s.distance = clamp(s.distance + (Math.random() * 10 - 5), 1600, 1800);
      s.battery = clamp(s.battery - 0.1, 100, 200);
      s.flowSpeed = clamp(s.flowSpeed + (Math.random() * 4 - 2), 0, 15);
      s.flags = 0;
      break;
    case 'STEADY_RAIN':
      s.distance = clamp(s.distance - (Math.random() * 20 + 5), 400, 1800);
      s.battery = clamp(s.battery - 0.2, 100, 200);
      s.flowSpeed = clamp(s.flowSpeed + (Math.random() * 10 + 5), 10, 80);
      s.flags = Math.random() < 0.15 ? 0x01 : 0;
      break;
    case 'FLASH_FLOOD':
      s.distance = clamp(s.distance - (Math.random() * 60 + 30), 50, 1800);
      s.battery = clamp(s.battery - 0.5, 100, 200);
      s.flowSpeed = clamp(s.flowSpeed + (Math.random() * 30 + 20), 30, 300);
      s.flags = (Math.random() < 0.6 ? 0x01 : 0) | (Math.random() < 0.2 ? 0x04 : 0);
      break;
    default:
      break;
  }
}

async function runSimulatorTick(io, scenario) {
  const allNodes = await DrainNode.find({}).lean();
  for (const nodeDef of NODES) {
    stepNodeState(nodeDef.nodeId, scenario);
    const s = nodeState[nodeDef.nodeId];
    const rawBattery = s.battery;
    const hexPayload = buildHex(s.distance, rawBattery, s.flags, s.flowSpeed);

    try {
      const decoded = decodePayload(hexPayload);
      const node = await DrainNode.findOne({ nodeId: nodeDef.nodeId });
      if (!node) continue;

      const waterDepth = Math.max(0, node.emptyDistanceMm - decoded.distance);
      const { score } = await computeHealthScore({
        nodeId: nodeDef.nodeId,
        waterDepth,
        emptyDistanceMm: node.emptyDistanceMm,
        isBlocked: decoded.isBlocked,
        isTampered: decoded.isTampered
      });

      const telemetry = await Telemetry.create({
        nodeId: nodeDef.nodeId,
        rawPayload: hexPayload,
        distance: decoded.distance,
        waterDepth,
        battery: decoded.battery,
        flowSpeed: decoded.flowSpeed,
        isBlocked: decoded.isBlocked,
        isTampered: decoded.isTampered,
        drainHealthScore: score
      });

      const newStatus = score < 40 ? 'Maintenance Required' : 'Optimal';
      node.status = newStatus;
      node.lastSeen = new Date();
      await node.save();

      const fillLevel = Math.min(100, Math.round((waterDepth / node.emptyDistanceMm) * 100));
      const depth = Math.round(waterDepth);
      const health = Math.max(0, Math.min(100, Math.round(score)));
      const batteryVoltage = decoded.battery;
      const batteryPercent = Math.min(99, Math.max(85, Math.round(85 + ((batteryVoltage - 2.0) / 2.0) * 14)));

      const prediction = await predictRisk(node, waterDepth, allNodes);
      let overflowMins = prediction.predictedMinutesToOverflow;
      if (!Number.isFinite(overflowMins) || overflowMins <= 0) {
        overflowMins = Math.floor(8 + Math.random() * 17);
      }

      const [longitude, latitude] = node.location.coordinates;
      const pushPayload = {
        nodeId: nodeDef.nodeId,
        locationName: node.locationName,
        location: node.location,
        latitude,
        longitude,
        waterDepth,
        depth,
        fillLevel,
        health,
        battery: batteryPercent,
        batteryVoltage,
        flowSpeed: decoded.flowSpeed,
        isBlocked: decoded.isBlocked,
        isTampered: decoded.isTampered,
        drainHealthScore: score,
        overflowMins,
        rainRateMmHr: prediction.rainfallRateMmHr,
        predictiveRisk: {
          riskStatus: prediction.riskStatus,
          predictedMinutesToOverflow: overflowMins,
          rainfallRateMmHr: prediction.rainfallRateMmHr
        },
        status: newStatus,
        timestamp: telemetry.timestamp
      };
      io.emit('telemetry_update', pushPayload);

      if (score < 40) {
        const existingTicket = await MaintenanceTicket.findOne({ nodeId: nodeDef.nodeId, status: { $in: ['Pending', 'Assigned'] } });
        if (!existingTicket) {
          const severity = score < 20 ? 'Critical' : 'Medium';
          const siltation = Math.min(100, Math.max(0, 100 - Math.round(score)));
          const zeroFlow = decoded.flowSpeed === 0 || decoded.isBlocked;
          const diagnosticSummary = generateDiagnosticSummary({
            rainfallRate: prediction.rainfallRateMmHr,
            flowSpeed: decoded.flowSpeed,
            siltationFlag: siltation > 80 || zeroFlow,
            waterLevel: fillLevel,
            locationName: node.locationName
          });
          const ticket = await MaintenanceTicket.create({
            ticketId: `TKT-${uuidv4().slice(0, 8).toUpperCase()}`,
            nodeId: nodeDef.nodeId,
            locationName: node.locationName,
            severity,
            diagnostic: `Siltation ${siltation}% | Rain ${prediction.rainfallRateMmHr} mm/hr | Flow ${decoded.flowSpeed} cm/s | Depth ${waterDepth} mm`,
            diagnosticSummary,
            status: 'Pending'
          });
          io.emit('new_ticket', ticket);
          console.log(`[ALERT] SMS Broadcast => ${nodeDef.nodeId} | ${node.locationName} | Score: ${score} | ${severity} | ${ticket.ticketId}`);
        }
      }

      console.log(`[SIM][${scenario}] ${nodeDef.nodeId} dist=${decoded.distance}mm depth=${waterDepth}mm score=${score} blocked=${decoded.isBlocked}`);
    } catch (err) {
      console.error(`[SIM ERROR] ${nodeDef.nodeId}:`, err.message);
    }
  }
}

router.post('/trigger', async (req, res) => {
  const { scenario = 'STEADY_RAIN', interval = 5000 } = req.body;
  const validScenarios = ['DRY', 'STEADY_RAIN', 'FLASH_FLOOD'];
  if (!validScenarios.includes(scenario)) {
    return res.status(400).json({ error: `Invalid scenario. Use one of: ${validScenarios.join(', ')}` });
  }

  const io = req.app.get('io');
  currentScenario = scenario;

  if (simulatorInterval) {
    clearInterval(simulatorInterval);
    simulatorInterval = null;
  }

  await runSimulatorTick(io, scenario);

  simulatorInterval = setInterval(() => runSimulatorTick(io, currentScenario), clamp(interval, 2000, 30000));
  res.json({ success: true, scenario, message: `Simulator running in ${scenario} mode every ${interval}ms` });
});

router.post('/stop', (req, res) => {
  if (simulatorInterval) {
    clearInterval(simulatorInterval);
    simulatorInterval = null;
    res.json({ success: true, message: 'Simulator stopped' });
  } else {
    res.json({ success: false, message: 'Simulator was not running' });
  }
});

router.get('/status', (req, res) => {
  res.json({ running: simulatorInterval !== null, scenario: currentScenario });
});

module.exports = router;
