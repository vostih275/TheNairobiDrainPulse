require('dotenv').config();
const mongoose = require('mongoose');
const DrainNode = require('./models/DrainNode');
const CatchmentBasin = require('./models/CatchmentBasin');

function point(lng, lat) {
  return { type: 'Point', coordinates: [lng, lat] };
}

const BASIN = {
  basinId: 'BASIN-NRB-CENTRAL-001',
  subCounty: 'Central Nairobi',
  county: 'Nairobi',
  name: 'Nairobi Central Drainage Basin',
  catchmentAreaSqKm: 10.0,
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [36.80, -1.34],
      [36.80, -1.25],
      [36.88, -1.25],
      [36.88, -1.34],
      [36.80, -1.34]
    ]]
  },
  surfaceCoefficients: {
    paved: 0.95,
    grass: 0.35,
    bare: 0.65,
    urbanMixed: 0.85
  }
};

const NODES = [
  { nodeId: 'NODE-001', locationName: 'South C Bridge', lng: 36.8322, lat: -1.3211, county: 'Nairobi', subCounty: 'Lang\'ata', ward: 'South C', elevationMeters: 1640, catchmentAreaSqKm: 2.0, surfaceType: 'urbanMixed', drainCrossSectionAreaSqM: 1.5, maxDrainCapacityMm: 1200, emptyDistanceMm: 1800 },
  { nodeId: 'NODE-003', locationName: 'Museum Hill Underpass', lng: 36.8153, lat: -1.2745, county: 'Nairobi', subCounty: 'Westlands', ward: 'Parklands/Highridge', elevationMeters: 1680, catchmentAreaSqKm: 1.8, surfaceType: 'paved', drainCrossSectionAreaSqM: 1.2, maxDrainCapacityMm: 1000, emptyDistanceMm: 1800 },
  { nodeId: 'NODE-005', locationName: 'Industrial Area Enterprise Rd', lng: 36.8520, lat: -1.3090, county: 'Nairobi', subCounty: 'Starehe', ward: 'Landimawe', elevationMeters: 1625, catchmentAreaSqKm: 2.5, surfaceType: 'urbanMixed', drainCrossSectionAreaSqM: 2.0, maxDrainCapacityMm: 1500, emptyDistanceMm: 1800 },
  { nodeId: 'NODE-004', locationName: 'Kilimani Ring Road Drain', lng: 36.7821, lat: -1.2901, county: 'Nairobi', subCounty: 'Dagoretti North', ward: 'Kilimani', elevationMeters: 1710, catchmentAreaSqKm: 1.2, surfaceType: 'paved', drainCrossSectionAreaSqM: 1.0, maxDrainCapacityMm: 900, emptyDistanceMm: 1800 },
  { nodeId: 'NODE-002', locationName: 'Mbagathi Way Junction', lng: 36.8112, lat: -1.3085, county: 'Nairobi', subCounty: 'Lang\'ata', ward: 'Nairobi West', elevationMeters: 1650, catchmentAreaSqKm: 1.5, surfaceType: 'urbanMixed', drainCrossSectionAreaSqM: 1.4, maxDrainCapacityMm: 1100, emptyDistanceMm: 1800 }
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[SEED] Connected to MongoDB');

  // Clean up legacy fields from pre-Sprint-1 schema
  const cleanup = await DrainNode.collection.updateMany(
    {},
    { $unset: { latitude: '', longitude: '', maxDepthMm: '', constituency: '' } }
  );
  console.log(`[SEED] Removed legacy fields from ${cleanup.modifiedCount} nodes`);

  const basin = await CatchmentBasin.findOneAndUpdate(
    { basinId: BASIN.basinId },
    BASIN,
    { upsert: true, new: true }
  );
  console.log(`[SEED] Upserted basin: ${basin.basinId}`);

  for (const node of NODES) {
    await DrainNode.findOneAndUpdate(
      { nodeId: node.nodeId },
      {
        $set: {
          locationName: node.locationName,
          location: point(node.lng, node.lat),
          county: node.county,
          subCounty: node.subCounty,
          ward: node.ward,
          elevationMeters: node.elevationMeters,
          catchmentAreaSqKm: node.catchmentAreaSqKm,
          surfaceType: node.surfaceType,
          drainCrossSectionAreaSqM: node.drainCrossSectionAreaSqM,
          catchmentBasinId: basin._id,
          maxDrainCapacityMm: node.maxDrainCapacityMm,
          emptyDistanceMm: node.emptyDistanceMm
        },
        $unset: { latitude: '', longitude: '', maxDepthMm: '', constituency: '' }
      },
      { upsert: true, new: true }
    );
    console.log(`[SEED] Upserted node: ${node.nodeId} - ${node.locationName}`);
  }
  console.log('[SEED] Done!');
  process.exit(0);
}

seed().catch(err => { console.error('[SEED ERROR]', err); process.exit(1); });
