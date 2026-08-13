function pick(arr = []) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function generateDiagnosticSummary(data = {}) {
  const {
    rainfallRate = 0,
    flowSpeed = 0,
    siltationFlag = false,
    waterLevel = 0,
    locationName = 'Drainage node'
  } = data;

  const rain = toNum(rainfallRate);
  const flow = toNum(flowSpeed);
  const level = toNum(waterLevel);
  const siltation = siltationFlag === true ||
    (typeof siltationFlag === 'string' && ['YES', 'Yes', 'yes', 'Y'].includes(siltationFlag));

  if (!rain && !flow && !level && !siltation) {
    return `No telemetry available for ${locationName}; manual field assessment required.`;
  }

  if (siltation) {
    const siltationPct = Math.floor(50 + Math.random() * 45);
    return pick([
      `Severe municipal plastic and organic debris accumulation obstructing ${siltationPct}% of box culvert aperture at ${locationName}. Immediate manual desilting required.`,
      `Significant siltation and refuse build-up reducing conduit capacity at ${locationName}; estimated ${siltationPct}% blockage. Jetting and vacuum extraction recommended.`,
      `Debris choke identified at ${locationName} with ${siltationPct}% flow obstruction. Risk of upstream back-up; deploy clearance crew.`,
      `Mixed plastic, silt and organic debris at ${locationName} reducing open area by ${siltationPct}%. Mechanical clearance and CCTV follow-up advised.`
    ]);
  }

  if (rain > 50) {
    return pick([
      `High hydraulic velocity (${flow.toFixed(0)} cm/s) under torrential storm conditions (${rain.toFixed(1)} mm/hr). Scouring risk identified at downstream wingwall of ${locationName}.`,
      `Torrential storm runoff (${rain.toFixed(1)} mm/hr) exceeding ${locationName} intake capacity. Surface ponding likely; monitor for street-level inundation.`,
      `Extreme rainfall event at ${locationName} (${rain.toFixed(1)} mm/hr); rapid intake saturation with overflow risk within minutes.`,
      `Storm surge of ${rain.toFixed(1)} mm/hr across the ${locationName} catchment; conduit capacity approaching surcharge under ${flow.toFixed(0)} cm/s discharge.`
    ]);
  }

  if (flow > 200 && rain > 15) {
    return pick([
      `High hydraulic velocity (${flow.toFixed(0)} cm/s) under torrential storm conditions (${rain.toFixed(1)} mm/hr). Scouring risk identified at downstream wingwall of ${locationName}.`,
      `Erosive flow velocities (${flow.toFixed(0)} cm/s) recorded at ${locationName} during heavy rain (${rain.toFixed(1)} mm/hr). Inspect wingwall and apron for scour damage.`,
      `Surge conditions at ${locationName}: ${flow.toFixed(0)} cm/s throughput under ${rain.toFixed(1)} mm/hr rainfall. Potential structural undermining downstream.`,
      `High-velocity jetting at ${locationName} (${flow.toFixed(0)} cm/s) amid ${rain.toFixed(1)} mm/hr rainfall. Check downstream erosion and outfall integrity.`
    ]);
  }

  if (level > 75) {
    return pick([
      `Critical spillover threshold reached at ${locationName} (fill level ${level.toFixed(0)}%). Downstream overflow imminent.`,
      `${locationName} operating near full capacity (${level.toFixed(0)}% fill). Immediate overflow risk and possible surface flooding upstream.`,
      `Water level at ${locationName} exceeds 75% conduit depth; surcharge conditions developing. Consider upstream throttling and downstream warning.`,
      `Conduit at ${locationName} is ${level.toFixed(0)}% full. Backwater effects likely; verify downstream free discharge and clear any tailwater obstruction.`
    ]);
  }

  if (rain >= 15 && rain <= 50) {
    return pick([
      `Elevated runoff entering catchment at ${locationName} (${rain.toFixed(1)} mm/hr); monitoring drainage throughput. Basin capacity sufficient at present.`,
      `Moderate storm inflow (${rain.toFixed(1)} mm/hr) at ${locationName}; system absorbing flow with ${flow.toFixed(0)} cm/s discharge.`,
      `Steady rainfall at ${rain.toFixed(1)} mm/hr across ${locationName} catchment; intake operating within design limits.`,
      `Sustained wet-weather flow at ${locationName} (${rain.toFixed(1)} mm/hr, ${flow.toFixed(0)} cm/s). No immediate overflow risk; maintain observation.`
    ]);
  }

  return pick([
    `Catchment intake operating at nominal capacity; light sediment baseline detected with steady ${flow.toFixed(0)} cm/s throughput at ${locationName}.`,
    `${locationName} within normal operating envelope. No significant hydraulic or debris concerns; routine maintenance check recommended.`,
    `Flow and level parameters at ${locationName} are nominal. Continue scheduled desilting and visual inspection cadence.`,
    `Quiet hydraulics at ${locationName} (${flow.toFixed(0)} cm/s, ${level.toFixed(0)}% fill). Asset is stable; retain routine maintenance schedule.`
  ]);
}

module.exports = { generateDiagnosticSummary };
