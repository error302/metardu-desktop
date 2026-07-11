/**
 * Topographic Survey Standards — ASPRS/USACE tables and country-adapted rules.
 *
 * Reference:
 *   USACE EM 1110-1-1005 Table 4-3 (planimetric RMSE by map scale)
 *   USACE EM 1110-1-1005 Table 4-4 (topographic RMSE by contour interval)
 *   ASPRS Positional Accuracy Standards (2014)
 *   Kenya Survey Reg 74 (boundary point tolerance)
 *   Bahrain CSD §E.3.6 (detail survey)
 */

import type { SurveyingCountry } from '@/lib/country/standards'
import { getCountryStandard } from '@/lib/country/standards'

// ─── ASPRS PLANIMETRIC ACCURACY TABLE ─────────────────────────────────────────
// Table 4-3: RMSE thresholds (feet) at each scale, 3 ASPRS classes.
// Source: USACE EM 1110-1-1005 Table 4-3 / ASPRS 2014.

export interface ASPRSPlanimetricEntry {
  scale: string
  scaleRatio: number
  class1: number   // feet — well-defined points only
  class2: number
  class3: number
}

export const ASPRS_PLANIMETRIC: ASPRSPlanimetricEntry[] = [
  { scale: "1\"=20'",   scaleRatio:      240, class1: 0.05,   class2: 0.10,  class3: 0.20  },
  { scale: "1\"=30'",   scaleRatio:      360, class1: 0.075,  class2: 0.15,  class3: 0.30  },
  { scale: "1\"=40'",   scaleRatio:      480, class1: 0.10,   class2: 0.20,  class3: 0.40  },
  { scale: "1\"=50'",   scaleRatio:      600, class1: 0.125,  class2: 0.25,  class3: 0.50  },
  { scale: "1\"=60'",   scaleRatio:      720, class1: 0.15,   class2: 0.30,  class3: 0.60  },
  { scale: "1\"=80'",   scaleRatio:      960, class1: 0.20,   class2: 0.40,  class3: 0.80  },
  { scale: "1\"=100'",  scaleRatio:    1200, class1: 0.25,   class2: 0.50,  class3: 1.00  },
  { scale: "1\"=200'",  scaleRatio:    2400, class1: 0.50,   class2: 1.00,  class3: 2.00  },
  { scale: "1\"=400'",  scaleRatio:    4800, class1: 1.00,   class2: 2.00,  class3: 4.00  },
  { scale: "1\"=500'",  scaleRatio:    6000, class1: 1.25,   class2: 2.50,  class3: 5.00  },
  { scale: "1\"=1,000'",scaleRatio:  12_000, class1: 0.304, class2: 0.608, class3: 1.216 },
  { scale: "1\"=2,000'",scaleRatio:  24_000, class1: 5.00,   class2: 10.00, class3: 20.00 },
  { scale: "1\"=5,000'",scaleRatio:  60_000, class1: 12.50,  class2: 25.00, class3: 50.00 },
  { scale: "1\"=10,000'",scaleRatio: 120_000, class1: 25.00,  class2: 50.00, class3: 100.00},
  { scale: "1\"=20,000'",scaleRatio: 240_000, class1: 50.00,  class2: 100.00,class3: 200.00},
  { scale: "1\"=50,000'",scaleRatio: 600_000, class1: 125.00, class2: 250.00,class3: 500.00},
  { scale: "1\"=100,000'",scaleRatio:1_200_000, class1: 250.00,class2: 500.00,class3: 1000.00},
]

// ─── ASPRS TOPOGRAPHIC / CONTOUR ACCURACY TABLE ────────────────────────────────
// Table 4-4: RMSE vertical (feet) by contour interval, 3 classes.

export interface ASPROTopographicEntry {
  contourInterval: number  // feet
  class1: number   // RMSE vertical, feet
  class2: number
  class3: number
}

