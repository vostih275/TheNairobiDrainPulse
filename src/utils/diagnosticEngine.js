function generateDiagnosticSummary(telemetryData = {}) {
  const rainfall = Number(telemetryData.rainfall) || 0;
  const flowSpeed = Number(telemetryData.flowSpeed) || 0;
  const waterLevel = Number(telemetryData.waterLevel ?? telemetryData.waterDepth) || 0;
  const capacity = Number(telemetryData.capacity) || 1;
  const siltationFlag = !!telemetryData.siltationFlag || (Number(telemetryData.siltation) > 80);

  if (siltationFlag) {
    return 'Severe siltation/debris blockage detected. Reduced conduit capacity requiring desilting crew.';
  }

  if (rainfall > 50) {
    return `Torrential storm runoff detected (${rainfall.toFixed(1)} mm/hr). Rapid intake saturation.`;
  }

  if (flowSpeed > 200 && rainfall >= 15) {
    return `High hydraulic velocity (${flowSpeed.toFixed(1)} cm/s) causing scouring risk at conduit outlet.`;
  }

  const fillPercent = capacity > 0 ? (waterLevel / capacity) * 100 : 0;
  if (fillPercent > 75) {
    return 'Critical spillover threshold reached. Downstream overflow imminent.';
  }

  if (rainfall >= 15 && rainfall <= 50) {
    return 'Elevated runoff entering catchment; monitoring drainage throughput.';
  }

  return 'Operational within normal parameters. Sensors nominal.';
}

module.exports = { generateDiagnosticSummary };
