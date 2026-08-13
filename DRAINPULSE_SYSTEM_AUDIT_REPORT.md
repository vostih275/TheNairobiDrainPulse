# DRAINPULSE SYSTEM AUDIT REPORT

**Project:** TheNairobiDrainPulse  
**Requested Pivot:** Enterprise Hydro-Topographical Basin Modeling & Predictive Flow Platform  
**Audit Date:** 2026-07-27  
**Auditor:** Devin (Cascade)  
**Scope:** `package.json`, `src/server.js`, `src/lib/`, `src/models/`, `src/routes/`, `public/`, plus runtime/static diagnostics.

---

## Sprint 1 Status: COMPLETED

All Sprint 1 tasks have been implemented and verified:

- **Schema refactor:** `src/models/CatchmentBasin.js` created; `src/models/DrainNode.js` converted to GeoJSON `Point` with `2dsphere` index and new hydrology fields (`surfaceType`, `drainCrossSectionAreaSqM`, `catchmentBasinId`); `src/models/Telemetry.js` now has a `{ nodeId: 1, timestamp: -1 }` compound index and `rssi`/`snr` fields.
- **Security hardening:** `src/server.js` now uses `helmet`, restricts CORS via `FRONTEND_URL`, and exposes `/health`; `src/routes/ingest.js` requires a Bearer/API key (`INGEST_API_KEY`) and extracts ChirpStack `rxInfo` radio metadata.
- **Seed + migration:** `src/seed.js` creates a dummy `CatchmentBasin` and seeds all 5 nodes with the new GeoJSON location format and required physical parameters.
- **Verification:** Seed completed successfully; server booted and connected to MongoDB; `GET /health` returned `{ status: 'ok' }`; `GET /api/v1/nodes` returned 5 nodes with correct `location` objects and no legacy `latitude`/`longitude` fields.

---

## Sprint 2 Status: COMPLETED

All Sprint 2 tasks have been implemented and verified:

- **Weather ingestion worker:** `src/workers/weatherIngest.js` created using `axios` and `node-cron`; runs an immediate job on boot and every 15 minutes; fetches live `rainfallRateMmHr` from OpenWeatherMap if `OPENWEATHER_API_KEY` is configured, otherwise generates deterministic mock rainfall per `subCounty`; inserts `WeatherReading` documents; initialized in `src/server.js`.
- **Rational Method refactor:** `src/lib/predictiveEngine.js` now computes `Q (m³/s) = 0.00278 * C * I * A`, where `C` is pulled from the linked `CatchmentBasin.surfaceCoefficients[node.surfaceType]`, `I` is the latest `WeatherReading.rainfallRateMmHr`, and `A` is the basin `catchmentAreaSqKm`. The resulting flow is converted to a vertical water-level rise estimate (`mm/min`) using the node's `drainCrossSectionAreaSqM`.
- **Inverse anomaly detection:** `src/lib/anomalyEngine.js` exposes `checkBlockageAnomaly(node, latestTelemetry, currentRainfall)`, which raises `BLOCKAGE_SUSPECTED` when heavy rain (`>10 mm/hr`), low flow speed (`<5 cm/s`), and relatively low water depth co-occur. It is wired into `src/routes/ingest.js` and automatically creates a `MaintenanceTicket` with severity `HIGH` and notes describing the inverse flow anomaly.
- **Verification:** `node test-decoder.js` passed all four cases; the server booted successfully; the weather worker inserted per-`subCounty` readings on startup; a simulated `POST /api/v1/ingest/chirpstack` payload with `flowSpeed=0` and `waterDepth=50mm` during `Lang'ata` rainfall of `27.52mm/hr` produced a `HIGH` severity anomaly ticket with notes `Inverse Flow Anomaly: Upstream blockage suspected...`.

---

## Sprint 3 Status: COMPLETED

All Sprint 3 tasks have been implemented and verified:

