/**
 * ============================================================
 *  Nairobi DrainPulse — Edge Node Firmware V1
 *  Target: STM32 / Arduino-compatible MCU
 *  Sensor: JSN-SR04T Waterproof Ultrasonic
 *  Comms:  LoRa-E5 Module (UART AT commands)
 *  Power:  Li-SOCl2 Battery
 * ============================================================
 *
 *  Payload Format (6 bytes, Big-Endian):
 *  ┌────────┬──────────────────────────────────────────────┐
 *  │ Bytes  │ Content                                      │
 *  ├────────┼──────────────────────────────────────────────┤
 *  │  0–1   │ uint16_t  Distance to water surface (mm)     │
 *  │   2    │ uint8_t   Battery level (Volts / 0.02)       │
 *  │   3    │ uint8_t   Flags  [Bit2=Tamper]               │
 *  │  4–5   │ int16_t   Flow speed cm/s (V1: hardcoded 0)  │
 *  └────────┴──────────────────────────────────────────────┘
 */

#include <Arduino.h>

// ── Pin Definitions ─────────────────────────────────────────
#define TRIG_PIN          5    // JSN-SR04T trigger
#define ECHO_PIN          6    // JSN-SR04T echo
#define BAT_SENSE_PIN     A0   // Voltage divider → ADC
#define TAMPER_SWITCH_PIN 7    // Reed switch, Active LOW

// ── Constants ───────────────────────────────────────────────
#define SOUND_SPEED_MM_US 0.343f  // mm per microsecond at ~20 °C
#define ECHO_TIMEOUT_US   30000UL // 30 ms → max ~5 m range; timeout = mud/no-echo guard
#define ADC_SAMPLES       5       // Averaged ADC readings for battery stability
#define ADC_REF_MV        3300UL  // MCU ADC reference voltage in mV (3.3 V)
#define ADC_RESOLUTION    1023UL  // 10-bit ADC
// Voltage divider ratio: R1=100k, R2=100k → ×2 scale factor
#define VDIV_SCALE        2UL
// Battery encoding: raw_byte = Volts / 0.02  → raw_byte = mV / 20
#define BAT_MV_PER_UNIT   20UL

// ── Payload Flag Bits ────────────────────────────────────────
#define FLAG_SILT_BIT     0x01  // Bit 0 — silt buildup  (future sensor)
#define FLAG_PLASTIC_BIT  0x02  // Bit 1 — plastic block (future sensor)
#define FLAG_TAMPER_BIT   0x04  // Bit 2 — tilt / tamper (active in V1)

// ── Deep Sleep Substitute (bench testing) ───────────────────
#define SLEEP_INTERVAL_MS 60000UL  // 60 s between transmissions

// ── LoRa-E5 UART ────────────────────────────────────────────
// The LoRa-E5 is connected on the hardware Serial1 port.
// Adjust to Serial2 / SoftwareSerial if your board differs.
#define LORA_SERIAL Serial1
#define LORA_BAUD   9600

// ── Hex nibble lookup (avoids String / sprintf heap use) ─────
static const char HEX_CHARS[] = "0123456789ABCDEF";

// ============================================================
//  FUNCTION: readDistanceMm
//  Fires the ultrasonic trigger and measures echo duration.
//  Returns distance in mm, or 65535 on timeout (no echo /
//  wave absorbed by mud or debris).
// ============================================================
static uint16_t readDistanceMm(void) {
    // Ensure trigger is low before pulse
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);

    // 10 µs HIGH pulse triggers the sensor burst
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    // pulseIn with 30 ms timeout — returns 0 on timeout
    unsigned long echoDuration = pulseIn(ECHO_PIN, HIGH, ECHO_TIMEOUT_US);

    if (echoDuration == 0) {
        // Timeout: sound wave absorbed (mud, full drain, misalignment)
        return 65535U;
    }

    // Distance = (duration × speed) / 2  (round-trip halved)
    // Result in mm; cast guards against float precision loss on small MCUs
    uint16_t distanceMm = (uint16_t)((float)echoDuration * SOUND_SPEED_MM_US / 2.0f);
    return distanceMm;
}

