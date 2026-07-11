# METARDU Survey Engine — Master Architecture & Build Plan

> **Purpose**: A comprehensive, agent-executable plan for building a professional-grade cadastral survey computation engine that achieves 2nd-order accuracy (1:20,000 closure) and produces legally defensible documents for Kenya's land surveying industry.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Directory Structure](#2-directory-structure)
3. [Database Schema](#3-database-schema)
4. [P0: Core Corrections (Accuracy)](#4-p0-core-corrections-accuracy)
5. [P1: Traverse Engine & Error Propagation](#5-p1-traverse-engine--error-propagation)
6. [P1: Document Generation (Vector PDF)](#6-p1-document-generation-vector-pdf)
7. [Database Load Reduction Strategy](#7-database-load-reduction-strategy)
8. [P2: Map Rendering & Cartography](#8-p2-map-rendering--cartography)
9. [P3: Advanced Features](#9-p3-advanced-features)
10. [Build Order & Dependencies](#10-build-order--dependencies)
11. [Testing Strategy](#11-testing-strategy)
12. [Accuracy Verification Protocol](#12-accuracy-verification-protocol)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (React/Next.js)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Field Data  │  │  Offline DB  │  │  Map View (OpenLayers)│ │
│  │  Collection  │  │  (IndexedDB) │  │  + Survey Layers      │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
│         │                  │                       │             │
│         └──────────────────┼───────────────────────┘             │
│                            │ Sync API                            │
└────────────────────────────┼─────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                     SERVER (Next.js API)                          │
│                            │                                     │
│  ┌─────────────────────────▼─────────────────────────────────┐  │
│  │              Survey Computation Engine                      │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐  │  │
│  │  │  Correction  │ │  Traverse    │ │  Error            │  │  │
│  │  │  Pipeline    │→│  Engine      │→│  Propagation      │  │  │
│  │  └──────────────┘ └──────────────┘ └───────────────────┘  │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐  │  │
│  │  │  COGO Engine │ │  Area/Volume │ │  Coordinate       │  │  │
│  │  │              │ │  Computation │ │  Transform        │  │  │
│  │  └──────────────┘ └──────────────┘ └───────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │  Document Engine │  │  Cache Layer   │  │  Job Queue    │  │
│  │  (Vector PDF)    │  │  (LRU + Redis) │  │  (BullMQ)     │  │
│  └──────────────────┘  └────────────────┘  └───────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  PostgreSQL + PgBouncer                   │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │  │
│  │  │  Projects   │ │  Observations│ │  Documents       │  │  │
│  │  │  Surveys    │ │  Coordinates │ │  Audit Trail     │  │  │
│  │  └─────────────┘ └──────────────┘ └──────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```
src/
├── lib/
│   ├── survey/                          # CORE: Survey computation engine
│   │   ├── corrections/
│   │   │   ├── atmospheric.ts           # EDM atmospheric corrections
│   │   │   ├── curvature-refraction.ts  # C&R correction
│   │   │   ├── grid-scale-factor.ts     # UTM/Cassini grid scale factor
│   │   │   ├── sea-level-reduction.ts   # Ellipsoid/sea level reduction
│   │   │   ├── slope-reduction.ts       # Slope to horizontal
│   │   │   ├── projection-convergence.ts # Grid convergence
│   │   │   ├── index.ts                 # Barrel export
│   │   │   └── __tests__/
│   │   │       ├── atmospheric.test.ts
│   │   │       ├── curvature-refraction.test.ts
│   │   │       ├── grid-scale-factor.test.ts
│   │   │       ├── sea-level-reduction.test.ts
│   │   │       └── pipeline.test.ts
│   │   ├── traverse/
│   │   │   ├── engine.ts                # Traverse computation engine
│   │   │   ├── bowditch.ts             # Bowditch/Compass adjustment
│   │   │   ├── least-squares.ts        # Least squares adjustment
│   │   │   ├── types.ts                # Traverse-specific types
│   │   │   └── __tests__/
│   │   ├── cogo/
│   │   │   ├── engine.ts               # COGO computations
│   │   │   ├── intersection.ts         # Line-line, line-curve intersections
│   │   │   └── __tests__/
│   │   ├── area/
│   │   │   ├── computation.ts          # Shoelace, radial methods
│   │   │   └── __tests__/
│   │   ├── curves/
│   │   │   ├── circular.ts             # Circular curve calculations
│   │   │   ├── transition.ts           # Spiral/transition curves
│   │   │   ├── vertical.ts             # Vertical curves
│   │   │   └── __tests__/
│   │   ├── volumes/
│   │   │   ├── end-area.ts             # End-area method
│   │   │   ├── grid-method.ts          # Grid method
│   │   │   └── __tests__/
│   │   ├── error-propagation/
│   │   │   ├── engine.ts               # Variance propagation engine
│   │   │   ├── error-ellipse.ts        # Confidence error ellipses
│   │   │   ├── types.ts
│   │   │   └── __tests__/
│   │   ├── coordinates/
│   │   │   ├── transform.ts            # Arc 1960 <-> WGS84
│   │   │   ├── projections.ts          # UTM, Cassini-Soldner
│   │   │   ├── datum.ts                # Datum parameters
│   │   │   └── __tests__/
│   │   ├── pipeline/
│   │   │   ├── correction-pipeline.ts  # Unified correction pipeline
│   │   │   ├── observation-processor.ts # Process raw observations
│   │   │   └── __tests__/
│   │   └── index.ts                    # Main barrel export
│   ├── documents/
│   │   ├── deed-plan/
│   │   │   ├── generator.ts            # Vector PDF deed plan
│   │   │   ├── title-block.ts          # Kenya standard title block
│   │   │   ├── grid-overlay.ts         # Coordinate grid & ticks
│   │   │   ├── symbology.ts            # Kenya standard symbols
│   │   │   └── __tests__/
│   │   ├── templates/
│   │   │   ├── form-c22.ts             # Form C-22 template
│   │   │   ├── beacon-certificate.ts   # Beacon certificate
│   │   │   ├── traverse-sheet.ts       # Traverse computation sheet
│   │   │   └── __tests__/
│   │   ├── pdf-engine.ts               # Core PDF generation engine
│   │   └── index.ts
│   ├── cache/
│   │   ├── memory-cache.ts             # In-memory LRU cache
│   │   ├── cache-strategies.ts         # Cache invalidation strategies
│   │   └── index.ts
│   └── db/
│       ├── client.ts                    # Prisma client singleton
│       ├── queries/                     # Optimized query functions
│       │   ├── projects.ts
│       │   ├── observations.ts
│       │   ├── coordinates.ts
│       │   └── documents.ts
│       └── batch/                       # Batch operations
│           ├── sync.ts                  # Field data sync
│           └── import.ts                # Data import
├── app/
│   ├── api/
│   │   ├── survey/
│   │   │   ├── traverse/route.ts       # Traverse computation API
│   │   │   ├── cogo/route.ts           # COGO API
│   │   │   ├── area/route.ts           # Area computation API
│   │   │   └── corrections/route.ts    # Corrections API
│   │   ├── documents/
│   │   │   ├── deed-plan/route.ts      # Deed plan generation
│   │   │   └── traverse-sheet/route.ts # Traverse sheet
│   │   ├── sync/
│   │   │   └── route.ts               # Offline data sync
│   │   └── projects/
│   │       └── route.ts               # Project CRUD
│   └── (pages)/                         # Next.js pages
├── components/
│   ├── survey/                          # Survey UI components
│   ├── maps/                            # Map components
│   └── documents/                       # Document preview components
└── prisma/
    └── schema.prisma                    # Database schema
```

---

## 3. Database Schema

### 3.1 Core Tables

```prisma
// Project & Survey Management
model Project {
  id                String    @id @default(cuid())
  name              String
  description       String?
  surveyType        SurveyType
  surveyOrder       Int       // Kenya survey order number
  status            ProjectStatus @default(ACTIVE)
  
  // Location
  county            String?
  subCounty         String?
  lrNumber          String?   // Land registration number
  
  // Datum & Projection
  datum             DatumType @default(ARC1960)
  projection        ProjectionType @default(UTM37S)
  zone              Int?
  
  // Audit
  surveyorName      String
  surveyorLicense   String    // Kenya surveyor license number
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  surveys           Survey[]
  documents         Document[]
  
  @@index([surveyorLicense])
  @@index([status])
  @@index([createdAt])
}

model Survey {
  id                String    @id @default(cuid())
  projectId         String
  project           Project   @relation(fields: [projectId], references: [id])
  
  surveyType        SurveyType
  method            SurveyMethod  // TRAVERSE, TRIANGULATION, GPS, LEVELING
  order             Int           // 1st, 2nd, 3rd, 4th order
  
  // Correction parameters applied
  correctionsApplied Json       // {atmospheric: true, cr: true, scaleFactor: true, ...}
  correctionParams   Json?      // Atmospheric conditions, etc.
  
  // Results
  misclosureDistance  Float?    // Linear misclosure in meters
  misclosureRatio     String?   // e.g., "1:25000"
  accuracyAchieved    Float?    // Achieved accuracy ratio
  
  status             ComputationStatus @default(PENDING)
  computedAt         DateTime?
  
  stations           Station[]
  observations       Observation[]
  coordinates        Coordinate[]
  
  @@index([projectId])
  @@index([status])
}

model Station {
  id                String    @id @default(cuid())
  surveyId          String
  survey            Survey    @relation(fields: [surveyId], references: [id])
  
  name              String    // Station name/number
  type              StationType // TRAVERSE, CONTROL, BEACON, BENCHMARK
  
  order             Int       // Sequential order in traverse
  
  @@index([surveyId])
  @@index([name])
}

model Observation {
  id                String    @id @default(cuid())
  surveyId          String
  survey            Survey    @relation(fields: [surveyId], references: [id])
  
  fromStationId     String
  toStationId       String
  
  // Raw measurements
  rawHorizontalAngle  Float?  // Decimal degrees
  rawVerticalAngle    Float?  // Decimal degrees
  rawSlopeDistance     Float?  // Meters
  
  // EDM data
  edmConstant         Float?  // Instrument constant (mm)
  ppmSetting          Float?  // Parts per million setting
  
  // Atmospheric conditions at time of measurement
  temperature         Float?  // Degrees Celsius
  pressure            Float?  // Hectopascals/mbar
  humidity            Float?  // Relative humidity %
  
  // Height data
  instrumentHeight    Float?  // Meters
  targetHeight        Float?  // Meters
  
  // Corrected values (computed)
  correctedDistance    Float?  // After all corrections applied
  correctedHd         Float?  // Horizontal distance
  correctedVd         Float?  // Vertical distance
  correctedBearing    Float?  // Grid bearing
  
  // Corrections log (full audit trail)
  correctionsLog      Json?   // {atmospheric: {raw: 100, corrected: 99.987}, ...}
  
  // Uncertainty
  stdDevDistance      Float?  // Standard deviation of corrected distance
  stdDevAngle         Float?  // Standard deviation of corrected angle
  
  observationDate     DateTime?
  
  @@index([surveyId])
  @@index([fromStationId])
  @@index([toStationId])
}

model Coordinate {
  id                String    @id @default(cuid())
  surveyId          String
  survey            Survey    @relation(fields: [surveyId], references: [id])
  stationId         String
  station           Station   @relation(fields: [stationId], references: [id])
  
  // Adjusted coordinates
  easting           Float     // Meters
  northing          Float     // Meters
  elevation         Float?    // Meters (orthometric height)
  
  // Coordinate system
  datum             DatumType @default(ARC1960)
  projection        ProjectionType @default(UTM37S)
  zone              Int?
  
  // Uncertainty
  stdDevEasting     Float?    // Standard deviation
  stdDevNorthing    Float?
  stdDevElevation   Float?
  errorEllipseSemiMajor  Float?  // Error ellipse semi-major axis (mm)
  errorEllipseSemiMinor  Float?  // Error ellipse semi-minor axis (mm)
  errorEllipseOrientation Float? // Error ellipse orientation (degrees)
  confidenceLevel   Float?    // Confidence level (e.g., 0.95)
  
  // Scale factor at this point
  pointScaleFactor  Float?
  gridConvergence   Float?    // Degrees
  
  isFixed           Boolean   @default(false)  // Control/fixed point
  
  @@unique([surveyId, stationId])
  @@index([surveyId])
  @@index([easting, northing])
}

model Document {
  id                String    @id @default(cuid())
  projectId         String
  project           Project   @relation(fields: [projectId], references: [id])
  
  documentType      DocumentType
  title             String
  
  // Generation parameters
  paperSize         PaperSize @default(A4)
  orientation       Orientation @default(PORTRAIT)
  scale             Int?      // Map scale denominator (e.g., 1000 for 1:1000)
  
  // File storage
  filePath          String?   // Path to generated PDF
  fileSize          Int?      // Bytes
  checksum          String?   // SHA-256 for integrity verification
  
  // PDF metadata
  pdfVersion        String?   // e.g., "PDF/A-1b"
  isVector          Boolean   @default(false)
  
  generatedAt       DateTime?
  
  @@index([projectId])
  @@index([documentType])
}

// Audit trail for legal compliance
model AuditLog {
  id                String    @id @default(cuid())
  entityType        String    // "Project", "Survey", "Observation", etc.
  entityId          String
  action            String    // "CREATE", "UPDATE", "COMPUTE", "GENERATE"
  userId            String
  userName          String
  changes           Json?     // Before/after snapshot
  timestamp         DateTime  @default(now())
  
  @@index([entityType, entityId])
  @@index([timestamp])
}

// Reference data (cached, rarely changes)
model CoordinateSystem {
  id                String    @id @default(cuid())
  name              String    @unique
  datum             DatumType
  projection        ProjectionType
  zone              Int?
  parameters        Json      // Projection parameters
  epsgCode          Int?
  
  createdAt         DateTime  @default(now())
}

// Enums
enum SurveyType {
  CADASTRAL
  TOPOGRAPHIC
  ENGINEERING
  CONTROL
  HYDROGRAPHIC
  MINING
}

enum SurveyMethod {
  TRAVERSE
  TRIANGULATION
  TRILATERATION
  GPS
  LEVELING
  TOTAL_STATION
}

enum ProjectStatus {
  ACTIVE
  COMPLETED
  ARCHIVED
  DRAFT
}

enum ComputationStatus {
  PENDING
  COMPUTING
  COMPLETED
  FAILED
}

enum StationType {
  TRAVERSE
  CONTROL
  BEACON
  BENCHMARK
  INTERSECTION
}

enum DatumType {
  ARC1960
  WGS84
}

enum ProjectionType {
  UTM36S
  UTM37S
  CASSINI_SOLDNER
  LOCAL
}

enum DocumentType {
  DEED_PLAN
  FORM_C22
  BEACON_CERTIFICATE
  TRAVERSE_SHEET
  SETTING_OUT
  TOPO_PLAN
  CONTOUR_PLAN
  CROSS_SECTION
}

enum PaperSize {
  A4
  A3
  A2
  A1
  A0
}

enum Orientation {
  PORTRAIT
  LANDSCAPE
}
```

### 3.2 Database Optimization

- **Partitioning**: `Observation` and `AuditLog` by `createdAt` (monthly partitions)
- **Connection Pooling**: PgBouncer in transaction mode (max 50 connections)
- **Read Replica**: For heavy queries (document generation, report queries)
- **Indexes**: All foreign keys + commonly queried columns indexed
- **JSON columns**: `correctionsLog`, `correctionParams` use PostgreSQL JSONB with GIN indexes

---

## 4. P0: Core Corrections (Accuracy)

### 4.1 Atmospheric Correction for EDM

**File**: `src/lib/survey/corrections/atmospheric.ts`

**Formula** (IAO/ISO standard):
```
Corrected distance = Raw distance × N0 / N

Where:
  N = (n_ref - 1) × 10^6  (reference refractivity)
  N0 = (n_obs - 1) × 10^6 (observed refractivity)

For standard conditions (t=20°C, P=1013.25 hPa, e=0):
  N0 = 273.82 (typical for most EDM instruments)

For observed conditions:
  N_obs = (n - 1) × 10^6
  n = 1 + (n_group - 1) × λ_ref / λ_obs  (for phase measurement)
  
Simplified (most instruments):
  N = (287.604 + 1.6288 × λ^-2 + 0.0136 × λ^-4) × P / (273.15 + t)
      - (11.27 × e) / (273.15 + t)
      
  Where λ = carrier wavelength in μm (0.6328 for HeNe, 0.850 for IR)
  
  e = humidity × 6.112 × exp(17.62 × t / (243.12 + t)) / 100  (Magnus formula)
```

**Implementation requirements**:
- Support both HeNe (0.6328 μm) and IR (0.850 μm) EDM wavelengths
- Accept temperature (°C), pressure (hPa), humidity (%)
- Auto-compute partial water vapor pressure via Magnus formula
- Return both correction factor and corrected distance
- Include ppm deviation from reference conditions
- Store raw + corrected for audit trail

**Validation**:
- At standard conditions (20°C, 1013.25 hPa, 0% humidity): correction = 0 ppm
- At Nairobi (25°C, 840 hPa, 60% humidity): correction ≈ -22 ppm (distance reduced)
- At Mombasa (32°C, 1010 hPa, 80% humidity): correction ≈ -10 ppm

### 4.2 Curvature & Refraction Correction

**File**: `src/lib/survey/corrections/curvature-refraction.ts`

**Formula**:
```
C&R correction = -0.0675 × D²  (meters, D in km)

This is applied to height difference:
  ΔH_corrected = SD × sin(VA) + (1 - k) / (2R) × D²

Where:
  k = coefficient of refraction (0.13 for Kenya, 0.14 temperate)
  R = mean radius of Earth at latitude = 6370 km (equatorial) to 6357 km (polar)
  R at Kenya latitude (0°-1°S) ≈ 6378 km (close to equatorial)
  D = horizontal distance in km
  
Combined formula:
  ΔH = SD × sin(VA) + (ih - th) + C&R
  Where C&R = (1 - k) / (2R) × D²
  = (1 - 0.13) / (2 × 6378000) × D²
  = 0.0675 × D²  (D in km, result in meters)
```

**Implementation requirements**:
- Accept slope distance, vertical angle, instrument height, target height
- Use latitude-dependent Earth radius (WGS84 ellipsoid)
- Configurable refraction coefficient (default 0.13 for Kenya)
- Return corrected height difference with C&R component separately
- Flag observations where C&R > 10mm (recommendation: apply for all lines >200m)

### 4.3 Grid Scale Factor

**File**: `src/lib/survey/corrections/grid-scale-factor.ts`

**Formula** (UTM):
```
Point scale factor at latitude φ, longitude λ:
  k = k0 × [1 + (λ - λ0)² / 2 × cos²(φ) × (1 + e'² × cos²(φ) + ...)]

Simplified (sufficient for 2nd order):
  k = k0 × (1 + E'² / (2 × Rm²))

Where:
  k0 = 0.9996 (UTM central scale factor)
  E' = easting from central meridian = E - 500000
  Rm = mean radius of curvature at latitude φ
  Rm = √(ρ × ν)
  ρ = a(1 - e²) / (1 - e² × sin²(φ))^(3/2)  (meridional radius)
  ν = a / √(1 - e² × sin²(φ))                (prime vertical radius)
  
For WGS84/Arc 1960:
  a = 6378137.0 m (semi-major axis)
  f = 1/298.257223563
  e² = 2f - f² = 0.00669437999014

For Cassini-Soldner (Kenya cadastral):
  k = 1 + E'² / (2 × Rm²)  (no k0 central factor)
```

**Implementation requirements**:
- Support both UTM (Zone 36S, 37S) and Cassini-Soldner projections
- Compute point scale factor from UTM easting/northing
- Compute line scale factor (average of endpoints or Simpson's rule)
- Include arc-to-chord correction for grid bearings
- Return scale factor, corrected distance, and convergence angle

### 4.4 Sea Level / Ellipsoid Reduction

**File**: `src/lib/survey/corrections/sea-level-reduction.ts`

**Formula**:
```
Reduced distance = Measured distance × R / (R + h)

Where:
  R = mean radius of Earth at latitude (use same Rm as grid scale factor)
  h = mean height of the measured line above the ellipsoid

For Kenya:
  h_ellipsoid ≈ h_orthometric + N (geoid height)
  N (geoid undulation) for Kenya ≈ -10 to -20m (varies by location)
  h_orthometric from leveling ≈ 0-5000m (most work at 1000-2500m)
```

**Implementation requirements**:
- Accept measured distance and mean height of line
- Optional geoid undulation input (default Kenya EGM96 values)
- Apply reduction before grid scale factor
- Full reduction chain: slope → horizontal → sea level → grid
- Return each stage separately for audit trail

### 4.5 Unified Correction Pipeline

**File**: `src/lib/survey/pipeline/correction-pipeline.ts`

**Processing order** (this order matters!):
```
1. EDM Instrument Constant     → Add constant to raw distance
2. Atmospheric Correction       → Correct raw slope distance for temp/pressure/humidity
3. Slope Reduction              → Convert slope distance to horizontal distance
4. Curvature & Refraction       → Correct height difference for C&R
5. Sea Level Reduction          → Reduce horizontal distance to ellipsoid
6. Grid Scale Factor            → Scale ellipsoid distance to grid distance
7. Grid Convergence             → Correct bearings for projection convergence
```

Each stage must:
- Input: observation + previous stage output
- Output: corrected value + correction component + uncertainty contribution
- Log: what was applied, input values, output values
- Flag: if any correction exceeds configurable thresholds

---

## 5. P1: Traverse Engine & Error Propagation

### 5.1 Traverse Engine

**File**: `src/lib/survey/traverse/engine.ts`

**Implementation**:
1. Accept raw observations (angles + distances) + control points
2. Run through correction pipeline (all P0 corrections)
3. Compute preliminary coordinates
4. Compute misclosure (angular + linear)
5. Evaluate misclosure ratio against required order
6. Apply adjustment (Bowditch for 3rd/4th order, Least Squares for 1st/2nd)
7. Compute adjusted coordinates with uncertainties
8. Generate computation sheet data

### 5.2 Error Propagation Engine

**File**: `src/lib/survey/error-propagation/engine.ts`

**Methods**:
1. **Variance propagation**: For any function f(x₁, x₂, ..., xₙ):
   σ²_f = Σ(∂f/∂xᵢ)² × σ²_xᵢ + 2 × Σ(∂f/∂xᵢ)(∂f/∂xⱼ) × σ_xᵢxⱼ

2. **Covariance matrix**: Full variance-covariance matrix from least squares

3. **Error ellipse**: From covariance matrix sub-matrix:
   - Semi-major: a = σ₀√(0.5 × (σ²_E + σ²_N + √((σ²_E - σ²_N)² + 4σ²_EN)))
   - Semi-minor: b = σ₀√(0.5 × (σ²_E + σ²_N - √((σ²_E - σ²_N)² + 4σ²_EN)))
   - Orientation: θ = 0.5 × atan2(2σ_EN, σ²_E - σ²_N)

4. **Reliability**: Redundancy numbers, internal/external reliability

### 5.3 Least Squares Adjustment

**File**: `src/lib/survey/traverse/least-squares.ts`

**Method**: Variation of coordinates (parametric adjustment)
- Design matrix A from observation equations
- Weight matrix P from a priori standard deviations
- Normal equations: N = AᵀPA, solution: δx = N⁻¹AᵀPl
- A posteriori variance factor: σ̂₀² = vᵀPv / (n - u)
- Covariance matrix: C_xx = σ̂₀² × N⁻¹
- Statistical tests: Chi-square test on σ̂₀², local test on residuals

---

## 6. P1: Document Generation (Vector PDF)

### 6.1 PDF Engine

**File**: `src/lib/documents/pdf-engine.ts`

**Requirements**:
- Use `pdfkit` for server-side vector PDF generation
- All lines, arcs, text as vector paths (no raster)
- Proper line weights in mm (0.1mm, 0.15mm, 0.3mm, 0.5mm)
- Text sizes in mm cap height
- Kenya standard fonts (required: Helvetica or Arial)
- PDF/A-1b compliance (archival standard)
- Embedded metadata (surveyor, license, date, project)

### 6.2 Deed Plan Generator

**File**: `src/lib/documents/deed-plan/generator.ts`

**Kenya Deed Plan Standards**:
- Paper size: A1 (594 × 841mm) or A2
- Scale: 1:500, 1:1000, 1:2500
- Line weights: Boundary = 0.5mm, Plot = 0.3mm, Dimension = 0.15mm, Grid = 0.1mm
- Coordinate grid: UTM ticks at 100m intervals with labels
- Title block: Bottom right, LR No., Area, Scale, Surveyor, License, Date, County
- North arrow: With convergence angle notation
- Legend: Beacon types, boundary types
- Scale bar: Graphical + representative fraction

### 6.3 Map Quality Standards

| Feature | Standard | Implementation |
|---------|----------|---------------|
| Beacon symbol | Cross in circle with type | Vector symbol, 3mm diameter |
| Boundary lines | Weighted by type | Scheme=0.5mm, Parcel=0.3mm |
| Coordinate grid | UTM ticks + labels | 100m intervals, 2mm ticks |
| North arrow | With convergence | Survey standard symbol |
| Contour lines | Index + intermediate | Index=0.5mm, Inter=0.15mm |
| Title block | Bottom right | Standard Kenya format |
| Scale bar | Graphical + ratio | Verified accuracy ±0.5mm |

---

## 7. Database Load Reduction Strategy

### 7.1 Offline-First Architecture

```
CLIENT (Field)                    SERVER (Office)
─────────────                     ──────────────
IndexedDB ←──── Sync API ────→ PostgreSQL
(All field work)   (Batch)       (Computation & docs)
```

- **All field data collection happens offline** — IndexedDB stores observations
- **Sync only when connected** — batch upload at end of day
- **Server does heavy computation** — traverse adjustment, document generation
- **Results cached** — adjusted coordinates stored both client and server

### 7.2 Caching Strategy

| Data Type | Cache Location | TTL | Invalidation |
|-----------|---------------|-----|-------------|
| Coordinate system params | In-memory LRU | 24h | On parameter update |
| Datum transformation params | In-memory LRU | 24h | On update |
| Project metadata | In-memory LRU | 5min | On project update |
| Survey computation results | Redis | 1h | On re-computation |
| Generated documents | File system | Permanent | On regeneration |
| User session data | Redis | 30min | On logout |
| Reference data (beacons, control) | In-memory LRU | 1h | On update |

### 7.3 Query Optimization

1. **Connection Pooling**: PgBouncer in transaction mode
   - Max server connections: 50
   - Max client connections: 500
   - Reserve pool: 5 (for admin)

2. **Prepared Statements**: For all frequently-used queries

3. **Batch Operations**:
   - Field sync: Single INSERT with array of observations
   - Coordinate updates: UNNEST-based bulk update
   - Document generation: Queue with BullMQ + Redis

4. **Read-Heavy Query Offloading**:
   - Project listing → Materialized view, refresh on change
   - Coordinate queries → PostGIS spatial index
   - Document listing → Separate read-only connection

5. **Write Optimization**:
   - Observation sync → COPY protocol for bulk inserts
   - Audit log → Async insert via queue (don't block main query)
   - Status updates → Optimistic concurrency with version field

### 7.4 Heavy Computation Offloading

```
┌──────────┐     ┌──────────┐     ┌──────────────┐
│  Next.js │────→│  BullMQ  │────→│  Worker      │
│  API     │     │  Queue   │     │  (Python/TS) │
│  (fast)  │     │  + Redis │     │  (compute)   │
└──────────┘     └──────────┘     └──────────────┘
     ↑                                   │
     └───────── Result via DB ───────────┘
```

- **Traverse adjustment** → Queue, compute async, poll for result
- **Document generation** → Queue, compute async, download when ready
- **Area computation** → Fast enough for inline (<100ms)
- **COGO** → Fast enough for inline (<50ms)

### 7.5 Database Schema Optimization

- **Partitioning**: `Observation` table by month (for large projects)
- **Partial indexes**: `WHERE status = 'ACTIVE'` for project listing
- **JSONB GIN indexes**: On `correctionsLog`, `correctionParams`
- **Covering indexes**: Include frequently-accessed columns in index
- **VACUUM**: Auto-vacuum tuned for write-heavy observation tables

---

## 8. P2: Map Rendering & Cartography

### 8.1 Server-Side Map Rendering

**Technology**: MapLibre Native + Mapnik (via Node.js bindings)

**Pipeline**:
1. Receive map specification (extent, scale, layers, symbology)
2. Render vector layers server-side at required DPI
3. Composite with raster layers (aerial photos)
4. Output as PDF (vector) or high-DPI PNG (raster fallback)
5. Add title block, grid, legend, scale bar

### 8.2 Kenya Standard Symbology

**File**: `src/lib/documents/deed-plan/symbology.ts`

All symbols defined as SVG paths for vector rendering:
- Beacon types: Cross in circle, triangle in circle, square in circle
- Boundary types: Solid, dashed, dot-dash (by ownership type)
- Vegetation: Tree, hedge, fence symbols
- Water: Blue line, blue fill patterns
- Buildings: Hatched fill, solid outline
- Contours: Brown, index bold, intermediate thin

---

## 9. P3: Advanced Features

### 9.1 Deflection of Vertical Correction
- For 1st order astronomical observations
- Requires geoid model (EGM96 or Kenya local geoid)
- Applies Laplace correction to azimuths

### 9.2 Geoid Model Integration
- EGM96 or EGM2008 for Kenya
- Interpolation of geoid undulation at any point
- Converts GPS ellipsoidal heights to orthometric heights

### 9.3 Digital Signature
- PDF digital signature placeholder
- PKI integration for document authentication
- Timestamp authority integration

---

## 10. Build Order & Dependencies

```
Phase 1 — Foundation (Week 1-2)
├── 1.1 Initialize Next.js project with TypeScript
├── 1.2 Set up Prisma with PostgreSQL
├── 1.3 Create database schema & migrations
├── 1.4 Build correction modules (P0)
│   ├── 1.4.1 atmospheric.ts
│   ├── 1.4.2 curvature-refraction.ts
│   ├── 1.4.3 grid-scale-factor.ts
│   ├── 1.4.4 sea-level-reduction.ts
│   ├── 1.4.5 slope-reduction.ts
│   └── 1.4.6 correction-pipeline.ts (unified)
├── 1.5 Write comprehensive tests for all corrections
└── 1.6 Build in-memory cache layer

Phase 2 — Computation Engine (Week 3-4)
├── 2.1 Traverse engine (bowditch + least squares)
├── 2.2 Error propagation engine
├── 2.3 Error ellipse computation
├── 2.4 COGO engine
├── 2.5 Area computation (Shoelace + radial)
├── 2.6 Curve calculations (circular + transition + vertical)
├── 2.7 Coordinate transformations (Arc 1960 ↔ WGS84)
├── 2.8 Projection handling (UTM + Cassini-Soldner)
└── 2.9 Tests for all computation modules

Phase 3 — Database & API (Week 5-6)
├── 3.1 API routes for survey operations
├── 3.2 Batch sync API for offline data
├── 3.3 Query optimization & connection pooling
├── 3.4 BullMQ job queue for heavy computation
├── 3.5 Redis caching layer
├── 3.6 Audit trail implementation
└── 3.7 API integration tests

Phase 4 — Document Generation (Week 7-8)
├── 4.1 PDF engine (pdfkit vector rendering)
├── 4.2 Deed plan generator with Kenya standards
├── 4.3 Title block template
├── 4.4 Coordinate grid & tick marks
├── 4.5 Kenya standard symbology (SVG)
├── 4.6 Scale verification test
├── 4.7 PDF/A-1b compliance
├── 4.8 Form C-22 template
├── 4.9 Beacon certificate template
└── 4.10 Traverse computation sheet

Phase 5 — Map & Cartography (Week 9-10)
├── 5.1 Server-side map rendering setup
├── 5.2 Mapnik/MapLibre integration
├── 5.3 Professional cartographic output
├── 5.4 A1/A0 print at 600 DPI
└── 5.5 Map quality verification

Phase 6 — Polish & Integration (Week 11-12)
├── 6.1 UI components for field data collection
├── 6.2 Map viewer integration
├── 6.3 Document preview & download
├── 6.4 Offline sync UI
├── 6.5 End-to-end testing
└── 6.6 Performance testing & optimization
```

---

## 11. Testing Strategy

### 11.1 Unit Tests (per module)
- Each correction: known input → expected output
- Traverse: Known traverse with published results
- COGO: Standard bearing/distance problems with known answers
- Area: Regular polygons with known areas
- Error propagation: Simple functions with analytically derivable variances

### 11.2 Integration Tests
- Full correction pipeline: raw observations → corrected coordinates
- Traverse: Raw observations → adjusted coordinates → error ellipses
- Document: Coordinates → PDF → verify scale accuracy

### 11.3 Validation Datasets
- **Kenya Survey Department test traverse**: Published coordinates for verification
- **UTM Zone 37S test points**: Known scale factors and convergences
- **Nairobi altitude tests**: Sea level reduction at ~1700m elevation
- **Reference atmospheric conditions**: Standard, Nairobi, Mombasa

### 11.4 Accuracy Benchmarks

| Computation | Required Accuracy | Test Method |
|-------------|------------------|-------------|
| Atmospheric correction | ±0.1 ppm | Compare with NGA formula |
| C&R correction | ±1mm at 1km | Compare with published tables |
| Grid scale factor | ±1 ppm | Compare with NGA/NGS values |
| Sea level reduction | ±1 ppm | Compare with published formula |
| Traverse closure | 1:100,000 (1st order) | Test traverse |
| Area computation | ±0.001 m² | Regular polygon test |
| Coordinate transform | ±10mm | Known Arc 1960 ↔ WGS84 points |
| Deed plan plotting | ±0.5mm on paper | Scale verification |

---

## 12. Accuracy Verification Protocol

### 12.1 Self-Check After Each Computation
1. Misclosure ratio must meet or exceed required order
2. All corrections must be within expected ranges
3. Error ellipses must be reasonable (not >10cm for cadastral)
4. A posteriori variance factor must pass Chi-square test (95% confidence)

### 12.2 Scale Verification for Printed Documents
1. After generating PDF, programmatically measure key distances
2. Compare measured distance × scale = ground distance
3. Tolerance: ±0.5mm on paper at declared scale
4. Auto-fail document if scale verification fails

### 12.3 Cadastral 100% Accuracy Requirements

To achieve 100% cadastral accuracy (every deed plan passes Ardhi House scrutiny):

1. **All P0 corrections applied** — eliminates 600-700 ppm systematic error
2. **Least squares adjustment** — provides statistically optimal coordinates
3. **Error ellipses computed** — proves reliability of positions
4. **Vector PDF with correct line weights** — professional cartographic quality
5. **Kenya standard title block** — meets formatting requirements
6. **Coordinate grid with ticks** — required for plan acceptance
7. **Scale verification** — guarantees plotting accuracy
8. **Full audit trail** — every correction logged, every computation reproducible
9. **PDF/A archival** — document integrity guaranteed
10. **Checksum on documents** — tamper detection

---

## Appendix A: Kenya-Specific Parameters

```
Kenya Survey Reference Data:
─────────────────────────────
Datum: Arc 1960 (Clarke 1880 modified ellipsoid)
  Semi-major axis (a): 6378249.145 m
  Flattening (f): 1/293.465

Transformation Arc 1960 → WGS84:
  ΔX = -157 m
  ΔY = -2 m  
  ΔZ = -291 m
(7-parameter Helmert, Kenya national parameters)

UTM Zones:
  Zone 36S: Central meridian 33°E (western Kenya)
  Zone 37S: Central meridian 39°E (central/eastern Kenya)

Cassini-Soldner (for cadastral):
  Origin latitude: 0° (equator)
  Origin longitude: varies by local system
  False easting: varies
  False northing: 0

Refraction coefficient:
  Kenya (tropical): k = 0.13 (daytime)
  Kenya (night): k = 0.16

Geoid undulation (N):
  Nairobi: approximately -10 to -15 m
  Mombasa: approximately -5 to -10 m
  (Use EGM96 or EGM2008 model for precise values)

Atmospheric conditions (typical):
  Nairobi (1700m): T=20°C, P=830 hPa, RH=60%
  Mombasa (50m): T=30°C, P=1010 hPa, RH=75%
  Kisumu (1130m): T=24°C, P=880 hPa, RH=65%
```

---

## Appendix B: NPM Dependencies

```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "prisma": "^6.0.0",
    "@prisma/client": "^6.0.0",
    "pdfkit": "^0.15.0",
    "proj4": "^2.11.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0",
    "@types/pdfkit": "^0.13.0"
  }
}
```

---

*This plan is designed to be self-contained — any developer or AI agent can pick it up and continue building from any phase.*