- **Alert dispatcher service:** `src/services/alertDispatcher.js` created with `mockSendSMS(phone, message)` and `dispatchTicket(ticket)`. Wired via Mongoose `MaintenanceTicketSchema.post('save')` so every new `HIGH` severity ticket logs a highly-visible, ANSI-colored mock outbound SMS containing `nodeId`, `notes`, and `timestamp`.
- **Frontend spatial refactor:** `public/index.html` already consumes GeoJSON `location.coordinates` as `[lng, lat]` and reverses to `[lat, lng]` for Leaflet. Added `activeHighTickets` tracking; markers now render **red/pulsing** for any node with a pending/assigned `HIGH` severity ticket and **green/stable** otherwise; `updateMarkerColors()` reacts to real-time socket `new_ticket` events.
- **Predictive UI panel:** Added an "Active Infrastructure Predictions" table to `public/index.html` populated from `GET /api/v1/predictions`. It displays `nodeId`, `subCounty`, `rainfallRateMmHr` (Current Rain), `runoffInflowMmPerMin` (Predicted Drain Rise), and `riskStatus`.
- **New API endpoint:** `src/routes/predictions.js` registered as `/api/v1/predictions` computes and returns the Sprint 2 Rational Method predictions for all nodes.
- **Verification:** The server booted and served the dashboard at `http://localhost:3000`; a simulated `POST /api/v1/ingest/chirpstack` for `NODE-005` with `flowSpeed=0` during `23.32mm/hr` rainfall created a `HIGH` anomaly ticket `TKT-F539FA69`; the terminal logged the mock SMS dispatch; the frontend `activeHighTickets` set now includes `NODE-005`, causing its map marker to render red/pulsing and its row to appear in the Active Infrastructure Predictions panel.

---

## Sprint 4 Status: COMPLETED

All Sprint 4 tasks have been implemented and verified:

- **Field Worker Ticket Resolution API:** `PATCH /api/v1/tickets/:ticketId/resolve` accepts `resolutionNotes`, updates the ticket `status` to `Resolved`, sets `resolvedAt`, and stores `resolutionNotes`. `src/models/MaintenanceTicket.js` updated with the `resolutionNotes` field.
- **Automated PDF Reporting Engine:** Installed `pdfkit`; created `src/workers/reportGenerator.js` to query high-severity tickets from the last 7 days, total recorded rainfall, and unresolved tickets, then generate a PDF to `reports/drainpulse-report.pdf`. `GET /api/v1/reports/latest` regenerates and serves the PDF with `Content-Disposition: inline`.
- **Mobile PWA Manifest & Field View:** Added `public/manifest.json` and `public/icon.svg`, plus PWA meta tags in `public/index.html`. Added a "Field Operations" panel that lists open tickets with severity badges and a "Resolve" button that prompts for notes and calls the `PATCH` endpoint. Also added a "Download Report" button.
- **Verification:** The server restarted and loaded the new routes; `PATCH /api/v1/tickets/TKT-F539FA69/resolve` updated the ticket to `Resolved` with `resolutionNotes`; `GET /api/v1/reports/latest` produced a valid `%PDF-1.3` file saved in `reports/`.

---

## Phase 2: Hardware & Edge Engineering

### Sprint 5 Status: COMPLETED

All Sprint 5 tasks have been implemented and verified:

- **Dockerized ChirpStack LNS:** Created `chirpstack-docker/docker-compose.yml` with `chirpstack` (UI on `8080`), `chirpstack-gateway-bridge` (`1700/udp`), `postgres`, `redis`, and `mosquitto` (`1883`) services. Validated with `docker compose config -q`.
- **Edge firmware scaffolding:** Created `firmware/Makefile`, `firmware/src/asr6601.ld` placeholder, and `firmware/src/main.cpp` for the Ai-Thinker Ra-08 (ASR6601) / STM32WLE5. Includes `readDistanceMm()`, `readBatteryVoltage()`, `buildPayload(distance, batteryVoltage)` packing 2 bytes little-endian distance plus 1 byte 0.1 V battery, a `sendLoRa()` stub, and a 15-minute deep-sleep loop.
- **ChirpStack v4 payload decoder:** Created `firmware/decoder.js` with `decodeUplink(input)` decoding the 3-byte payload back into `{ waterDepth, battery }`. Verified locally with the mock bytes `[0xD6, 0x06, 0x23]` yielding `{ waterDepth: 1750, battery: 3.5 }`.

---

## 1. Executive Health Summary

