/**
 * Inverse anomaly detection: high rainfall + low flow speed + low water depth
 * indicates a possible upstream blockage preventing water from reaching the node.
 */
function checkBlockageAnomaly(node, latestTelemetry, currentRainfall) {
  const rainfallThreshold = 10; // mm/hr
  const flowSpeedThreshold = 5; // cm/s

  const waterDepth = latestTelemetry?.waterDepth ?? 0;
  const flowSpeed = latestTelemetry?.flowSpeed ?? 0;
  const maxCapacity = node?.maxDrainCapacityMm ?? 1800;
  const relativeLowDepth = maxCapacity * 0.4; // below 40% of capacity is "relatively low"

  if (currentRainfall > rainfallThreshold && flowSpeed < flowSpeedThreshold && waterDepth < relativeLowDepth) {
    return {
      isAnomaly: true,
      type: 'BLOCKAGE_SUSPECTED',
      reason: `Inverse Flow Anomaly: Upstream blockage suspected. Rain=${currentRainfall}mm/hr, Flow=${flowSpeed}cm/s, Depth=${waterDepth}mm`,
      rainfall: currentRainfall,
      flowSpeed,
      waterDepth
    };
  }

  return { isAnomaly: false };
}

module.exports = { checkBlockageAnomaly };