export const ASPRS_TOPOGRAPHIC: ASPROTopographicEntry[] = [
  { contourInterval:  0.5,  class1: 0.033,  class2: 0.067,  class3: 0.133 },
  { contourInterval:  1.0,  class1: 0.067,  class2: 0.133,  class3: 0.267 },
  { contourInterval:  2.0,  class1: 0.133,  class2: 0.267,  class3: 0.533 },
  { contourInterval:  5.0,  class1: 0.333,  class2: 0.667,  class3: 1.333 },
  { contourInterval: 10.0,  class1: 0.667,  class2: 1.333,  class3: 2.667 },
  { contourInterval: 20.0,  class1: 1.333,  class2: 2.667,  class3: 5.333 },
]

// ─── CONTOUR INTERVAL RECOMMENDATIONS BY TERRAIN ──────────────────────────────

export interface ContourIntervalSpec {
  interval: number       // metres
  description: string
  suitableFor: string[]
}

export const CONTOUR_INTERVALS_M: ContourIntervalSpec[] = [
  { interval: 0.25,  description: 'Very flat terrain / datum reference',       suitableFor: ['flat_land', 'tidal', 'engineering_cut_fill'] },
  { interval: 0.50,  description: 'Flat terrain with gentle slopes',          suitableFor: ['flat', 'agricultural'] },
  { interval: 1.00,  description: 'Gentle rolling terrain',                   suitableFor: ['gentle_slope', 'urban_flat'] },
  { interval: 1.50,  description: 'Standard cadastral + topo',                 suitableFor: ['cadastral_topo', 'KETRACO'] },
  { interval: 2.00,  description: 'KETRACO / rural topo / transmission line', suitableFor: ['KETRACO', 'rural_topo', 'transmission_corridor'] },
  { interval: 2.50,  description: 'Rolling terrain / general purpose',        suitableFor: ['rolling', 'general_topo'] },
  { interval: 5.00,  description: 'Hilly terrain',                            suitableFor: ['hilly', 'watershed'] },
  { interval: 10.0,  description: 'Mountainous terrain',                       suitableFor: ['mountainous', 'coastal_1_5000'] },
  { interval: 20.0,  description: 'Steep mountainous / small-scale',           suitableFor: ['steep_mountain', 'small_scale'] },
]

// ─── FEATURE CODES (USACE §7-5 / ALTA) ────────────────────────────────────────

export interface FeatureCode {
  code: string
  description: string
  category: 'boundary' | 'structure' | 'transportation' | 'utilities' | 'hydrography' | 'vegetation' | 'relief'
  surveyClass: 'monument' | 'defined' | 'inferred'
}

