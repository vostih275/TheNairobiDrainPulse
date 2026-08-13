const { decodePayload } = require('./src/lib/decoder');

const TEST_CASES = [
  {
    label: 'Spec payload: Distance=500mm, Bat=180(3.6V), Flags=1(Blocked), Speed=30cm/s',
    hex: '01F4B401001E',
    expected: { distance: 500, battery: 3.6, isBlocked: true, isTampered: false, flowSpeed: 30 }
  },
  {
    label: 'DRY: Distance=1750mm, Bat=175(3.5V), Flags=0, Speed=5cm/s',
    hex: (() => {
      const b = Buffer.alloc(6);
      b.writeUInt16BE(1750, 0); b.writeUInt8(175, 2); b.writeUInt8(0, 3); b.writeInt16BE(5, 4);
      return b.toString('hex');
    })(),
    expected: { distance: 1750, battery: 3.5, isBlocked: false, isTampered: false, flowSpeed: 5 }
  },
  {
    label: 'TAMPERED: Distance=900mm, Bat=160(3.2V), Flags=4(Tilt/Tamper), Speed=-10cm/s',
    hex: (() => {
      const b = Buffer.alloc(6);
      b.writeUInt16BE(900, 0); b.writeUInt8(160, 2); b.writeUInt8(4, 3); b.writeInt16BE(-10, 4);
      return b.toString('hex');
    })(),
    expected: { distance: 900, battery: 3.2, isBlocked: false, isTampered: true, flowSpeed: -10 }
  },
  {
    label: 'FLASH_FLOOD: Distance=100mm, Bat=150(3.0V), Flags=5(Blocked+Tampered), Speed=250cm/s',
    hex: (() => {
      const b = Buffer.alloc(6);
      b.writeUInt16BE(100, 0); b.writeUInt8(150, 2); b.writeUInt8(5, 3); b.writeInt16BE(250, 4);
      return b.toString('hex');
    })(),
    expected: { distance: 100, battery: 3.0, isBlocked: true, isTampered: true, flowSpeed: 250 }
  }
];

let passed = 0;
let failed = 0;

console.log('\n=== DrainPulse Decoder Validation ===\n');

for (const tc of TEST_CASES) {
  try {
    const result = decodePayload(tc.hex);
    const checks = Object.entries(tc.expected).map(([key, val]) => {
      const ok = result[key] === val;
      if (!ok) return `  FAIL: ${key} expected=${val} got=${result[key]}`;
      return `  OK:   ${key} = ${result[key]}`;
    });
    const allOk = checks.every(c => c.startsWith('  OK'));
    console.log(`[${allOk ? 'PASS' : 'FAIL'}] ${tc.label}`);
    console.log(`  HEX: ${tc.hex.toUpperCase()}`);
    checks.forEach(c => console.log(c));
    allOk ? passed++ : failed++;
  } catch (err) {
    console.log(`[ERROR] ${tc.label}: ${err.message}`);
    failed++;
  }
  console.log('');
}

console.log(`=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
