function decodePayload(hexString) {
  const buffer = Buffer.from(hexString, 'hex');
  if (buffer.length !== 6) throw new Error('Payload must be exactly 6 bytes');

  const distance = buffer.readUInt16BE(0);
  const rawBattery = buffer.readUInt8(2);
  const battery = parseFloat((rawBattery * 0.02).toFixed(2));

  const flags = buffer.readUInt8(3);
  const isBlocked = (flags & 0x01) !== 0;
  const isTampered = (flags & 0x04) !== 0;

  const flowSpeed = buffer.readInt16BE(4);

  return { distance, battery, isBlocked, isTampered, flowSpeed };
}

module.exports = { decodePayload };
