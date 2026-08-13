const Telemetry = require('../models/Telemetry');
const WeatherReading = require('../models/WeatherReading');
const CatchmentBasin = require('../models/CatchmentBasin');

const ELEVATION_DIFF_DIVISOR = 100;
const RATIONAL_METHOD_FACTOR = 0.00278; // converts C * I(mm/hr) * A(km²) to m³/s
const DEFAULT_RUNOFF_COEFFICIENT = 0.85;
const DEFAULT_CATCHMENT_AREA = 1.5;

async function getLatestWeather(subCounty) {
  const reading = await WeatherReading.findOne({ subCounty }).sort({ timestamp: -1 }).lean();
  return reading ? reading.rainfallRateMmHr : 0;
}

function averageElevation(nodes) {
  if (!nodes || nodes.length === 0) return 0;
  return nodes.reduce((sum, n) => sum + n.elevationMeters, 0) / nodes.length;
}

function computeElevationWeight(node, allNodes) {
  const avg = averageElevation(allNodes);
  const diff = avg - node.elevationMeters;
  let weight = 1 + (diff / ELEVATION_DIFF_DIVISOR);
  if (weight < 0.5) weight = 0.5;
  if (weight > 2.0) weight = 2.0;
  return weight;
}

async function computeRateOfRiseMmPerMin(nodeId, currentWaterDepth) {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  const prev = await Telemetry.findOne(
    { nodeId, timestamp: { $gte: thirtyMinsAgo } },
    null,
    { sort: { timestamp: -1 } }
  ).lean();

  if (!prev || prev.waterDepth === undefined) return 0;

  const timeDeltaMs = Date.now() - new Date(prev.timestamp).getTime();
  const timeDeltaMin = timeDeltaMs / 60000;
  if (timeDeltaMin <= 0) return 0;

  return (currentWaterDepth - prev.waterDepth) / timeDeltaMin;
}

async function predictRisk(node, waterDepth, allNodes = []) {
  const currentDepth = Math.max(0, waterDepth || 0);
  const capacity = node.maxDrainCapacityMm;
  const remainingCapacity = capacity - currentDepth;

  const rainfallRate = await getLatestWeather(node.subCounty);

  // Resolve the linked catchment basin for C and A
  const basin = node.catchmentBasinId
    ? await CatchmentBasin.findById(node.catchmentBasinId).lean()
    : null;

  const runoffCoefficient = basin?.surfaceCoefficients?.[node.surfaceType] || DEFAULT_RUNOFF_COEFFICIENT;
  const catchmentAreaSqKm = basin?.catchmentAreaSqKm || node.catchmentAreaSqKm || DEFAULT_CATCHMENT_AREA;

  // Rational Method: Q (m³/s) = 0.00278 * C * I(mm/hr) * A(km²)
  const runoffQ = RATIONAL_METHOD_FACTOR * runoffCoefficient * rainfallRate * catchmentAreaSqKm;

  // Convert flow (m³/s) to vertical water-level rise (mm/min) over the drain cross-section
  const drainCrossSectionAreaSqM = node.drainCrossSectionAreaSqM || 1.0;
  const runoffInflowMmPerMin = (runoffQ / drainCrossSectionAreaSqM) * 1000 * 60;

  const nodesForBaseline = allNodes.length > 0 ? allNodes : [node];
  const elevationWeight = computeElevationWeight(node, nodesForBaseline);

  const rateOfRise = await computeRateOfRiseMmPerMin(node.nodeId, currentDepth);
  const totalRate = rateOfRise + (runoffInflowMmPerMin * elevationWeight);

  let predictedMinutesToOverflow;
  if (remainingCapacity <= 0) {
    predictedMinutesToOverflow = 0;
  } else if (totalRate <= 0) {
    predictedMinutesToOverflow = Infinity;
  } else {
    predictedMinutesToOverflow = remainingCapacity / totalRate;
  }

  let riskStatus;
  if (predictedMinutesToOverflow === Infinity || predictedMinutesToOverflow > 45) {
    riskStatus = 'NORMAL';
  } else if (predictedMinutesToOverflow >= 20) {
    riskStatus = 'ELEVATED';
  } else {
    riskStatus = 'CRITICAL_IMPENDING';
  }

  return {
    runoffQ,
    runoffInflowMmPerMin,
    runoffCoefficient,
    catchmentAreaSqKm,
    rateOfRiseMmPerMin: rateOfRise,
    elevationWeight,
    predictedMinutesToOverflow: Number.isFinite(predictedMinutesToOverflow) ? Math.round(predictedMinutesToOverflow) : null,
    riskStatus,
    rainfallRateMmHr: rainfallRate
  };
}

module.exports = { predictRisk, getLatestWeather, computeElevationWeight, computeRateOfRiseMmPerMin };
