/**
 * ChirpStack v4 JavaScript payload decoder.
 *
 * This mirrors the 3-byte payload built by the C++ buildPayload() function:
 *   bytes[0..1] = distance in mm, little-endian
 *   bytes[2]    = battery voltage * 10 (0.1 V resolution)
 *
 * @param {{ bytes: number[], fPort: number }} input
 * @returns {{ data: object, warnings: string[], errors: string[] }}
 */
function decodeUplink(input) {
  const bytes = input.bytes;
  if (bytes.length < 3) {
    return {
      data: {},
      warnings: [],
      errors: ['Payload too short, expected at least 3 bytes']
    };
  }

  const distance = (bytes[1] << 8) | bytes[0];
  const battery = bytes[2] / 10.0;

  return {
    data: {
      waterDepth: distance,
      battery: battery
    },
    warnings: [],
    errors: []
  };
}

// Export for local testing and for Node/ChirpStack environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeUplink };
}