// ============================================================
//  FUNCTION: readBatteryByte
//  Averages ADC_SAMPLES readings from the voltage-divider
//  output on BAT_SENSE_PIN, reconstructs the full cell voltage,
//  then encodes it as a uint8_t where value = Volts / 0.02.
// ============================================================
static uint8_t readBatteryByte(void) {
    uint32_t adcSum = 0;
    for (uint8_t i = 0; i < ADC_SAMPLES; i++) {
        adcSum += (uint32_t)analogRead(BAT_SENSE_PIN);
        delay(2); // short settle between reads
    }
    uint32_t adcAvg = adcSum / ADC_SAMPLES;

    // Convert ADC count → mV at the divider mid-point
    uint32_t measuredMv = (adcAvg * ADC_REF_MV) / ADC_RESOLUTION;

    // Undo the divider to get actual battery voltage in mV
    uint32_t batteryMv = measuredMv * VDIV_SCALE;

    // Encode: raw_byte = batteryMv / 20  (= Volts / 0.02)
    uint8_t rawByte = (uint8_t)(batteryMv / BAT_MV_PER_UNIT);
    return rawByte;
}

// ============================================================
//  FUNCTION: buildPayload
//  Fills the 6-byte array in strict Big-Endian order.
//
//  Big-Endian bit-shifting logic:
//    For a uint16_t value stored across bytes [MSB, LSB]:
//      payload[0] = (value >> 8) & 0xFF   ← high byte
//      payload[1] = (value)      & 0xFF   ← low byte
//    For a signed int16_t (two's complement, same shift logic):
//      payload[4] = (int16Value >> 8) & 0xFF
//      payload[5] = (int16Value)      & 0xFF
// ============================================================
static void buildPayload(uint8_t payload[6],
                         uint16_t distanceMm,
                         uint8_t  batteryByte,
                         uint8_t  flags,
                         int16_t  flowSpeed) {
    // Bytes 0–1: distance (uint16_t, Big-Endian)
    payload[0] = (uint8_t)((distanceMm >> 8) & 0xFF); // high byte
    payload[1] = (uint8_t)( distanceMm       & 0xFF); // low byte

    // Byte 2: battery
    payload[2] = batteryByte;

    // Byte 3: flags bitmask
    payload[3] = flags;

    // Bytes 4–5: flow speed (int16_t, Big-Endian)
    // Cast to uint16_t before shifting preserves two's complement bits
    payload[4] = (uint8_t)(((uint16_t)flowSpeed >> 8) & 0xFF); // high byte
    payload[5] = (uint8_t)( (uint16_t)flowSpeed       & 0xFF); // low byte
}

// ============================================================
//  FUNCTION: printHexPayload
//  Writes the 6-byte payload as a 12-character uppercase hex
//  string to Serial — no String class, no malloc, no heap use.
// ============================================================
static void printHexPayload(const uint8_t payload[6], uint8_t len) {
    for (uint8_t i = 0; i < len; i++) {
        Serial.print(HEX_CHARS[(payload[i] >> 4) & 0x0F]); // high nibble
        Serial.print(HEX_CHARS[ payload[i]       & 0x0F]); // low  nibble
    }
    Serial.println();
}