The V1 codebase is a **functioning Node.js/Express/Socket.io IoT dashboard** that already has the seed of a predictive engine. The following are working well and form a solid launchpad for the enterprise pivot:

- **Real-time telemetry pipeline** is wired end-to-end: ChirpStack-style ingest → decoder → health score → Socket.io broadcast → dashboard.
- **Administrative hierarchy** (`county → subCounty → ward`) has been correctly modeled on `DrainNode` and exposed via cascading filters and API query parameters.
- **Predictive engine scaffolding** exists (`src/lib/predictiveEngine.js`) and computes a simplified Rational Method runoff and time-to-overflow estimate.
- **Frontend** (`public/index.html`) renders Leaflet markers, color-coded risk badges, cascading filters, and a live event log.
- **Decoder** (`src/lib/decoder.js`) is byte-accurate for the 6-byte payload; the included `test-decoder.js` passes all four cases.
- **Database connectivity** is wired via Mongoose and `.env` with a local MongoDB URI.

However, the current system is architecturally a **sensor dashboard with a first-order prediction bolt-on**, not a hydro-topographical basin modeling platform. The gaps below must be closed before the product can credibly support basin-scale hydrological modeling.

---

## 2. Critical Architecture Gaps

### 2.1 Hydro-Topographical Readiness

| Requirement | Current State | Gap Severity |
|---|---|---|
| **Catchment Basin model** | Not present. `DrainNode` has `catchmentAreaSqKm` only. | High |
| **Sub-County Profiles** | `subCounty` is a string on `DrainNode`. No `SubCountyProfile` collection. | High |
| **Drainage Surface Coefficients (C)** | Hard-coded `RUNOFF_COEFFICIENT = 0.85` in `predictiveEngine.js`. No per-surface-type C. | High |
| **Catchment Areas (A)** | Stored per node as `catchmentAreaSqKm` with a default. No GIS basin polygon. | Medium-High |
| **Rational Method Q = C·I·A** | Implemented partially, but **units are physically incorrect** (`runoffQ` is treated as mm/min inflow). | High |
| **Spatial coordinates** | Stored as two `Number` fields. No GeoJSON `Point` or `2dsphere` index. | High |
| **GeoJSON aggregation** | Not supported. Cannot run `$near`, `$geoWithin`, or downstream/upstream topological queries. | High |
| **Health Score Engine** | `healthScore.js` computes an ad-hoc `100 - fillPenalty - risePenalty` score. It does **not** compute the Rational Method or any hydrological flow. | High |

### 2.2 Ingestion & Security Hardening

| Requirement | Current State | Gap Severity |
|---|---|---|
| **ChirpStack webhook auth** | `POST /api/v1/ingest/chirpstack` is **unauthenticated and unprotected**. Any client can flood it. | Critical |
| **Payload validation** | Only checks `nodeId` and `payload` existence. No schema/Joi validation, no `content-type` enforcement. | High |
| **Rate limiting** | Not implemented. | High |
| **Replay protection** | Not implemented. | Medium |
| **Radio metadata (RSSI/SNR)** | `decoder.js` ignores everything beyond 6 bytes. No `rssi`, `snr`, `gatewayCount`, `frequency`, or `dr` fields. | High |
| **Telemetry storage efficiency** | `Telemetry` has separate indexes on `nodeId` and `timestamp` but **no compound index `{ nodeId: 1, timestamp: -1 }`**. Not configured as a MongoDB Time Series collection. | Medium-High |
| **Error handling** | `ingest.js` returns raw `err.message` and logs only to console. No structured logging. | Medium |

### 2.3 Weather & Predictive Analytics Gap Analysis

| Requirement | Current State | Gap Severity |
|---|---|---|
| **Automated rainfall ingestion** | `WeatherReading` model exists, but there is **no worker/cron/API integration** to populate it. | High |
| **Real-time rainfall intensity (I)** | `predictiveEngine.getLatestWeather()` reads the most recent `WeatherReading` for a `subCounty`. Without an ingest worker it always returns `0` unless manually seeded. | High |
| **Inverse anomaly detection** | **Not implemented.** No logic compares high upstream rainfall with low/stagnant downstream `flowSpeed` to detect blockages. | High |
| **Upstream/downstream topology** | No graph or ordered basin relationships. `flowSpeed` is stored but not analyzed relative to topology. | High |
| **Predictive time-to-overflow** | Present, but the underlying runoff calculation conflates m³/s with mm/min, making the minute estimate unreliable for engineering use. | High |
| **Risk thresholds** | Hard-coded 20/45 minute buckets. No per-basin calibration. | Medium |

