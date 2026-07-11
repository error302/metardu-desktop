# METARDU

Surveying software for land surveyors in Kenya and East Africa. Built to handle the cadastral, engineering, topographic, and control-survey workflows that Kenyan professionals use day to day — with NLIMS-ready exports, Survey Act Cap. 299 compliant deed plans, and ISK-aligned surveyor credentials.

## Why METARDU

Surveyors spend a lot of time on paperwork — closing traverses by hand, typing field notes into Excel, drafting deed plans in CAD, and filling NLIMS submission forms. METARDU pulls those steps into one workspace so the field-to-finish flow stays in a single place. The output (deed plans, Form No. 4, statutory workbooks, RDM 1.1 reports) is shaped to match what the Survey of Kenya expects.

## Survey Types

METARDU supports **9 survey types** with dedicated project workflows:

1. **Cadastral Survey** — Boundary surveys with LR number, deed plan generation, Bowditch traverse adjustment
2. **Engineering Survey** — Road design, levelling (10√K mm closure per RDM 1.1), cross-sections, earthworks
3. **Topographic Survey** — Tacheometry, radial surveys, DTM generation, contour extraction
4. **Geodetic / Control Survey** — GNSS baselines, network adjustment, accuracy classification
5. **Mining Survey** — Underground traverse, stockpile volumes, setting-out data
6. **Hydrographic Survey** — Bathymetric soundings, tidal corrections, depth reduction
7. **Drone / UAV Photogrammetry** — GCP management, point cloud processing, orthophoto generation
8. **Deformation / Monitoring Survey** — Epoch comparisons, displacement vectors, statistical analysis
9. **Mixed Discipline Survey** — Combined observations from multiple survey types

### 5-Step Project Workflow

Every project follows the same workflow:
1. **Setup** — Enter project details, LR number, client info, UTM zone
2. **Field Book** — Record observations (columns auto-switch per survey type)
3. **Compute** — Run calculations (Bowditch, Rise & Fall, volumes, etc.)
4. **Review** — Check results, diagrams, closure reports
5. **Submission** — Generate and download all required documents

## Features

### Data Import
- **Universal Importer** — Auto-detects format: LAS, LAZ, PLY, CSV, XML, DXF, GSI, JobXML, RINEX, Trimble RW5
- **Drone Support** — Pix4D, DJI flight logs, point cloud processing

### Calculations (via src/lib/engine)
- Traverse adjustment (Bowditch/Transit)
- Levelling (Rise & Fall, Height of Collimation)
- COGO (radiation, intersection, resection)
- Volume computation (prismoidal, end-area)
- Coordinate transforms (WGS84 ↔ UTM, all 60 zones)
- Curve geometry (horizontal/vertical)
- Earthworks (cut/fill, mass haul)

### Document Generation
- Survey reports per RDM 1.1
- Deed plans (Form No. 4)
- Working diagrams
- Longitudinal/cross-sections
- Setting-out sheets
- Coordinate schedules
- Shapefile/DXF export

### Online Services
- GNSS baseline processing
- Live coordinate transformation API
- Benchmark database lookup
- Kenya CORS RTK corrections

### Integration
- Kenya NLIMS, Uganda NLIS, Tanzania Land Registry
- Professional body integration (ISK, EBK)
- M-Pesa, PayPal, Stripe payment

## Tech Stack

- Next.js 14 (App Router)
- TypeScript 5.x
- Tailwind CSS
- PostgreSQL with row-level security
- NextAuth.js (session-based auth, bcrypt password hashing)
- OpenLayers (interactive maps)
- Capacitor (Android mobile)
- PWA support (offline-first field work)
- Sentry (error monitoring)
- Vitest + Jest test suites

## Supported

- **14 Languages**: EN, SW, FR, AR, PT, ES, ZH, JA, RU, HI, ID, AM, HA, DE
- **60 UTM Zones**: All zones, both hemispheres
- **13 Currencies**: KES, UGX, TZS, NGN, GHS, ZAR, INR, IDR, BRL, AUD, GBP, EUR, USD

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Run standalone build locally
npm run start:standalone

# Run tests
npm test

# Build mobile app (requires Java)
npm run mobile:build
```

## Production

METARDU runs as a standalone Next.js build managed by PM2:

- `next build` with standalone output
- `pm2 start ecosystem.config.cjs`
- One active PM2 process per instance

Docker configuration is included in the repo for containerized deployments. See [docs/deployment/duckdns-cloudflare-tunnel.md](docs/deployment/duckdns-cloudflare-tunnel.md) for the current deployment runbook.

## Pages

- `/` — Landing page
- `/dashboard` — Project list and activity feed
- `/projects/new` — Create new project
- `/projects/[id]` — Project workspace (5-step workflow)
- `/fieldbook` — Digital field book
- `/map` — Interactive cadastral map
- `/tools/*` — Standalone survey tools (40+ calculators)
- `/community` — Surveyor community
- `/marketplace` — Equipment marketplace
- `/kencors` — RTK corrections
- `/pricing` — Subscription plans
- `/settings/profile` — Account, company, notifications, security

## Build

- **Web**: 200+ routes, builds successfully
- **Mobile**: Capacitor Android (requires Java for APK build)

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npx jest src/lib/auth/__tests__/rbac.test.ts

# Run tests with coverage
npx jest --coverage

# Run tests in watch mode
npx jest --watch
```

### Test Structure

- **Unit tests**: `src/lib/__tests__/` — Library function tests (RBAC, error handling, DB, validation)
- **API tests**: `src/app/api/scheme/__tests__/` — API route tests with mocked auth and DB
- **Engine tests**: `src/lib/engine/__tests__/` — Survey computation engine tests (33 files, existing)

## License

MIT

---

Built in Kenya for the surveying community.
