/**
 * CRS (Coordinate Reference System) Database for MetaRDU Desktop v2.0.
 *
 * Provides EPSG codes, datums, projections, and geoid models for all
 * supported countries. Used by the country-pack system to automatically
 * configure the correct CRS based on the project location.
 *
 * Supported countries:
 *   Kenya (KEN) — Arc 1960 / UTM zone 37S, Cassini-Soldner
 *   Tanzania (TZA) — Arc 1960 / UTM zone 37S
 *   Uganda (UGA) — Arc 1960 / UTM zone 36N
 *   Rwanda (RWA) — WGS84 / UTM zone 36S
 *   Burundi (BDI) — WGS84 / UTM zone 35S
 *   Ethiopia (ETH) — WGS84 / UTM zone 37N
 *   South Sudan (SSD) — WGS84 / UTM zone 36N
 *   Australia (AUS) — GDA2020 / MGA zone 50-56
 *   UAE (ARE) — WGS84 / UTM zone 40N
 *   UK (GBR) — OSGB36 / British National Grid
 *   USA (USA) — NAD83 / UTM zones 1-19, State Plane
 */

export interface CrsDefinition {
  /** EPSG code */
  epsg: number;
  /** CRS name */
  name: string;
  /** Datum */
  datum: string;
  /** Projection type */
  projection: "UTM" | "Cassini-Soldner" | "Transverse Mercator" | "Lambert Conformal Conic" | "Oblique Mercator";
  /** EPSG area name */
  area: string;
  /** Bounding box [south, west, north, east] */
  bounds: [number, number, number, number];
  /** UTM zone (for UTM projections) */
  utmZone?: number;
  /** UTM hemisphere */
  hemisphere?: "N" | "S";
  /** Central meridian (for TM/Cassini) */
  centralMeridian?: number;
  /** False easting */
  falseEasting?: number;
  /** False northing */
  falseNorthing?: number;
  /** Scale factor */
  scaleFactor?: number;
  /** Latitude of origin */
  latitudeOfOrigin?: number;
  /** Geoid model to use for this CRS */
  geoidModel?: string;
}

// ─── Kenya CRS ─────────────────────────────────────────────────────