### 2.4 Code Quality & Production Readiness

| Requirement | Current State | Gap Severity |
|---|---|---|
| **Environment variables** | `.env` has `MONGO_URI` and `PORT`. No validation (e.g., missing `MONGO_URI` crashes). No separate secrets management. | Medium |
| **CORS** | `cors({ origin: '*' })` in `server.js` is insecure for production. | High |
| **Helmet/security headers** | Not installed. No `helmet`, `express-rate-limit`, or compression. | High |
| **Socket.io error handling** | Only `connect`/`disconnect` logs. No `error` or `connect_error` handling. | Medium |
| **Database reconnection** | `mongoose.connect()` without `serverSelectionTimeoutMS` or reconnection strategy. | Medium |
| **Docker** | **No `Dockerfile` or `docker-compose.yml`** exists. | High |
| **Test framework** | `test-decoder.js` exists but is not wired to `npm test` and uses `process.exit`. No Jest/Mocha. | Medium |
| **Linting/formatting** | No ESLint/Prettier config. | Low-Medium |
| **Health endpoint** | No `/health` or `/ready` endpoint. | Medium |
| **npm audit** | 3 direct-dependency vulnerabilities (body-parser low, mongoose moderate, uuid moderate). | High |
| **N+1 query** | `/api/v1/nodes` plus per-node `/predictive-risk` fetch in frontend results in one DB query per node. | Medium |

---

## 3. Recommended Refactoring Plan

### Sprint 1: Schema & Security (Weeks 1–2)

1. **Introduce a `CatchmentBasin` model**
   - `basinId`, `subCounty`, `county`, `geometry: GeoJSON Polygon/MultiPolygon`.
   - `surfaceCoefficients: { paved: Number, grass: Number, bare: Number, ... }`.
   - Reference list of `DrainNode` `_id`s.
2. **Convert `DrainNode` to GeoJSON**
   - Replace `latitude`/`longitude` with `location: { type: 'Point', coordinates: [lng, lat] }`.
   - Add `index({ location: '2dsphere' })`.
3. **Add per-node hydrology fields**
   - `surfaceType` and `runoffCoefficient` (or inherit from basin).
   - `drainCrossSectionAreaSqM` and `basinIds: [ObjectId]` references.
4. **Harden `src/routes/ingest.js`**
   - Add API-key or JWT middleware.
   - Add `express-rate-limit` per source IP/node.
   - Validate payload shape with Joi or Zod.
   - Store `rssi`, `snr`, `gatewayCount`, `frequency`, `dr` from gateway metadata.
5. **Index telemetry for time-series use**
   - Add compound index `TelemetrySchema.index({ nodeId: 1, timestamp: -1 })`.
   - Evaluate converting to MongoDB Time Series collection.
6. **Fix `src/server.js` security**
   - Replace `cors({ origin: '*' })` with a whitelist.
   - Add `helmet()`, `express.json()` size limits, `compression()`.

### Sprint 2: Weather Ingestion & Rational Engine (Weeks 3–4)

1. **Build a weather worker service**
   - New `src/workers/weatherIngest.js` (cron or queued).
   - Pull `rainfallRateMmHr` from Kenya Met or a weather API and upsert `WeatherReading` per `subCounty`.
2. **Correct the Rational Method implementation**
   - Compute `Q_m3s = 0.00278 * C * I_mmHr * A_km2`.
   - Convert `Q` to mm/min rise over the drain cross-section: `riseMmMin = (Q_m3s * 1000) / (crossSectionArea * 60)`.
   - Use `C` from `CatchmentBasin` surface mix, not a global constant.
3. **Add Inverse Anomaly Detection**
   - `src/lib/anomalyEngine.js` compares upstream `rainfall` + `flowSpeed` with downstream nodes.
   - Flag `BLOCKAGE_SUSPECTED` when `rainfall > threshold` but `flowSpeed` drops below expected travel curve.
