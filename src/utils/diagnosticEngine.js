function generateDiagnosticSummary(data = {}) {
  const { rainfallRate = 0, flowSpeed = 0, siltationFlag = false, waterLevel = 0 } = data;

  if (siltationFlag === true || siltationFlag === 'YES' || siltationFlag === 'Yes') {
    return "Severe siltation/debris blockage detected. Reduced conduit capacity requiring desilting crew.";
  }
  if (rainfallRate > 50) {
    return `Torrential storm runoff detected (${rainfallRate} mm/hr). Rapid intake saturation.`;
  }
  if (flowSpeed > 200 && rainfallRate > 15) {
    return `High hydraulic velocity (${flowSpeed} cm/s) causing scouring risk at conduit outlet.`;
  }
  if (waterLevel > 75) {
    return "Critical spillover threshold reached. Downstream overflow imminent.";
  }
  if (rainfallRate >= 15 && rainfallRate <= 50) {
    return `Elevated runoff entering catchment (${rainfallRate} mm/hr); monitoring drainage throughput.`;
  }
  return "Operational within normal parameters. Routine maintenance check recommended.";
}

module.exports = { generateDiagnosticSummary };
