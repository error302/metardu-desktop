# Field-to-Office Sync API Contract

## Overview

This document defines the API that **metardu web** (field) and **metardu desktop** (office) use to synchronize field survey data. The desktop app is the client; the sync endpoint is the server.

## Workflow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  metardu web     │     │  Sync Endpoint    │     │  metardu desktop │
│  (field)         │     │  (ArdhiSasa or    │     │  (office)        │
│                  │     │   custom server)  │     │                  │
│  Pick up points  │────▶│  Store sessions   │◀────│  Pull sessions   │
│  Push when online│     │  Index by surveyor│     │  Auto on launch  │
│                  │     │                   │     │  + every 5 min   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │  Points appear  │
                                                │  on map + table │
                                                │  Ready for:     │
                                                │  - Traverse     │
                                                │  - Deed plan    │
                                                │  - NLIMS export │
                                                │  - Machine ctrl │
                                                └─────────────────┘
```

## API Endpoints

### 1. GET /sessions

List available field sessions for the authenticated surveyor.

**Query parameters:**
- `surveyorId` (optional) — filter by surveyor
- `projectId` (optional) — filter by project
- `since` (optional) — ISO timestamp, only return sessions after this date

**Headers:**
```
Authorization: Bearer <api-key>
Accept: application/json
```

**Response (200):**
```json
{
  "sessions": [
    {
      "sessionId": "fs_1709234567890_abc123",
      "projectName": "Kiambu Cadastral Survey",
      "surveyorName": "J. Surveyor",
      "date": "2026-07-12T08:00:00Z",
      "pointCount": 45
    }
  ]
}
```

### 2. GET /sessions/:id

Fetch a single field session with all points and observations.

**Response (200):**
```json
{
  "sessionId": "fs_1709234567890_abc123",
  "surveyorId": "srv_001",
  "surveyorName": "J. Surveyor",
  "surveyorLicense": "ISK/1234",
  "projectName": "Kiambu Cadastral Survey",
  "projectId": "prj_kiambu_001",
  "county": "Kiambu",
  "surveyType": "cadastral",
  "startDate": "2026-07-12T08:00:00Z",
  "endDate": "2026-07-12T16:30:00Z",
  "instrument": {
    "type": "total_station",
    "brand": "topcon",
    "model": "GTS-1000",
    "serialNumber": "TC001234"
  },
  "station": {
    "stationNumber": "BM1",
    "easting": 517234.560,
    "northing": 9876543.210,
    "elevation": 1523.450,
    "backsightNumber": "BM0",
    "backsightEasting": 517200.000,
    "backsightNorthing": 9876500.000,
    "instrumentHeight": 1.500
  },
  "points": [
    {
      "pointNumber": "BM1",
      "easting": 517234.560,
      "northing": 9876543.210,
      "elevation": 1523.450,
      "code": "BM",
      "description": "Benchmark on rock",
      "source": "total_station",
      "timestamp": "2026-07-12T08:15:00Z",
      "raw": " 023.4530  090.0000 025.0000"
    },
    {
      "pointNumber": "P2",
      "easting": 517300.000,
      "northing": 9876600.000,
      "elevation": 1524.000,
      "code": "CTRL",
      "description": "Control point",
      "source": "total_station",
      "timestamp": "2026-07-12T08:22:00Z"
    }
  ],
  "observations": [
    {
      "fromPoint": "BM1",
      "toPoint": "P2",
      "distance": 87.523,
      "bearing": 45.123,
      "verticalAngle": 90.000,
      "face": "left",
      "timestamp": "2026-07-12T08:22:00Z"
    }
  ],
  "crs": "EPSG:21037",
  "syncStatus": "synced",
  "syncedAt": "2026-07-12T17:00:00Z"
}
```

### 3. POST /sessions

Push a field session from desktop back to the sync endpoint (bidirectional sync).

**Request body:** Same as the GET /sessions/:id response.

**Response (201):**
```json
{
  "sessionId": "fs_1709234567890_abc123",
  "accepted": true
}
```

## What metardu web needs to implement

The metardu web app needs to:

1. **Push field sessions** — when the surveyor finishes a field session and has internet, POST the session to the sync endpoint
2. **Handle offline** — queue sessions locally (IndexedDB) and push when internet returns
3. **Include raw data** — each point should include the raw instrument data for audit
4. **Use consistent IDs** — session IDs should be UUIDs generated on the web app
5. **Include CRS** — every session must declare its coordinate reference system

## What metardu desktop does

1. **Auto-pull on launch** — checks for new sessions when the app starts
2. **Auto-pull every 5 minutes** — if auto-sync is enabled
3. **Deduplicate** — skips sessions already pulled (by session ID)
4. **Import to project** — surveyor clicks "Import" to load points into the current project
5. **Manual import** — surveyor can import a .field-session JSON file (offline fallback)
6. **Push back** — surveyor can push desktop-created sessions back to the sync endpoint

## Conflict Resolution

- Sessions are identified by UUID — no conflicts possible
- If a session is pulled twice (e.g., re-sync), the second pull is skipped
- Points within a session are immutable — once synced, they don't change
- If a surveyor edits points on desktop, the edited version stays local
  (desktop is the source of truth for computed/adjusted data)

## Security

- All requests require `Authorization: Bearer <api-key>` header
- API keys are configured per-surveyor
- HTTPS is required (no HTTP)
- The desktop app stores the API key in the user data directory
- The sync endpoint should validate the API key against ArdhiSasa credentials

## Offline Fallback

If no internet is available:
1. The web app exports a `.field-session` JSON file
2. The surveyor transfers the file to the office computer (USB, email, cloud drive)
3. The desktop app imports the file via "Import File" button
4. The file format is identical to the API response — no conversion needed