export const FEATURE_CODES: FeatureCode[] = [
  { code: 'BOUND-MON', description: 'Survey monument / iron pin',            category: 'boundary',   surveyClass: 'monument'   },
  { code: 'BOUND-NAIL', description: 'Mag nail / PK nail on pavement',       category: 'boundary',   surveyClass: 'defined'    },
  { code: 'BOUND-FENCE', description: 'Fence line (by survey)',              category: 'boundary',   surveyClass: 'inferred'   },
  { code: 'BOUND-HEDGE', description: 'Live hedge / tree line',             category: 'boundary',   surveyClass: 'inferred'   },
  { code: 'STR-BLDG',    description: 'Building outline',                    category: 'structure',  surveyClass: 'defined'    },
  { code: 'STR-WALL',    description: 'Retaining wall / boundary wall',     category: 'structure',  surveyClass: 'defined'    },
  { code: 'STR-POOL',    description: 'Swimming pool / pond',                category: 'structure',  surveyClass: 'defined'    },
  { code: 'TRANS-ROAD',  description: 'Road centreline / edge',              category: 'transportation', surveyClass: 'defined' },
  { code: 'TRANS-RW',    description: 'Railway',                             category: 'transportation', surveyClass: 'defined' },
  { code: 'UTIL-WATER',  description: 'Water line / main',                   category: 'utilities',  surveyClass: 'defined'    },
  { code: 'UTIL-SEWER',  description: 'Sewer line',                         category: 'utilities',  surveyClass: 'defined'    },
  { code: 'UTIL-GAS',    description: 'Gas line / main',                    category: 'utilities',  surveyClass: 'defined'    },
  { code: 'UTIL-ELEC',   description: 'Overhead power line',                 category: 'utilities',  surveyClass: 'defined'    },
  { code: 'UTIL-OVHD',   description: 'Overhead communication line',         category: 'utilities',  surveyClass: 'defined'    },
  { code: 'HYD-EDGE',    description: 'Water edge / stream bank',           category: 'hydrography', surveyClass: 'defined'   },
  { code: 'HYD-CENTER',  description: 'Stream centreline',                  category: 'hydrography', surveyClass: 'defined'   },
  { code: 'HYD-FLOOD',   description: 'Flood plain boundary',                category: 'hydrography', surveyClass: 'inferred'   },
  { code: 'VEG-GRASS',   description: 'Grass / lawn',                       category: 'vegetation', surveyClass: 'inferred'   },
  { code: 'VEG-TREE',    description: 'Canopy tree / woodland edge',         category: 'vegetation', surveyClass: 'inferred'   },
  { code: 'VEG-CULT',    description: 'Cultivation boundary',                 category: 'vegetation', surveyClass: 'inferred'   },
  { code: 'REL-BRKP',    description: 'Breakline / ridge line',             category: 'relief',     surveyClass: 'defined'    },
  { code: 'REL-TOE',     description: 'Toe of slope / cut or fill line',    category: 'relief',     surveyClass: 'defined'    },
  { code: 'REL-CULV',    description: 'Culvert / drainage structure',        category: 'relief',     surveyClass: 'defined'    },
]

// ─── MAP SCALE SELECTION ─────────────────────────────────────────────────────

export interface MapScaleSpec {
  scale: string
  rmseClass1M: number  // metres
  use: string[]
  countries: string[]
}

export const MAP_SCALES: MapScaleSpec[] = [
  { scale: "1:50",    rmseClass1M: 0.015,   use: ['engineering_detail'],        countries: ['us']    },
  { scale: "1:100",   rmseClass1M: 0.030,   use: ['engineering_detail'],         countries: ['us']    },
  { scale: "1:200",   rmseClass1M: 0.061,   use: ['engineering_detail'],         countries: ['us']    },
  { scale: "1:500",   rmseClass1M: 0.152,   use: ['site_plan', 'engineering'],  countries: ['us', 'uk', 'australia'] },
  { scale: "1:1,000", rmseClass1M: 0.304,   use: ['site_plan', 'cadastral_topo'], countries: ['us', 'uk', 'australia', 'kenya'] },
  { scale: "1:1,250", rmseClass1M: 0.381,   use: ['site_plan', 'cadastral_topo'], countries: ['uk']    },
  { scale: "1:2,000", rmseClass1M: 0.609,   use: ['cadastral_topo'],             countries: ['us', 'uk', 'australia', 'kenya'] },
  { scale: "1:2,500", rmseClass1M: 0.762,   use: ['KETRACO_topo'],               countries: ['kenya'] },
  { scale: "1:5,000", rmseClass1M: 1.524,   use: ['intermediate_topo', 'planning'], countries: ['us', 'kenya', 'bahrain'] },
  { scale: "1:10,000",rmseClass1M: 3.048,   use: ['small_scale_topo', 'planning'], countries: ['us', 'kenya'] },
  { scale: "1:50,000",rmseClass1M: 15.24,   use: ['regional_planning'],         countries: ['us']    },
  { scale: "1:100,000",rmseClass1M: 30.48,  use: ['small_scale'],               countries: ['us']    },
  { scale: "1:250,000",rmseClass1M: 76.20,  use: ['strategic_planning'],        countries: ['us']    },
]

// ─── NSSDA RADIAL ACCURACY ────────────────────────────────────────────────────
// USACE EM 1110-1-1005 §4-3: NSSDA = 2.447 × RMSE (horizontal), 1.96 × RMSE (vertical)
// 95% confidence level.