// ============================================================
//  FUNCTION: sendLoRaPayload
//  Issues AT+MSGHEX to the LoRa-E5 via UART.
//  Builds the AT command string in a fixed stack buffer —
//  no heap allocation, no String class.
//  Format: AT+MSGHEX="XXXXXXXXXXXX"\r\n
// ============================================================
static void sendLoRaPayload(const uint8_t payload[6], uint8_t len) {
    // Buffer: "AT+MSGHEX=\"" (11) + 12 hex chars + "\"" (1) + \0 = 25 bytes
    char atCmd[26];
    uint8_t pos = 0;

    // Prefix
    const char* prefix = "AT+MSGHEX=\"";
    while (*prefix) atCmd[pos++] = *prefix++;

    // Hex body
    for (uint8_t i = 0; i < len; i++) {
        atCmd[pos++] = HEX_CHARS[(payload[i] >> 4) & 0x0F];
        atCmd[pos++] = HEX_CHARS[ payload[i]       & 0x0F];
    }

    // Closing quote + null terminator
    atCmd[pos++] = '"';
    atCmd[pos]   = '\0';

    LORA_SERIAL.println(atCmd);
    Serial.print(F("[LoRa] TX > "));
    Serial.println(atCmd);
}

// ============================================================
//  SETUP
// ============================================================
void setup(void) {
    Serial.begin(115200);
    while (!Serial && millis() < 3000); // Wait up to 3 s for USB-CDC

    LORA_SERIAL.begin(LORA_BAUD);

    pinMode(TRIG_PIN,          OUTPUT);
    pinMode(ECHO_PIN,          INPUT);
    pinMode(TAMPER_SWITCH_PIN, INPUT_PULLUP); // Active LOW: internal pull-up

    digitalWrite(TRIG_PIN, LOW);

    Serial.println(F("\n========================================"));
    Serial.println(F("  Nairobi DrainPulse Edge Node V1"));
    Serial.println(F("========================================"));
}

// ============================================================
//  MAIN LOOP
// ============================================================
void loop(void) {
    Serial.println(F("\n--- Sensor Cycle Start ---"));

    // 1. Read ultrasonic distance
    uint16_t distanceMm = readDistanceMm();

    // 2. Read & encode battery
    uint8_t batteryByte = readBatteryByte();
    float   batteryV    = batteryByte * 0.02f; // for debug print only

    // 3. Read tamper switch (Active LOW → pin reads LOW when triggered)
    uint8_t flags = 0x00;
    if (digitalRead(TAMPER_SWITCH_PIN) == LOW) {
        flags |= FLAG_TAMPER_BIT; // Set Bit 2
    }

    // 4. Flow speed — V1 hardcoded to 0 (no flow sensor yet)
    int16_t flowSpeed = 0;

    // 5. Build 6-byte payload
    uint8_t payload[6];
    buildPayload(payload, distanceMm, batteryByte, flags, flowSpeed);

    // 6. Debug output to Serial Monitor
    Serial.print(F("  Distance    : "));
    if (distanceMm == 65535U) {
        Serial.println(F("TIMEOUT (65535 — mud/no-echo)"));
    } else {
        Serial.print(distanceMm);
        Serial.println(F(" mm"));
    }

    Serial.print(F("  Battery     : "));
    Serial.print(batteryV);
    Serial.print(F(" V  (raw byte="));
    Serial.print(batteryByte);
    Serial.println(F(")"));

    Serial.print(F("  Tamper Flag : "));
    Serial.println((flags & FLAG_TAMPER_BIT) ? F("TRIGGERED (0x04)") : F("Clear"));

    Serial.print(F("  Flow Speed  : "));
    Serial.print(flowSpeed);
    Serial.println(F(" cm/s (V1 hardcoded)"));

    Serial.print(F("  Flags Byte  : 0x"));
    Serial.print(HEX_CHARS[(flags >> 4) & 0x0F]);
    Serial.println(HEX_CHARS[ flags       & 0x0F]);

    Serial.print(F("  HEX Payload : "));
    printHexPayload(payload, 6);

    // 7. Transmit via LoRa-E5
    sendLoRaPayload(payload, 6);

    // 8. Deep sleep substitute — delay for bench testing
    //    Replace with LowPower.deepSleep() / STM32 STANDBY mode in production
    Serial.print(F("  Sleeping for "));
    Serial.print(SLEEP_INTERVAL_MS / 1000UL);
    Serial.println(F(" s...\n"));
    delay(SLEEP_INTERVAL_MS);
}