4. **Topology model**
   - Add `upstreamNodeIds` and `downstreamNodeIds` arrays or build a `BasinEdge` graph.
5. **Test coverage**
   - Add Jest/Mocha and wire `npm test`.
   - Unit tests for decoder, health score, Rational Method, anomaly detection.

### Sprint 3: Docker, Deployment & Operations (Week 5)

1. **Containerize**
   - Add `Dockerfile` and `docker-compose.yml` (Node + MongoDB).
2. **Process management**
   - Add `ecosystem.config.js` for PM2.
3. **Observability**
   - Add `/health` and `/ready` endpoints.
   - Use `pino` or `winston` for structured logging.
   - Add graceful shutdown and MongoDB reconnection handling.
4. **CI/CD**
   - GitHub Actions for `npm audit`, `npm test`, lint, and Docker build.
5. **Resolve npm audit issues**
   - Upgrade `body-parser`, `mongoose`, and `uuid` to patched versions.

---

## 4. File-by-File Breakdown

### `package.json`
- **Status:** Basic but minimal.
- **Notes:** Contains core deps (`express`, `mongoose`, `socket.io`, etc.). No `devDependencies`, no test framework, no lint config. Scripts `start`/`dev` are identical. `test-decoder` is not standard.
- **Issues:** 3 `npm audit` vulnerabilities in direct deps (`body-parser`, `mongoose`, `uuid`).

### `src/server.js`
- **Status:** Functional boilerplate.
- **Notes:** Loads `.env`, sets up Express + Socket.io, mounts routers, serves static `public/`.
- **Issues:** `cors({ origin: '*' })` is unsafe. No `helmet`, no `express.json` limit, no health endpoint, no DB reconnection strategy, no graceful shutdown. Logs to console only.

### `src/lib/healthScore.js`
- **Status:** Works as a dashboard heuristic, not a hydrological engine.
- **Notes:** Computes `fillRatio`, short-term rise penalty, and `isBlocked`/`isTampered` penalties.
- **Issues:** Does **not** implement the Rational Method (`Q = C·I·A`) or any runoff/flow calculation. Not coupled to `catchmentAreaSqKm`, `WeatherReading`, or elevation.

### `src/lib/predictiveEngine.js`
- **Status:** First-order predictive scaffold.
- **Notes:** Fetches latest `WeatherReading`, computes `Q = 0.85 * I * A`, elevation weight, and time-to-overflow.
- **Issues:**
  - `0.85` is a global magic constant; no per-surface C.
  - `runoffQ` is used as if it were a depth rate without converting from m³/s to mm/min over a drain cross-section.
  - `allNodes` averaging for elevation weight is a coarse heuristic; no upstream/downstream topology.
  - No inverse anomaly logic.

### `src/lib/decoder.js`
- **Status:** Correct for the documented 6-byte payload.
- **Notes:** Decodes distance, battery, flags, and flowSpeed.
- **Issues:** No handling of radio metadata (RSSI, SNR, gateway count, frequency, data rate). Rigid `length !== 6` check may reject valid ChirpStack payloads with additional metadata.

### `src/models/DrainNode.js`
- **Status:** Good administrative fields.
- **Notes:** Contains `county`, `subCounty`, `ward`, `elevationMeters`, `catchmentAreaSqKm`, `maxDrainCapacityMm`, `emptyDistanceMm`.
- **Issues:** No GeoJSON `Point`/spatial index. No explicit link to a `CatchmentBasin`. No per-node `runoffCoefficient` or `drainCrossSectionAreaSqM`.

### `src/models/WeatherReading.js`
- **Status:** Minimal model.
- **Notes:** Stores `subCounty`, `rainfallRateMmHr`, `timestamp`.
- **Issues:** No `source` or `provider` field, no confidence/quality flags, no TTL/indexing. No worker populates it.

### `src/models/Telemetry.js`
- **Status:** Standard time-stamped telemetry.
- **Notes:** Stores `nodeId`, `timestamp`, `distance`, `waterDepth`, `battery`, `flowSpeed`, flags, and health score.
- **Issues:** Missing radio metadata fields. Separate indexes instead of compound `{ nodeId: 1, timestamp: -1 }`. Not a MongoDB Time Series collection. No TTL/index for data lifecycle.

