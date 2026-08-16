function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const BLOCKAGE_SIGNATURES = {
  solid_plastic: {
    label: 'Solid Plastic / Refuse Choke',
    requiredTools: ['grapple_claw', 'debris_basket', 'suction_vacuum'],
    description: 'Hard refuse obstruction with little or no flow.'
  },
  organic_silt: {
    label: 'Organic Silt / Sediment Build-up',
    requiredTools: ['suction_vacuum', 'high_pressure_jetter', 'shovel'],
    description: 'Soft sediment and organic sludge reducing conduit capacity.'
  },
  mixed_debris: {
    label: 'Mixed Debris / Severe Choke',
    requiredTools: ['grapple_claw', 'suction_vacuum', 'high_pressure_jetter', 'shovel'],
    description: 'Combined plastic, silt and organic blockage requiring multi-tool clearance.'
  },
  high_volume: {
    label: 'High Hydraulic Volume',
    requiredTools: ['high_capacity_pump', 'sandbags', 'boom'],
    description: 'Surge/flood conditions requiring flow diversion and high-volume pumping.'
  },
  routine: {
    label: 'Routine Inspection',
    requiredTools: ['inspection_camera', 'shovel'],
    description: 'Nominal conditions; routine visual inspection and light clearing.'
  }
};

function classifyBlockage(data = {}) {
  const flow = toNum(data.flowSpeed);
  const level = toNum(data.waterLevel);
  const rain = toNum(data.rainfallRate);
  const siltation = toNum(data.siltation);
  const isBlocked = data.isBlocked === true || data.isBlocked === 'true' || data.isBlocked === 1;
  const zeroFlow = flow <= 1;

  // Order matters: most specific / severe first
  if (isBlocked && zeroFlow) {
    return { blockageType: 'solid_plastic', ...BLOCKAGE_SIGNATURES.solid_plastic, confidence: 0.95 };
  }

  if (siltation > 80 || (siltation > 60 && isBlocked)) {
    return { blockageType: 'mixed_debris', ...BLOCKAGE_SIGNATURES.mixed_debris, confidence: 0.92 };
  }

  if (siltation > 50 && flow < 50) {
    return { blockageType: 'organic_silt', ...BLOCKAGE_SIGNATURES.organic_silt, confidence: 0.85 };
  }

  if (level > 75 || (rain > 50 && flow > 200)) {
    return { blockageType: 'high_volume', ...BLOCKAGE_SIGNATURES.high_volume, confidence: 0.80 };
  }

  return { blockageType: 'routine', ...BLOCKAGE_SIGNATURES.routine, confidence: 0.60 };
}

function getBlockageManifest(blockageType) {
  return BLOCKAGE_SIGNATURES[blockageType] || BLOCKAGE_SIGNATURES.routine;
}

module.exports = { classifyBlockage, getBlockageManifest, BLOCKAGE_SIGNATURES };