export function nssdaHorizontal(rmseMetres: number): number {
  return 2.447 * rmseMetres
}

export function nssdaVertical(rmseMetres: number): number {
  return 1.96 * rmseMetres
}

// ─── COUNTRY-ADAPTED TOPO CONFIGURATION ───────────────────────────────────────

export interface TopoConfig {
  defaultContourInterval: number   // metres
  defaultScale: string
  rmseClass: 1 | 2 | 3
  featureCodes: string[]
  requiresDTM: boolean
  requiresBreaklines: boolean
  regulation: string
}

export function getTopoConfigForCountry(country: SurveyingCountry): TopoConfig {
  switch (country) {
    case 'kenya':
      return {
        defaultContourInterval: 2.0,
        defaultScale: '1:2,500',
        rmseClass: 2,
        featureCodes: ['BOUND-MON', 'BOUND-NAIL', 'BOUND-FENCE', 'STR-BLDG', 'TRANS-ROAD', 'HYD-EDGE', 'VEG-TREE', 'REL-TOE'],
        requiresDTM: true,
        requiresBreaklines: false,
        regulation: 'Kenya Survey Regulations (Legal Notice 168 of 1994, Revised 2024)',
      }
    case 'bahrain':
      return {
        defaultContourInterval: 1.0,
        defaultScale: '1:5,000',
        rmseClass: 1,
        featureCodes: ['BOUND-MON', 'STR-BLDG', 'STR-WALL', 'TRANS-ROAD', 'UTIL-WATER', 'HYD-EDGE'],
        requiresDTM: true,
        requiresBreaklines: true,
        regulation: 'Bahrain CSD §E.3.6 / PRN RTK GPS Specifications',
      }
    case 'new_zealand':
      return {
        defaultContourInterval: 1.0,
        defaultScale: '1:1,000',
        rmseClass: 1,
        featureCodes: ['BOUND-MON', 'BOUND-NAIL', 'STR-BLDG', 'TRANS-ROAD', 'HYD-EDGE', 'HYD-FLOOD'],
        requiresDTM: true,
        requiresBreaklines: true,
        regulation: 'LINZ Survey Rules / NZS 3902',
      }
    case 'us':
      return {
        defaultContourInterval: 2.0,
        defaultScale: '1:5,000',
        rmseClass: 1,
        featureCodes: ['BOUND-MON', 'BOUND-NAIL', 'STR-BLDG', 'STR-WALL', 'STR-POOL', 'TRANS-ROAD', 'TRANS-RW', 'UTIL-WATER', 'UTIL-SEWER', 'UTIL-GAS', 'UTIL-ELEC', 'HYD-EDGE', 'HYD-CENTER', 'VEG-TREE', 'VEG-GRASS', 'REL-BRKP', 'REL-TOE'],
        requiresDTM: true,
        requiresBreaklines: true,
        regulation: 'USACE EM 1110-1-1005 §7-5 / ASPRS Positional Accuracy Standards 2014',
      }
    case 'uk':
      return {
        defaultContourInterval: 1.0,
        defaultScale: '1:1,250',
        rmseClass: 1,
        featureCodes: ['BOUND-MON', 'BOUND-FENCE', 'STR-BLDG', 'STR-WALL', 'TRANS-ROAD', 'HYD-EDGE', 'VEG-HEDGE'],
        requiresDTM: true,
        requiresBreaklines: true,
        regulation: 'Ordnance Survey / RICS / HMLR Land Registration Act 2002',
      }
    case 'australia':
      return {
        defaultContourInterval: 1.0,
        defaultScale: '1:1,000',
        rmseClass: 1,
        featureCodes: ['BOUND-MON', 'STR-BLDG', 'STR-WALL', 'TRANS-ROAD', 'HYD-EDGE', 'VEG-TREE', 'REL-BRKP'],
        requiresDTM: true,
        requiresBreaklines: false,
        regulation: 'ICSM Standards and Practices 2021 / AS5488-2013',
      }
    case 'south_africa':
      return {
        defaultContourInterval: 1.0,
        defaultScale: '1:5,000',
        rmseClass: 2,
        featureCodes: ['BOUND-MON', 'BOUND-FENCE', 'STR-BLDG', 'TRANS-ROAD', 'HYD-EDGE', 'VEG-TREE'],
        requiresDTM: true,
        requiresBreaklines: false,
        regulation: 'SABS ISO 17123 / PLATO regulations',
      }
    default:
      return {
        defaultContourInterval: 2.0,
        defaultScale: '1:5,000',
        rmseClass: 2,
        featureCodes: ['BOUND-MON', 'BOUND-NAIL', 'STR-BLDG', 'TRANS-ROAD', 'HYD-EDGE'],
        requiresDTM: false,
        requiresBreaklines: false,
        regulation: getCountryStandard(country).name,
      }
  }
}