export const KENYA_CRS: CrsDefinition[] = [
  {
    epsg: 21037,
    name: "Arc 1960 / UTM zone 37S",
    datum: "Arc 1960",
    projection: "UTM",
    area: "Kenya — 36°E to 42°E",
    bounds: [-5, 36, 5, 42],
    utmZone: 37,
    hemisphere: "S",
    falseEasting: 500000,
    falseNorthing: 10000000,
    scaleFactor: 0.9996,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  {
    epsg: 21036,
    name: "Arc 1960 / UTM zone 36N",
    datum: "Arc 1960",
    projection: "UTM",
    area: "Kenya — 30°E to 36°E (western)",
    bounds: [-5, 30, 5, 36],
    utmZone: 36,
    hemisphere: "N",
    falseEasting: 500000,
    falseNorthing: 0,
    scaleFactor: 0.9996,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  {
    epsg: 20537,
    name: "Arc 1960 / Kenya Cassini-Soldner Grid",
    datum: "Arc 1960",
    projection: "Cassini-Soldner",
    area: "Kenya — Cassini-Soldner (historical cadastral)",
    bounds: [-5, 33, 5, 42],
    centralMeridian: 37.0,
    falseEasting: 300000,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: -0.5,
    geoidModel: "EGM2008",
  },
];

// ─── Tanzania CRS ──────────────────────────────────────────────────

export const TANZANIA_CRS: CrsDefinition[] = [
  {
    epsg: 21037,
    name: "Arc 1960 / UTM zone 37S",
    datum: "Arc 1960",
    projection: "UTM",
    area: "Tanzania — 36°E to 42°E",
    bounds: [-12, 36, 0, 42],
    utmZone: 37, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  {
    epsg: 21036,
    name: "Arc 1960 / UTM zone 36S",
    datum: "Arc 1960",
    projection: "UTM",
    area: "Tanzania — 30°E to 36°E",
    bounds: [-12, 30, 0, 36],
    utmZone: 36, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── Uganda CRS ────────────────────────────────────────────────────

export const UGANDA_CRS: CrsDefinition[] = [
  {
    epsg: 21036,
    name: "Arc 1960 / UTM zone 36N",
    datum: "Arc 1960",
    projection: "UTM",
    area: "Uganda — 30°E to 36°E",
    bounds: [-2, 29, 5, 36],
    utmZone: 36, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── Rwanda CRS ────────────────────────────────────────────────────

export const RWANDA_CRS: CrsDefinition[] = [
  {
    epsg: 32736,
    name: "WGS 84 / UTM zone 36S",
    datum: "WGS 84",
    projection: "UTM",
    area: "Rwanda — 30°E to 36°E",
    bounds: [-3, 28, -1, 31],
    utmZone: 36, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── Burundi CRS ───────────────────────────────────────────────────

export const BURUNDI_CRS: CrsDefinition[] = [
  {
    epsg: 32735,
    name: "WGS 84 / UTM zone 35S",
    datum: "WGS 84",
    projection: "UTM",
    area: "Burundi — 24°E to 30°E",
    bounds: [-5, 28, -2, 31],
    utmZone: 35, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── Ethiopia CRS ──────────────────────────────────────────────────

export const ETHIOPIA_CRS: CrsDefinition[] = [
  {
    epsg: 20137,
    name: "Adindan / UTM zone 37N",
    datum: "Adindan",
    projection: "UTM",
    area: "Ethiopia — 36°E to 42°E",
    bounds: [3, 36, 15, 42],
    utmZone: 37, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  {
    epsg: 20138,
    name: "Adindan / UTM zone 38N",
    datum: "Adindan",
    projection: "UTM",
    area: "Ethiopia — 42°E to 48°E",
    bounds: [3, 42, 15, 48],
    utmZone: 38, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── South Sudan CRS ───────────────────────────────────────────────

export const SOUTH_SUDAN_CRS: CrsDefinition[] = [
  {
    epsg: 32636,
    name: "WGS 84 / UTM zone 36N",
    datum: "WGS 84",
    projection: "UTM",
    area: "South Sudan — 30°E to 36°E",
    bounds: [3, 24, 13, 36],
    utmZone: 36, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  {
    epsg: 32635,
    name: "WGS 84 / UTM zone 35N",
    datum: "WGS 84",
    projection: "UTM",
    area: "South Sudan — 24°E to 30°E",
    bounds: [3, 24, 13, 30],
    utmZone: 35, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── Australia CRS (GDA2020) ──────────────────────────────────────

export const AUSTRALIA_CRS: CrsDefinition[] = [
  {
    epsg: 7850,
    name: "GDA2020 / MGA zone 50",
    datum: "GDA2020",
    projection: "UTM",
    area: "Australia — 114°E to 120°E (Western Australia)",
    bounds: [-40, 114, -12, 120],
    utmZone: 50, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "AUSGeoid2020",
  },
  {
    epsg: 7851,
    name: "GDA2020 / MGA zone 51",
    datum: "GDA2020",
    projection: "UTM",
    area: "Australia — 120°E to 126°E (Western Australia/Northern Territory)",
    bounds: [-40, 120, -12, 126],
    utmZone: 51, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "AUSGeoid2020",
  },
  {
    epsg: 7852,
    name: "GDA2020 / MGA zone 52",
    datum: "GDA2020",
    projection: "UTM",
    area: "Australia — 126°E to 132°E (Northern Territory/South Australia)",
    bounds: [-40, 126, -12, 132],
    utmZone: 52, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "AUSGeoid2020",
  },
  {
    epsg: 7853,
    name: "GDA2020 / MGA zone 53",
    datum: "GDA2020",
    projection: "UTM",
    area: "Australia — 132°E to 138°E (South Australia/Queensland)",
    bounds: [-40, 132, -12, 138],
    utmZone: 53, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "AUSGeoid2020",
  },
  {
    epsg: 7854,
    name: "GDA2020 / MGA zone 54",
    datum: "GDA2020",
    projection: "UTM",
    area: "Australia — 138°E to 144°E (Queensland/New South Wales)",
    bounds: [-40, 138, -12, 144],
    utmZone: 54, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "AUSGeoid2020",
  },
  {
    epsg: 7855,
    name: "GDA2020 / MGA zone 55",
    datum: "GDA2020",
    projection: "UTM",
    area: "Australia — 144°E to 150°E (New South Wales/Victoria)",
    bounds: [-40, 144, -12, 150],
    utmZone: 55, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "AUSGeoid2020",
  },
  {
    epsg: 7856,
    name: "GDA2020 / MGA zone 56",
    datum: "GDA2020",
    projection: "UTM",
    area: "Australia — 150°E to 156°E (Queensland East/Tasmania)",
    bounds: [-44, 150, -8, 156],
    utmZone: 56, hemisphere: "S",
    falseEasting: 500000, falseNorthing: 10000000,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "AUSGeoid2020",
  },
];

// ─── UAE CRS ───────────────────────────────────────────────────────

export const UAE_CRS: CrsDefinition[] = [
  {
    epsg: 32640,
    name: "WGS 84 / UTM zone 40N",
    datum: "WGS 84",
    projection: "UTM",
    area: "UAE — 54°E to 60°E",
    bounds: [22, 51, 27, 57],
    utmZone: 40, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── UK CRS ────────────────────────────────────────────────────────

export const UK_CRS: CrsDefinition[] = [
  {
    epsg: 27700,
    name: "OSGB36 / British National Grid",
    datum: "OSGB36",
    projection: "Transverse Mercator",
    area: "United Kingdom — Great Britain (England, Scotland, Wales)",
    bounds: [49, -9, 61, 2],
    centralMeridian: -2.0,
    falseEasting: 400000,
    falseNorthing: -100000,
    scaleFactor: 0.9996012717,
    latitudeOfOrigin: 49.0,
    geoidModel: "OSGM15",
  },
];

// ─── USA CRS (key zones) ──────────────────────────────────────────

export const USA_CRS: CrsDefinition[] = [
  {
    epsg: 32610,
    name: "WGS 84 / UTM zone 10N",
    datum: "WGS 84",
    projection: "UTM",
    area: "USA West Coast — 126°W to 120°W (California, Oregon, Washington)",
    bounds: [30, -126, 50, -120],
    utmZone: 10, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  {
    epsg: 32615,
    name: "WGS 84 / UTM zone 15N",
    datum: "WGS 84",
    projection: "UTM",
    area: "USA Central — 96°W to 90°W (Iowa, Missouri, Arkansas, Louisiana)",
    bounds: [25, -96, 50, -90],
    utmZone: 15, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  {
    epsg: 32618,
    name: "WGS 84 / UTM zone 18N",
    datum: "WGS 84",
    projection: "UTM",
    area: "USA East — 78°W to 72°W (New York, Pennsylvania, Virginia)",
    bounds: [25, -78, 50, -72],
    utmZone: 18, hemisphere: "N",
    falseEasting: 500000, falseNorthing: 0,
    scaleFactor: 0.9996, latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── South Africa CRS (Hartebeesthoek94) ──────────────────────────

export const SOUTH_AFRICA_CRS: CrsDefinition[] = [
  // Hartebeesthoek94 / Lo29 (Johannesburg/Pretoria — most populated area)
  {
    epsg: 2053,
    name: "Hartebeesthoek94 / Lo29",
    datum: "Hartebeesthoek94",
    projection: "Transverse Mercator",
    area: "South Africa — 28°E to 30°E (Gauteng: Johannesburg, Pretoria)",
    bounds: [-35, 28, -22, 30],
    centralMeridian: 29,
    falseEasting: 0,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  // Hartebeesthoek94 / Lo27 (Durban/KZN)
  {
    epsg: 2051,
    name: "Hartebeesthoek94 / Lo27",
    datum: "Hartebeesthoek94",
    projection: "Transverse Mercator",
    area: "South Africa — 26°E to 28°E (KwaZulu-Natal: Durban)",
    bounds: [-35, 26, -22, 28],
    centralMeridian: 27,
    falseEasting: 0,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  // Hartebeesthoek94 / Lo31 (Mpumalanga/Limpopo)
  {
    epsg: 2055,
    name: "Hartebeesthoek94 / Lo31",
    datum: "Hartebeesthoek94",
    projection: "Transverse Mercator",
    area: "South Africa — 30°E to 32°E (Mpumalanga, Limpopo)",
    bounds: [-35, 30, -22, 32],
    centralMeridian: 31,
    falseEasting: 0,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  // Hartebeesthoek94 / Lo19 (Western Cape: Cape Town)
  {
    epsg: 2046,
    name: "Hartebeesthoek94 / Lo19",
    datum: "Hartebeesthoek94",
    projection: "Transverse Mercator",
    area: "South Africa — 18°E to 20°E (Western Cape: Cape Town)",
    bounds: [-35, 18, -22, 20],
    centralMeridian: 19,
    falseEasting: 0,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  // Hartebeesthoek94 / Lo23 (Eastern Cape)
  {
    epsg: 2049,
    name: "Hartebeesthoek94 / Lo23",
    datum: "Hartebeesthoek94",
    projection: "Transverse Mercator",
    area: "South Africa — 22°E to 24°E (Eastern Cape: Gqeberha, East London)",
    bounds: [-35, 22, -22, 24],
    centralMeridian: 23,
    falseEasting: 0,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  // Hartebeesthoek94 / Lo25 (Free State: Bloemfontein)
  {
    epsg: 2050,
    name: "Hartebeesthoek94 / Lo25",
    datum: "Hartebeesthoek94",
    projection: "Transverse Mercator",
    area: "South Africa — 24°E to 26°E (Free State: Bloemfontein)",
    bounds: [-35, 24, -22, 26],
    centralMeridian: 25,
    falseEasting: 0,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  // Hartebeesthoek94 / Lo17 (Northern Cape West)
  {
    epsg: 2045,
    name: "Hartebeesthoek94 / Lo17",
    datum: "Hartebeesthoek94",
    projection: "Transverse Mercator",
    area: "South Africa — 16°E to 18°E (Northern Cape: Springbok)",
    bounds: [-35, 16, -22, 18],
    centralMeridian: 17,
    falseEasting: 0,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
  // Hartebeesthoek94 / Lo33 (Eastern Mpumalanga/Kruger)
  {
    epsg: 2057,
    name: "Hartebeesthoek94 / Lo33",
    datum: "Hartebeesthoek94",
    projection: "Transverse Mercator",
    area: "South Africa — 32°E to 34°E (Kruger National Park area)",
    bounds: [-35, 32, -22, 34],
    centralMeridian: 33,
    falseEasting: 0,
    falseNorthing: 0,
    scaleFactor: 1.0,
    latitudeOfOrigin: 0,
    geoidModel: "EGM2008",
  },
];

// ─── Master CRS database ───────────────────────────────────────────

export const CRS_DATABASE: Record<string, CrsDefinition[]> = {
  KEN: KENYA_CRS,
  TZA: TANZANIA_CRS,
  UGA: UGANDA_CRS,
  RWA: RWANDA_CRS,
  BDI: BURUNDI_CRS,
  ETH: ETHIOPIA_CRS,
  SSD: SOUTH_SUDAN_CRS,
  AUS: AUSTRALIA_CRS,
  ARE: UAE_CRS,
  GBR: UK_CRS,
  USA: USA_CRS,
  ZAF: SOUTH_AFRICA_CRS,
};

/**
 * Find the best CRS for a given latitude/longitude.
 *
 * Selects the CRS whose bounding box contains the point, preferring
 * UTM zones for the correct longitude.
 */
export function findCrsForLocation(lat: number, lng: number): CrsDefinition | null {
  let best: CrsDefinition | null = null;
  let bestScore = -Infinity;

  for (const [, crsList] of Object.entries(CRS_DATABASE)) {
    for (const crs of crsList) {
      // Check if point is within bounds
      const [s, w, n, e] = crs.bounds;
      if (lat >= s && lat <= n && lng >= w && lng <= e) {
        // Prefer UTM with correct zone
        let score = 1;
        if (crs.utmZone) {
          const expectedZone = Math.floor((lng + 180) / 6) + 1;
          if (crs.utmZone === expectedZone) {
            score = 10; // Perfect zone match
          } else {
            score = 1; // Wrong zone but in the area
          }
        }
        // Prefer regional CRS over global
        if (crs.datum !== "WGS 84") {
          score += 2;
        }
        if (score > bestScore) {
          bestScore = score;
          best = crs;
        }
      }
    }
  }

  return best;
}

/**
 * Get CRS by EPSG code.
 */
export function getCrsByEpsg(epsg: number): CrsDefinition | null {
  for (const [, crsList] of Object.entries(CRS_DATABASE)) {
    for (const crs of crsList) {
      if (crs.epsg === epsg) return crs;
    }
  }
  return null;
}

/**
 * List all supported countries.
 */
export function listSupportedCountries(): Array<{ iso3: string; name: string; crsCount: number }> {
  const countryNames: Record<string, string> = {
    KEN: "Kenya", TZA: "Tanzania", UGA: "Uganda", RWA: "Rwanda",
    BDI: "Burundi", ETH: "Ethiopia", SSD: "South Sudan",
    AUS: "Australia", ARE: "UAE", GBR: "United Kingdom", USA: "United States",
    ZAF: "South Africa",
  };
  return Object.entries(CRS_DATABASE).map(([iso3, crsList]) => ({
    iso3,
    name: countryNames[iso3] ?? iso3,
    crsCount: crsList.length,
  }));
}
