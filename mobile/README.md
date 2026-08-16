# DrainPulse Field (React Native / Expo)

Geofenced contractor verification and offline-sync mobile app for the Nairobi DrainPulse maintenance workflow.

## Features

- **Live GPS geofence** — `expo-location` streams device coordinates and the app disables on-site actions (`Upload After Photos`, `Resolve Ticket`) when the device is more than 15 m from the node's registered coordinates.
- **Haversine distance check** — computed on-device from the node's MongoDB GeoJSON `location.coordinates`.
- **Offline cache** — selected before/after photos, chosen operator, and resolution notes are persisted in `AsyncStorage`; pending uploads/resolve actions are queued if the device loses connectivity.
- **Background sync** — `expo-background-fetch` + `expo-task-manager` automatically retry the pending queue when the device comes back online; a foreground `expo-network` listener triggers an immediate flush as well.

## Project structure

```
mobile/
  App.js              # Main screen with login, ticket view, geofence, and sync logic
  package.json        # Expo SDK 50 dependencies
  app.json            # Expo config, permissions, and API base override
  babel.config.js     # Babel preset for Expo
  .gitignore          # Standard Expo/React Native ignore rules
```

## Backend prerequisite

The mobile app uses the same API the web field terminal uses:

- `GET /api/v1/crews`
- `POST /api/v1/crews/verify`
- `GET /api/v1/tickets/active?crewName=...`
- `PATCH /api/v1/tickets/:ticketId/photos` — merge-upload before/after photos
- `PATCH /api/v1/tickets/:ticketId/resolve` — finalize with notes

A new `/photos` merge endpoint was added to `src/routes/tickets.js` so photos can be uploaded on-site before the final resolution step.

## Running the app

1. Make sure the backend is running (`npm run dev` in the repo root).
2. Open `mobile/app.json` and replace the `extra.apiBase` placeholder with your machine's LAN IP, e.g. `http://192.168.1.42:3000`.
3. Install mobile dependencies:

```bash
cd mobile
npm install
```

4. Start the Expo dev server:

```bash
npx expo start
```

5. Scan the QR code with the Expo Go app (iOS/Android) or run on an emulator:

```bash
npx expo start --android
npx expo start --ios
```

## Usage flow

1. Select your crew and log in.
2. The app loads the active dispatch and starts watching GPS.
3. Move within 15 m of the node — the geofence banner turns green and the action buttons enable.
4. Select up to three **Before** photos and up to three **After** photos.
5. Tap **Upload After Photos** to push the photos to the server (or cache them if offline).
6. Enter resolution notes, select the verified operator, and tap **Resolve Ticket**.
7. If offline, the action is queued and will sync automatically when connectivity returns.

## Notes

- Photo URIs are copied into the app's document directory (`FileSystem.documentDirectory`) so they survive app restarts while waiting to sync.
- The background sync task is registered with a 15-minute minimum interval on Android and runs when the app is backgrounded.
- `Constants.expoConfig.extra.apiBase` in `app.json` is the single place to point the app at your backend.