// ─── ASPRS TABLE LOOKUP ───────────────────────────────────────────────────────

export function getASPRSRMSE(scale: string, asprsClass: 1 | 2 | 3 = 1): number {
  const entry = ASPRS_PLANIMETRIC.find((e: any) => e.scale === scale)
  if (!entry) return 0
  return entry[`class${asprsClass}`] as number
}

export function getASPRSContourRMSE(contourFt: number, asprsClass: 1 | 2 | 3 = 1): number {
  const entry = ASPRS_TOPOGRAPHIC.find((e: any) => e.contourInterval === contourFt)
  if (!entry) return 0
  return entry[`class${asprsClass}`] as number
}

// ─── BOUNDARY POINT TOLERANCE ─────────────────────────────────────────────────

export interface BoundaryToleranceResult {
  tolerance: number       // metres
  unit: string
  basedOn: string
  regulation: string
}

export function getBoundaryTolerance(
  country: SurveyingCountry,
  distanceMetres?: number
): BoundaryToleranceResult {
  switch (country) {
    case 'kenya':
      return {
        tolerance: 0.10,  // Reg 74: within 10cm of computed position
        unit: 'metres',
        basedOn: 'Kenya Survey Reg 74: boundary point within 0.1m of computed position',
        regulation: 'Legal Notice 168 of 1994 (Revised 2024)',
      }
    case 'bahrain':
      return {
        tolerance: 0.05,  // PRN spec: 5cm for boundary monuments
        unit: 'metres',
        basedOn: 'Bahrain PRN RTK GPS: 5cm horizontal accuracy for monuments',
        regulation: 'Bahrain CSD Cadastral Survey Standards 2nd Ed 2024',
      }
    case 'us':
      return {
        tolerance: 0.020 + 0.00005 * (distanceMetres ?? 0),  // ALTA: 20mm + 50ppm
        unit: 'metres',
        basedOn: `ALTA/ACSM: 20mm + 50ppm (at ${distanceMetres ?? 0}m = ${(0.020 + 0.00005 * (distanceMetres ?? 0)).toFixed(3)}m)`,
        regulation: 'ALTA/ACSM Minimum Standard Detail Requirements (1999)',
      }
    case 'uk':
      return {
        tolerance: 0.10,
        unit: 'metres',
        basedOn: 'HMLR / RICS: positional accuracy ±10cm for boundary definitions',
        regulation: 'Land Registration Act 2002 / RICS Professional Statement',
      }
    case 'australia':
      return {
        tolerance: 0.10,
        unit: 'metres',
        basedOn: 'ICSM / State LRS: ±10cm for boundary positions',
        regulation: 'ICSM Standards and Practices 2021',
      }
    case 'new_zealand':
      return {
        tolerance: 0.05,
        unit: 'metres',
        basedOn: 'LINZ: boundary coordinates to 0.05m (5cm) precision',
        regulation: 'LINZ Survey Rules / NZ Geodetic Datum 2000',
      }
    default:
      return {
        tolerance: 0.10,
        unit: 'metres',
        basedOn: 'Default: ±10cm positional tolerance',
        regulation: getCountryStandard(country).name,
      }
  }
}
