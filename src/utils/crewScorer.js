const Crew = require('../models/Crew');
const MaintenanceTicket = require('../models/MaintenanceTicket');

function minutesBetween(a, b) {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

async function scoreCrew(crewName) {
  const resolved = await MaintenanceTicket.find({
    assignedCrew: crewName,
    status: 'Resolved',
    resolvedAt: { $exists: true, $ne: null },
    createdAt: { $exists: true, $ne: null }
  }).lean();

  if (!resolved.length) {
    return {
      resolvedTicketsCount: 0,
      avgResolutionMinutes: 0,
      proofCompliance: 100,
      reliabilityScore: 100
    };
  }

  const durations = resolved
    .map(t => minutesBetween(t.createdAt, t.resolvedAt))
    .filter(m => Number.isFinite(m) && m >= 0);

  const avgResolutionMinutes = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const withBefore = resolved.filter(t => {
    const photos = t.photoUrls || {};
    const before = Array.isArray(photos.before) ? photos.before.length : (t.beforePhotoUrl ? 1 : 0);
    return before > 0;
  }).length;

  const proofCompliance = Math.round((withBefore / resolved.length) * 100);

  // Resolution score: 100 at 0 min, -1 point per 15 min, floor 0
  const resolutionScore = Math.max(0, 100 - (avgResolutionMinutes / 15));

  // Reliability: 50% resolution, 50% proof compliance
  const reliabilityScore = Math.round((resolutionScore * 0.5) + (proofCompliance * 0.5));

  return {
    resolvedTicketsCount: resolved.length,
    avgResolutionMinutes,
    proofCompliance,
    reliabilityScore
  };
}

async function updateCrewScores(crewName) {
  const crew = await Crew.findOne({ crewName });
  if (!crew) return null;

  const metrics = await scoreCrew(crewName);
  crew.resolvedTicketsCount = metrics.resolvedTicketsCount;
  crew.avgResolutionMinutes = metrics.avgResolutionMinutes;
  crew.proofCompliance = metrics.proofCompliance;
  crew.reliabilityScore = metrics.reliabilityScore;
  crew.lastScoredAt = new Date();
  await crew.save();
  return crew;
}

async function computeLeaderboard() {
  const crews = await Crew.find({}).lean();
  const withScores = [];
  for (const crew of crews) {
    const metrics = await scoreCrew(crew.crewName);
    withScores.push({
      ...crew,
      ...metrics
    });
  }
  return withScores.sort((a, b) => b.reliabilityScore - a.reliabilityScore);
}

module.exports = { scoreCrew, updateCrewScores, computeLeaderboard };
