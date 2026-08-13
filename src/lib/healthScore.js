const Telemetry = require('../models/Telemetry');

async function computeHealthScore({ nodeId, waterDepth, emptyDistanceMm, isBlocked, isTampered }) {
  const fillRatio = waterDepth / emptyDistanceMm;
  const fillPenalty = fillRatio * 60;

  let risePenalty = 0;
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  const prev = await Telemetry.findOne(
    { nodeId, timestamp: { $gte: thirtyMinsAgo } },
    null,
    { sort: { timestamp: -1 } }
  );

  if (prev) {
    const timeDeltaMs = Date.now() - new Date(prev.timestamp).getTime();
    const timeDeltaMin = timeDeltaMs / 60000;
    if (timeDeltaMin > 0) {
      const riseRate = (waterDepth - prev.waterDepth) / timeDeltaMin;
      if (riseRate > 10) {
        risePenalty = Math.min(40, riseRate * 2);
      }
    }
  }

  const score = Math.max(
    0,
    Math.round(100 - fillPenalty - risePenalty - (isBlocked ? 20 : 0) - (isTampered ? 10 : 0))
  );

  return { score, fillPenalty, risePenalty };
}

module.exports = { computeHealthScore };
