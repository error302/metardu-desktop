# METARDU Product Strategy — Mobile / Web / Desktop Split

## The Three-Tier Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FIELD                                    │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  METARDU Mobile (Android/iOS)                        │       │
│  │  ─────────────────────────────                       │       │
│  │  • Data collection ONLY                              │       │
│  │  • Total station / GNSS connection (BLE)             │       │
│  │  • Point pickup with codes                           │       │
│  │  • Survey planner (schedule, crew assignment)        │       │
│  │  • Photo notes (geotagged)                           │       │
│  │  • Voice descriptions (audio → text)                 │       │
│  │  • Offline-first (all data local)                    │       │
│  │  • Push sessions when online                         │       │
│  │  • Lightweight — no computation, no PDFs             │       │
│  └──────────────────────┬───────────────────────────────┘       │
│                         │                                        │
│                    Sync Endpoint                                 │
│                         │                                        │
└─────────────────────────┼────────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
┌─────────▼──────────┐          ┌─────────▼──────────────────────┐
│  METARDU Web        │          │  METARDU Desktop               │
│  ──────────────     │          │  ──────────────                │
│  MEDIUM projects    │          │  LARGE / COMPLEX projects      │
│                     │          │                                │
│  • Traverse adjust  │          │  • Everything web does +       │
│  • Basic deed plan  │          │    10M+ point clouds           │
│  • NLIMS export     │          │  • Baarda blunder detection    │
│  • Basic contours   │          │  • 3D parcel visualization     │
│  • Basic road design│          │  • Multi-window workspace      │
│  • Statutory docs   │          │  • Real-time total station     │
│  • Works in browser │          │  • NTRIP RTK streaming         │
│  • No install       │          │  • Title chain + ArdhiSasa     │
│  • Good for <500    │          │  • Smart deed plan auto-layout │
│    points           │          │  • Machine control export      │
│  • Limited memory   │          │  • Full LSA (least squares)    │
│  • Tab crash >500k  │          │  • 64GB RAM, GPU               │
│    points           │          │  • No memory limits            │
│                     │          │  • Good for 10M+ points        │
└─────────────────────┘          └────────────────────────────────┘
```

## How the Surveyor Chooses

After collecting data in the field with mobile, the surveyor sees:

```
┌─────────────────────────────────────────┐
│  Field session complete: 45 points      │
│  Project: Kiambu Cadastral Survey       │
│                                         │
│  Where do you want to continue?         │
│                                         │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │  Web App    │  │  Desktop App    │  │
│  │  (Browser)  │  │  (Installed)    │  │
│  │             │  │                 │  │
│  │  ✓ Quick    │  │  ✓ Full power   │  │
│  │  ✓ No setup │  │  ✓ 10M+ points  │  │
│  │  ✓ <500 pts │  │  ✓ Blunder det. │  │
│  │  ✓ Basic    │  │  ✓ 3D parcels   │  │
│  │    deed plan│  │  ✓ Auto-layout  │  │
│  │             │  │  ✓ Machine ctrl │  │
│  └─────────────┘  └─────────────────┘  │
│                                         │
│  Recommendation: Web (small project)    │
└─────────────────────────────────────────┘
```

## Mobile App Scope (Data Collection Only)

### What Mobile Does:
- Connect to total station (BLE/USB-OTG)
- Connect to GNSS rover (BLE)
- Pick up points with feature codes
- Real-time coordinate display
- Survey planner (daily schedule, crew, parcels to survey)
- Photo notes (geotagged, attached to points)
- Audio descriptions (attached to points)
- Field book (digital, replaces paper)
- Push sessions to sync endpoint when online
- Export .field-session file (offline fallback)

### What Mobile Does NOT Do:
- No traverse adjustment (too complex for mobile)
- No deed plan generation (needs A1 plotter)
- No NLIMS export (needs desktop validation)
- No contours / TIN (needs GPU)
- No machine control (needs serial port)
- No RSA crypto seal (needs secure key storage)
- No statutory documents (needs A4/A1 printing)

### Why This Split Works:
1. **Mobile is fast** — no computation overhead, instant point pickup
2. **Mobile is simple** — one screen, one job: collect data
3. **Battery life** — no heavy math draining the battery
4. **Field durability** — less code = fewer crashes in harsh conditions
5. **Surveyor choice** — web for quick jobs, desktop for complex ones
6. **No performance compromise** — the surveyor is never limited by the device

## Survey Planner (Mobile Feature)

The survey planner is a mobile-first feature that helps the surveyor plan their field day:

```
┌─────────────────────────────────┐
│  Survey Planner — Today         │
│  Tuesday, 12 July 2026          │
│                                 │
│  07:00  Setup station at BM1    │
│         ├── Crew: J. Surveyor   │
│         ├── Instrument: Topcon  │
│         └── Parcels: 3 to survey│
│                                 │
│  07:30  Survey parcel LR 123/45 │
│         ├── Estimated: 45 min   │
│         ├── Points: ~20         │
│         └── Status: ○ Pending   │
│                                 │
│  08:15  Survey parcel LR 123/46 │
│         ├── Estimated: 30 min   │
│         ├── Points: ~15         │
│         └── Status: ○ Pending   │
│                                 │
│  08:45  Survey parcel LR 123/47 │
│         ├── Estimated: 60 min   │
│         ├── Points: ~30         │
│         └── Status: ○ Pending   │
│                                 │
│  09:45  Move to next station    │
│  10:00  Setup station at BM2    │
│  ...                            │
│                                 │
│  16:00  End of day              │
│         Push session: 65 points │
│         [Continue on Web/Desktop]│
└─────────────────────────────────┘
```
