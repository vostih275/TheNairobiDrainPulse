const Vehicle = require('../models/Vehicle');
const MaintenanceTicket = require('../models/MaintenanceTicket');
const DrainNode = require('../models/DrainNode');
const { getBlockageManifest } = require('../utils/blockageClassifier');

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function findEquipmentManifest(nodeLocation, blockageType) {
  if (!nodeLocation || !nodeLocation.coordinates) {
    return { selected: null, bypassed: [] };
  }

  const [lon, lat] = nodeLocation.coordinates;
  const manifest = getBlockageManifest(blockageType);
  const requiredTools = manifest.requiredTools || [];

  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lon, lat] },
        distanceField: 'distanceMeters',
        spherical: true,
        query: { status: { $in: ['Available', 'Dispatched'] } }
      }
    },
    {
      $addFields: {
        hasAllTools: {
          $setIsSubset: [requiredTools, { $ifNull: ['$currentInventory', []] }]
        },
        missingTools: {
          $setDifference: [requiredTools, { $ifNull: ['$currentInventory', []] }]
        }
      }
    },
    {
      $project: {
        vehicleId: 1,
        callSign: 1,
        crewName: 1,
        type: 1,
        status: 1,
        currentInventory: 1,
        distanceMeters: 1,
        hasAllTools: 1,
        missingTools: 1
      }
    },
    { $sort: { hasAllTools: -1, distanceMeters: 1 } }
  ];

  const candidates = await Vehicle.aggregate(pipeline);

  const selected = candidates.find((v) => v.hasAllTools) || null;
  const bypassed = candidates
    .filter((v) => !v.hasAllTools)
    .map((v) => ({
      ...v,
      bypassReason: v.missingTools && v.missingTools.length
        ? `Missing ${v.missingTools.join(', ')}`
        : 'Unknown mismatch'
    }));

  return {
    selected,
    bypassed,
    requiredTools,
    blockageLabel: manifest.label
  };
}

async function dispatchByTicketId(ticketId) {
  const ticket = await MaintenanceTicket.findOne({ ticketId }).lean();
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.status === 'Resolved') throw new Error('Ticket already resolved');

  const node = await DrainNode.findOne({ nodeId: ticket.nodeId }).lean();
  if (!node) throw new Error('Node not found');

  const manifest = await findEquipmentManifest(node.location, ticket.blockageType);
  const selected = manifest.selected;

  const update = {
    assignedVehicle: selected ? selected.vehicleId : null,
    assignedCrew: selected ? selected.crewName : (ticket.assignedCrew || 'Unassigned'),
    equipmentManifest: {
      selected: selected,
      bypassed: manifest.bypassed || []
    },
    status: selected ? 'Dispatched' : 'Pending'
  };

  const updated = await MaintenanceTicket.findOneAndUpdate(
    { ticketId },
    { $set: update },
    { new: true, runValidators: false }
  );

  if (selected) {
    await Vehicle.updateOne(
      { vehicleId: selected.vehicleId },
      { $set: { status: 'Dispatched', lastSeen: new Date() } }
    );
  }

  return { ticket: updated, manifest, selected };
}

module.exports = { findEquipmentManifest, haversineMeters, dispatchByTicketId };
