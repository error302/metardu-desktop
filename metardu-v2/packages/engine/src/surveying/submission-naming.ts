/**
 * SRVY2025-1 Submission File Naming Generator for MetaRDU Desktop v2.0.
 *
 * Implements the Kenya Land Survey Submission Standards (SRVY2025-1)
 * file naming convention:
 *
 *   [SubmissionNumber]_[SurveyType]_[Location]_[Date].[extension]
 *
 * Examples:
 *   SRVY2025-001_Cadastral_Nairobi_2025-09-15.pdf
 *   SRVY2025-001_Cadastral_Nairobi_2025-09-15.shp
 *   SRVY2025-001_Cadastral_Nairobi_2025-09-15.xml
 *
 * References:
 *   - SRVY2025-1, §2.3: Survey Submission Numbering and File Naming Convention
 */

// ─── Types ─────────────────────────────────────────────────────────

/** Supported survey types for file naming. */
export type SurveyType =
  | "Cadastral"
  | "Topographic"
  | "Engineering"
  | "Control"
  | "Hydrographic"
  | "Sectional"
  | "SettingOut"
  | "Corridor"
  | "Drone"
  | "LiDAR"
  | "Utility"
  | "Boundary"
  | "Subdivision"
  | "Resurvey";

/** Supported file extensions. */
export type FileType =
  | "pdf"    // Survey report and plan
  | "shp"    // Shapefile
  | "shx"    // Shapefile index
  | "dbf"    // dBASE attribute data
  | "prj"    // Projection file
  | "cpg"    // Code page file
  | "gpkg"   // GeoPackage
  | "geojson"// GeoJSON
  | "dxf"    // DXF CAD drawing
  | "fbk"    // Field book file
  | "xml"    // LandXML
  | "rinex"  // RINEX observation data
  | "csv"    // CSV data
  | "xlsx"   // Excel spreadsheet
  | "tif"    // GeoTIFF raster
  | "jpg"    // JPEG image
  | "png"    // PNG image
  | "docx"   // Word document
  | "txt"    // Text file;

export interface SubmissionNamingInput {
  /** Submission number (e.g., "SRVY2025-001") */
  submissionNumber: string;
  /** Survey type */
  surveyType: SurveyType;
  /** Location name (e.g., "Nairobi", "Kasarani", "Mombasa") */
  location: string;
  /** Date (ISO 8601 format, e.g., "2025-09-15") */
  date: string;
  /** File type/extension */
  fileType: FileType;
  /** Optional suffix (e.g., "Report", "Plan", "Data") */
  suffix?: string;
}

export interface SubmissionNamingResult {
  /** Full filename with extension */
  filename: string;
  /** Filename without extension */
  baseName: string;
  /** Extension only */
  extension: string;
  /** Components breakdown */
  components: {
    submissionNumber: string;
    surveyType: string;
    location: string;
    date: string;
    suffix?: string;
  };
}

// ─── Validation ────────────────────────────────────────────────────

/** Validate submission number format (SRVY[YYYY]-[NNN]). */
export function validateSubmissionNumber(number: string): boolean {
  return /^SRVY\d{4}-\d{3,}$/.test(number);
}

/** Validate date format (YYYY-MM-DD). */
export function validateDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/** Sanitize a string for use in filenames (remove special chars, replace spaces with underscores). */
function sanitizeForFilename(str: string): string {
  return str
    .replace(/[<>:"/\\|?*,]/g, "")  // Remove illegal filename chars and commas
    .replace(/\s+/g, "_")          // Replace spaces with underscores
    .replace(/_+/g, "_")           // Collapse multiple underscores
    .replace(/^_|_$/g, "");        // Trim leading/trailing underscores
}

// ─── Naming Functions ──────────────────────────────────────────────

/**
 * Generate a submission filename per SRVY2025-1 §2.3.
 *
 * Format: [SubmissionNumber]_[SurveyType]_[Location]_[Date]_[Suffix].[ext]
 *
 * @example
 * ```ts
 * const result = generateSubmissionFilename({
 *   submissionNumber: "SRVY2025-001",
 *   surveyType: "Cadastral",
 *   location: "Kasarani, Nairobi",
 *   date: "2025-09-15",
 *   fileType: "pdf",
 *   suffix: "Report",
 * });
 * // result.filename = "SRVY2025-001_Cadastral_Kasarani_Nairobi_2025-09-15_Report.pdf"
 * ```
 */
export function generateSubmissionFilename(
  input: SubmissionNamingInput,
): SubmissionNamingResult {
  if (!validateSubmissionNumber(input.submissionNumber)) {
    throw new Error(
      `Invalid submission number: ${input.submissionNumber}. Expected format: SRVY[YYYY]-[NNN]`,
    );
  }

  if (!validateDateFormat(input.date)) {
    throw new Error(
      `Invalid date format: ${input.date}. Expected: YYYY-MM-DD`,
    );
  }

  const parts = [
    input.submissionNumber,
    sanitizeForFilename(input.surveyType),
    sanitizeForFilename(input.location),
    input.date,
  ];

  if (input.suffix) {
    parts.push(sanitizeForFilename(input.suffix));
  }

  const baseName = parts.join("_");
  const extension = input.fileType;
  const filename = `${baseName}.${extension}`;

  return {
    filename,
    baseName,
    extension,
    components: {
      submissionNumber: input.submissionNumber,
      surveyType: input.surveyType,
      location: input.location,
      date: input.date,
      suffix: input.suffix,
    },
  };
}

/**
 * Generate all filenames for a complete survey submission.
 *
 * Creates filenames for all required file types:
 *   - Report (PDF)
 *   - Survey Plan (PDF)
 *   - Spatial data (SHP + SHX + DBF + PRJ)
 *   - Raw field data (FBK or CSV)
 *   - Metadata (XML)
 */
export function generateSubmissionFileSet(params: {
  submissionNumber: string;
  surveyType: SurveyType;
  location: string;
  date: string;
  includeShapefile: boolean;
  includeFieldBook: boolean;
  includeMetadata: boolean;
}): SubmissionNamingResult[] {
  const results: SubmissionNamingResult[] = [];

  // Always include report and plan
  results.push(
    generateSubmissionFilename({
      ...params,
      fileType: "pdf",
      suffix: "Report",
    }),
  );

  results.push(
    generateSubmissionFilename({
      ...params,
      fileType: "pdf",
      suffix: "Plan",
    }),
  );

  // Shapefile components
  if (params.includeShapefile) {
    for (const ext of ["shp", "shx", "dbf", "prj"] as FileType[]) {
      results.push(
        generateSubmissionFilename({
          ...params,
          fileType: ext,
        }),
      );
    }
  }

  // Field book
  if (params.includeFieldBook) {
    results.push(
      generateSubmissionFilename({
        ...params,
        fileType: "fbk",
      }),
    );
  }

  // Metadata
  if (params.includeMetadata) {
    results.push(
      generateSubmissionFilename({
        ...params,
        fileType: "xml",
      }),
    );
  }

  return results;
}

/**
 * Generate a unique submission number for a given year.
 *
 * Format: SRVY[YYYY]-[NNN] where NNN is the next sequential number.
 */
export function generateSubmissionNumber(
  year: number,
  existingNumbers: string[],
): string {
  const prefix = `SRVY${year}-`;
  const maxExisting = existingNumbers
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ""), 10))
    .reduce((max, n) => Math.max(max, n), 0);

  return `${prefix}${String(maxExisting + 1).padStart(3, "0")}`;
}