### `src/models/MaintenanceTicket.js`
- **Status:** Simple ticket tracker.
- **Notes:** `ticketId`, `nodeId`, `locationName`, `severity`, `status`, `createdAt`/`resolvedAt`.
- **Issues:** No `assignedTo`, `notes`, `resolutionCode`, or link to telemetry event that triggered it.

### `src/routes/ingest.js`
- **Status:** Ingests and broadcasts but is insecure.
- **Notes:** Decodes payload, computes health score, saves telemetry, updates node status, emits Socket.io events, creates tickets.
- **Issues:** No auth, no rate limiting, no payload validation, no replay protection, no radio metadata extraction, exposes raw `err.message` to client, does not use transactions. Calls `predictRisk` but does not persist the result.

### `src/routes/nodes.js`
- **Status:** Good multi-level filtering + predictive endpoint.
- **Notes:** `county`/`subCounty`/`ward` query filters; `/api/v1/nodes/:nodeId/predictive-risk`.
- **Issues:** Predictive endpoint recomputes on every request with a full `DrainNode.find({}).lean()` for elevation averaging (N+1/perf concern). No caching.

### `src/routes/telemetry.js`
- **Status:** Basic read route.
- **Notes:** Returns last 50 telemetry records for a node.
- **Issues:** No pagination, no aggregation (`avg`, `min`, `max`), no time range filtering. No auth.

### `src/routes/tickets.js`
- **Status:** Basic CRUD.
- **Notes:** `GET /api/v1/tickets`, `PATCH /api/v1/tickets/:ticketId/resolve`.
- **Issues:** No auth, no assignee logic, no validation of `ticketId`.

### `src/routes/simulator.js`
- **Status:** Useful for demos but duplicates logic.
- **Notes:** Simulates `DRY`, `STEADY_RAIN`, `FLASH_FLOOD` scenarios and injects telemetry.
- **Issues:** Hardcodes a separate `NODES` array that may drift from `DrainNode` seed. Duplicates `decodePayload`, `computeHealthScore`, ticket creation, and telemetry insertion from `ingest.js`. Does not integrate `predictiveEngine` or weather.

### `src/seed.js`
- **Status:** Works for the 5-node dataset.
- **Notes:** Upserts nodes with full admin hierarchy and elevation.
- **Issues:** Only seeds `DrainNode`. No `WeatherReading` or `CatchmentBasin` seed data. No environment validation.

### `public/index.html`
- **Status:** Feature-rich dashboard.
- **Notes:** Tailwind/Chart.js/Leaflet/Socket.io, cascading filters, risk color-coding, predictive banner.
- **Issues:** All JavaScript is inline. No CSP. No global error handling. Fetches `/predictive-risk` once per node on load (N+1 HTTP calls). No retry/back-off for failed API calls.

### `test-decoder.js`
- **Status:** Passes.
- **Notes:** 4 hard-coded decoder test cases.
- **Issues:** Not part of `npm test`. No coverage for invalid payloads, base64 input, or radio metadata.

---

## 5. Diagnostic Results

| Test | Command | Result |
|---|---|---|
| Decoder unit tests | `node test-decoder.js` | **4 passed, 0 failed** |
| JavaScript syntax checks | `node --check` on all `src/` files | **All passed** |
| Vulnerability audit | `npm audit --json` | **3 vulnerabilities** (1 low, 2 moderate) |

---

## 6. Conclusion

DrainPulse V1 is a credible **proof-of-concept IoT flood dashboard** with the administrative hierarchy and a first-pass predictive risk display already in place. To become an **enterprise Hydro-Topographical Basin Modeling & Predictive Flow Platform**, the codebase requires a deliberate three-sprint refactoring effort focused on:

1. **Spatial/hydrological schema correctness** (GeoJSON, basin models, per-surface C).
2. **Security and production hardening** (auth, rate limits, CORS, helmet, Docker).
3. **Weather automation and real hydrological analytics** (Rational Method with proper units, inverse anomaly detection, upstream/downstream topology).

The foundation is there; the missing pieces are well-defined and can be delivered iteratively without rewriting the core telemetry pipeline.
