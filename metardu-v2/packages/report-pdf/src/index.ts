/**
 * PDF renderer for MetaRDU flight plan summary reports.
 *
 * Consumes a FlightPlanReport JSON structure (from @metardu/engine-flight-planning)
 * and produces a print-ready PDF using pdf-lib.
 *
 * The PDF layout:
 *   Page 1: Cover (mission name, project ref, date, key stats)
 *   Page 2: Mission summary (camera, flight plan, survey area)
 *   Page 3: Compliance + battery + terrain stats
 *   Page 4: Footprint diagram + flight pattern (embedded as SVG)
 *
 * The renderer is framework-agnostic — it runs in Node.js (Electron main process)
 * or in the browser (with pdf-lib loaded). No DOM dependencies.
 */

import {
  PDFDocument,
  PDFPage,
  StandardFonts,
  rgb,
  type PDFFont,
} from "pdf-lib";

/**
 * The FlightPlanReport shape (mirror of @metardu/engine's FlightPlanReport).
 * We define it locally to avoid a hard dependency on the engine package.
 */
export interface FlightPlanReportInput {
  metadata: {
    generatedAt: string;
    engineVersion: string;
    missionName: string;
    surveyorName?: string;
    projectRef?: string;
  };
  camera: {
    id: string;
    name: string;
    manufacturer: string;
    sensorWidthMm: number;
    sensorHeightMm: number;
    imageWidthPx: number;
    imageHeightPx: number;
    focalLengthMm: number;
    pixelSizeMicrometers: number;
  };
  flightPlan: {
    altitudeMeters: number;
    frontOverlap: number;
    sideOverlap: number;
    gsdCmPx: number;
    footprintWidthM: number;
    footprintHeightM: number;
    photoSpacingM: number;
    lineSpacingM: number;
  };
  surveyArea: {
    boundingBox: {
      minLat: number; maxLat: number;
      minLng: number; maxLng: number;
      centerLat: number; centerLng: number;
      widthMeters: number; heightMeters: number;
    };
    areaHectares: number;
    vertexCount: number;
  };
  missionStats: {
    totalWaypoints: number;
    totalPhotos: number;
    flightLineCount: number;
    photosPerLine: number;
    totalDistanceMeters: number;
    estimatedFlightTimeMin: number;
  };
  battery: {
    flightDistanceMeters: number;
    flightTimeMin: number;
    turnTimeMin: number;
    photoTimeMin: number;
    ascentTimeMin: number;
    turnCount: number;
    photoCount: number;
    usableFlightTimePerBatteryMin: number;
    batteryCount: number;
    totalMissionTimeMin: number;
    rthTimeMin: number;
    batterySwapTimeMin: number;
    batterySwapWaypoints: number[];
  };
  terrain?: {
    minElevationM: number;
    maxElevationM: number;
    meanElevationM: number;
    elevationRangeM: number;
    elevationStdDevM: number;
    minAltitudeAMSLM: number;
    maxAltitudeAMSLM: number;
  };
  asprsCompliance: Array<{
    asprsClass: {
      name: string;
      horizontalRmseCm: number;
      verticalRmseCm: number;
      maxGsdCmPx: number;
      scaleEquivalent: string;
    };
    supported: boolean;
    marginCmPx: number;
  }>;
  kenyaCompliance: {
    urbanLinearMisclosure: string;
    ruralLinearMisclosure: string;
  };
  footprintDiagramSvg: string;
  flightPatternSvg: string;
}

/**
 * Options for PDF rendering.
 */
export interface RenderOptions {
  /** Optional: override the page size (default A4 portrait) */
  pageSize?: "a4" | "letter";
  /** Optional: include the SVG diagrams (default true) */
  includeDiagrams?: boolean;
  /** Optional: paper orientation (default portrait) */
  orientation?: "portrait" | "landscape";
}

// ─── Color palette (matches the engine report palette) ─────────────

const COLORS = {
  primary: rgb(0.16, 0.14, 0.11),      // #28231C — text primary
  accent: rgb(0.55, 0.45, 0.15),       // #8C7226 — brass gold
  muted: rgb(0.50, 0.49, 0.47),        // #807D76 — text muted
  border: rgb(0.82, 0.80, 0.74),       // #D2CCBA — border
  headerFill: rgb(0.36, 0.32, 0.21),   // #5C5235 — header fill
  cardBg: rgb(0.93, 0.92, 0.91),       // #EDEBE8 — card bg
  success: rgb(0.30, 0.47, 0.31),      // #4D784F — success green
  error: rgb(0.56, 0.27, 0.25),        // #904740 — error red
  white: rgb(1, 1, 1),
};

// ─── Page dimensions ───────────────────────────────────────────────

const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

const MARGIN = 50;

// ─── Main entry point ──────────────────────────────────────────────

/**
 * Render a flight plan report to a PDF.
 *
 * @param report The FlightPlanReport JSON structure
 * @param options Render options
 * @returns Uint8Array containing the PDF bytes
 */
export async function renderReportToPdf(
  report: FlightPlanReportInput,
  options: RenderOptions = {}
): Promise<Uint8Array> {
  const {
    pageSize = "a4",
    orientation = "portrait",
    includeDiagrams = true,
  } = options;

  const doc = await PDFDocument.create();
  doc.setTitle(`MetaRDU Mission Report — ${report.metadata.missionName}`);
  doc.setAuthor(report.metadata.surveyorName ?? "MetaRDU Desktop");
  doc.setCreator("MetaRDU Desktop v2.0");
  doc.setSubject("Flight plan summary report");
  doc.setProducer("pdf-lib + MetaRDU engine");

  // Embed fonts
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const pageSize_ = PAGE_SIZES[pageSize];
  const pageW = orientation === "portrait" ? pageSize_.width : pageSize_.height;
  const pageH = orientation === "portrait" ? pageSize_.height : pageSize_.width;

  const ctx: RenderContext = {
    doc,
    pageW,
    pageH,
    helvetica,
    helveticaBold,
    helveticaOblique,
    currentPage: undefined,
    y: 0,
  };

  // ─── Page 1: Cover ───
  renderCoverPage(ctx, report);

  // ─── Page 2: Mission summary ───
  renderSummaryPage(ctx, report);

  // ─── Page 3: Compliance + battery ───
  renderCompliancePage(ctx, report);

  // ─── Page 4: Diagrams (optional) ───
  if (includeDiagrams) {
    renderDiagramsPage(ctx, report);
  }

  // Add page numbers to all pages except cover
  const pages = doc.getPages();
  for (let i = 1; i < pages.length; i++) {
    drawPageNumber(pages[i]!, i + 1, pages.length, helvetica, pageW);
  }

  return await doc.save();
}

// ─── Render context ────────────────────────────────────────────────

interface RenderContext {
  doc: PDFDocument;
  pageW: number;
  pageH: number;
  helvetica: PDFFont;
  helveticaBold: PDFFont;
  helveticaOblique: PDFFont;
  currentPage: PDFPage | undefined;
  y: number;
}

function newPage(ctx: RenderContext): PDFPage {
  const page = ctx.doc.addPage([ctx.pageW, ctx.pageH]);
  ctx.currentPage = page;
  ctx.y = ctx.pageH - MARGIN;
  return page;
}

function ensureSpace(ctx: RenderContext, needed: number): void {
  if (ctx.y - needed < MARGIN) {
    newPage(ctx);
  }
}

// ─── Text helpers ──────────────────────────────────────────────────

function drawText(
  ctx: RenderContext,
  text: string,
  options: {
    x?: number;
    y?: number;
    size?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
    maxWidth?: number;
  } = {}
): number {
  const page = ctx.currentPage!;
  const x = options.x ?? MARGIN;
  const y = options.y ?? ctx.y;
  const size = options.size ?? 10;
  const font = options.font ?? ctx.helvetica;
  const color = options.color ?? COLORS.primary;
  const maxWidth = options.maxWidth ?? ctx.pageW - 2 * MARGIN;

  // Word-wrap if text exceeds maxWidth
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const testLine = currentLine ? currentLine + " " + word : word;
    const width = font.widthOfTextAtSize(testLine, size);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  for (const line of lines) {
    page.drawText(line, { x, y, size, font, color });
    ctx.y = y - size - 4;
  }

  return ctx.y;
}

function drawHeading(ctx: RenderContext, text: string, level: 1 | 2 | 3 = 1): void {
  const sizes = { 1: 18, 2: 14, 3: 11 };
  const colors = { 1: COLORS.headerFill, 2: COLORS.primary, 3: COLORS.accent };
  const spaceBefore = { 1: 24, 2: 16, 3: 10 };
  const spaceAfter = { 1: 12, 2: 8, 3: 4 };

  ensureSpace(ctx, sizes[level] + spaceBefore[level]! + spaceAfter[level]!);
  ctx.y -= spaceBefore[level]!;
  drawText(ctx, text, {
    size: sizes[level],
    font: ctx.helveticaBold,
    color: colors[level],
  });
  ctx.y -= spaceAfter[level]!;

  if (level === 1) {
    // Draw accent line under H1
    const page = ctx.currentPage!;
    page.drawLine({
      start: { x: MARGIN, y: ctx.y + 4 },
      end: { x: ctx.pageW - MARGIN, y: ctx.y + 4 },
      thickness: 1.5,
      color: COLORS.accent,
    });
    ctx.y -= 8;
  }
}

function drawKeyValue(
  ctx: RenderContext,
  key: string,
  value: string,
  options: { indent?: number; keyWidth?: number } = {}
): void {
  const indent = options.indent ?? 0;
  const keyWidth = options.keyWidth ?? 180;
  ensureSpace(ctx, 14);

  const x = MARGIN + indent;
  drawText(ctx, key, {
    x,
    size: 10,
    font: ctx.helvetica,
    color: COLORS.muted,
    maxWidth: keyWidth,
  });
  drawText(ctx, value, {
    x: x + keyWidth,
    size: 10,
    font: ctx.helvetica,
    color: COLORS.primary,
    maxWidth: ctx.pageW - MARGIN - (x + keyWidth),
  });
  ctx.y -= 4;
}

function drawCard(
  ctx: RenderContext,
  title: string,
  content: () => void
): void {
  const cardLeft = MARGIN;
  const cardWidth = ctx.pageW - 2 * MARGIN;

  // Ensure space for the title bar + some content
  ensureSpace(ctx, 80);
  ctx.y -= 8;

  // Draw the title bar (we'll fill in the background after measuring content height)
  const titleBarY = ctx.y - 14;
  const titleBarH = 18;

  // Move down past the title bar
  ctx.y = titleBarY - 8;

  // Draw the content and measure how much vertical space it used
  const contentStartY = ctx.y;
  content();
  const contentEndY = ctx.y - 4;

  // Now draw the background rectangles (they appear behind the text because
  // pdf-lib draws shapes in order, and we drew text first — but actually
  // pdf-lib draws everything in the order added to the page, so the shapes
  // will appear ON TOP of the text. We need to draw shapes FIRST.
  //
  // Fix: we re-draw the text after drawing the shapes. But that's complex.
  // Simpler fix: draw the card background and title bar BEFORE the content.
  // We already drew the content text, so we need to redraw it.
  //
  // Simplest fix: don't draw a background at all — just draw a title bar
  // and a border around the content area.

  const page = ctx.currentPage!;

  // Draw title bar
  page.drawRectangle({
    x: cardLeft,
    y: titleBarY,
    width: cardWidth,
    height: titleBarH,
    color: COLORS.headerFill,
  });
  // Draw title text on top of the bar
  page.drawText(title, {
    x: cardLeft + 12,
    y: titleBarY + 4,
    size: 11,
    font: ctx.helveticaBold,
    color: COLORS.white,
  });

  // Draw border around content area
  const contentH = contentStartY - contentEndY;
  page.drawRectangle({
    x: cardLeft,
    y: contentEndY,
    width: cardWidth,
    height: contentH + 8,
    borderColor: COLORS.border,
    borderWidth: 0.5,
    color: COLORS.cardBg,
    opacity: 0.3,
  });

  // Re-draw the content text on top of the background
  ctx.y = contentStartY;
  content();

  ctx.y = contentEndY - 16;
}

// ─── Page 1: Cover ─────────────────────────────────────────────────

function renderCoverPage(ctx: RenderContext, report: FlightPlanReportInput): void {
  newPage(ctx);
  const page = ctx.currentPage!;

  // Top accent bar
  page.drawRectangle({
    x: 0, y: ctx.pageH - 8,
    width: ctx.pageW, height: 8,
    color: COLORS.accent,
  });

  // Kicker
  ctx.y = ctx.pageH - 80;
  drawText(ctx, "META RDU MISSION REPORT", {
    x: MARGIN, size: 10, font: ctx.helveticaBold, color: COLORS.accent,
  });

  // Mission name (large)
  ctx.y -= 40;
  drawText(ctx, report.metadata.missionName, {
    x: MARGIN, size: 32, font: ctx.helveticaBold, color: COLORS.primary,
    maxWidth: ctx.pageW - 2 * MARGIN,
  });

  // Project ref + surveyor
  ctx.y -= 50;
  if (report.metadata.projectRef) {
    drawText(ctx, `Project: ${report.metadata.projectRef}`, {
      x: MARGIN, size: 12, font: ctx.helvetica, color: COLORS.muted,
    });
    ctx.y -= 18;
  }
  if (report.metadata.surveyorName) {
    drawText(ctx, `Surveyor: ${report.metadata.surveyorName}`, {
      x: MARGIN, size: 12, font: ctx.helvetica, color: COLORS.muted,
    });
    ctx.y -= 18;
  }

  // Date
  const date = new Date(report.metadata.generatedAt);
  const dateStr = date.toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });
  drawText(ctx, `Generated: ${dateStr}`, {
    x: MARGIN, size: 12, font: ctx.helvetica, color: COLORS.muted,
  });

  // Key stats grid (4 boxes)
  ctx.y -= 80;
  const stats = [
    { label: "GSD", value: `${report.flightPlan.gsdCmPx.toFixed(2)} cm/px` },
    { label: "Altitude", value: `${report.flightPlan.altitudeMeters} m AGL` },
    { label: "Waypoints", value: `${report.missionStats.totalWaypoints}` },
    { label: "Batteries", value: `${report.battery.batteryCount}` },
  ];
  const boxW = (ctx.pageW - 2 * MARGIN - 30) / 4;
  const boxH = 60;
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i]!;
    const x = MARGIN + i * (boxW + 10);
    const y = ctx.y - boxH;
    page.drawRectangle({
      x, y, width: boxW, height: boxH,
      borderColor: COLORS.accent, borderWidth: 1.5,
      color: COLORS.cardBg,
    });
    page.drawText(s.value, {
      x: x + 10, y: y + 25, size: 14, font: ctx.helveticaBold, color: COLORS.primary,
    });
    page.drawText(s.label.toUpperCase(), {
      x: x + 10, y: y + 10, size: 8, font: ctx.helvetica, color: COLORS.muted,
    });
  }
  ctx.y -= boxH + 30;

  // Footer
  ctx.y = 80;
  page.drawLine({
    start: { x: MARGIN, y: 60 },
    end: { x: ctx.pageW - MARGIN, y: 60 },
    thickness: 0.5, color: COLORS.border,
  });
  drawText(ctx, "MetaRDU Desktop v2.0 — Production-Ready Drone Survey Workstation", {
    x: MARGIN, size: 9, font: ctx.helveticaOblique, color: COLORS.muted,
  });
  drawText(ctx, `Engine v${report.metadata.engineVersion}`, {
    x: ctx.pageW - MARGIN - 100, size: 9, font: ctx.helveticaOblique, color: COLORS.muted,
  });
}

// ─── Page 2: Mission Summary ───────────────────────────────────────

function renderSummaryPage(ctx: RenderContext, report: FlightPlanReportInput): void {
  newPage(ctx);

  drawHeading(ctx, "1. Mission Summary", 1);

  drawCard(ctx, "Camera", () => {
    drawKeyValue(ctx, "Name", report.camera.name);
    drawKeyValue(ctx, "Manufacturer", report.camera.manufacturer);
    drawKeyValue(ctx, "Sensor", `${report.camera.sensorWidthMm} × ${report.camera.sensorHeightMm} mm`);
    drawKeyValue(ctx, "Image", `${report.camera.imageWidthPx} × ${report.camera.imageHeightPx} px`);
    drawKeyValue(ctx, "Focal length", `${report.camera.focalLengthMm} mm`);
    drawKeyValue(ctx, "Pixel size", `${report.camera.pixelSizeMicrometers.toFixed(3)} µm`);
  });

  drawCard(ctx, "Flight Plan Parameters", () => {
    drawKeyValue(ctx, "Altitude (AGL)", `${report.flightPlan.altitudeMeters} m`);
    drawKeyValue(ctx, "Front overlap", `${(report.flightPlan.frontOverlap * 100).toFixed(0)}%`);
    drawKeyValue(ctx, "Side overlap", `${(report.flightPlan.sideOverlap * 100).toFixed(0)}%`);
    drawKeyValue(ctx, "GSD", `${report.flightPlan.gsdCmPx.toFixed(2)} cm/px`);
    drawKeyValue(ctx, "Footprint", `${report.flightPlan.footprintWidthM.toFixed(1)} × ${report.flightPlan.footprintHeightM.toFixed(1)} m`);
    drawKeyValue(ctx, "Photo spacing", `${report.flightPlan.photoSpacingM.toFixed(2)} m`);
    drawKeyValue(ctx, "Line spacing", `${report.flightPlan.lineSpacingM.toFixed(2)} m`);
  });

  drawCard(ctx, "Survey Area", () => {
    const bb = report.surveyArea.boundingBox;
    drawKeyValue(ctx, "Area", `${report.surveyArea.areaHectares.toFixed(2)} hectares`);
    drawKeyValue(ctx, "Width", `${bb.widthMeters.toFixed(1)} m`);
    drawKeyValue(ctx, "Height", `${bb.heightMeters.toFixed(1)} m`);
    drawKeyValue(ctx, "Center", `${bb.centerLat.toFixed(6)}, ${bb.centerLng.toFixed(6)}`);
    drawKeyValue(ctx, "North limit", bb.maxLat.toFixed(6));
    drawKeyValue(ctx, "South limit", bb.minLat.toFixed(6));
    drawKeyValue(ctx, "East limit", bb.maxLng.toFixed(6));
    drawKeyValue(ctx, "West limit", bb.minLng.toFixed(6));
    drawKeyValue(ctx, "Waypoints", `${report.surveyArea.vertexCount}`);
  });

  drawCard(ctx, "Mission Statistics", () => {
    drawKeyValue(ctx, "Total waypoints", `${report.missionStats.totalWaypoints}`);
    drawKeyValue(ctx, "Flight lines", `${report.missionStats.flightLineCount}`);
    drawKeyValue(ctx, "Photos per line", `${report.missionStats.photosPerLine}`);
    drawKeyValue(ctx, "Total photos", `${report.missionStats.totalPhotos}`);
    drawKeyValue(ctx, "Total distance", `${(report.missionStats.totalDistanceMeters / 1000).toFixed(2)} km`);
    drawKeyValue(ctx, "Est. flight time", `${report.missionStats.estimatedFlightTimeMin.toFixed(1)} min`);
  });
}

// ─── Page 3: Compliance + Battery + Terrain ────────────────────────

function renderCompliancePage(ctx: RenderContext, report: FlightPlanReportInput): void {
  newPage(ctx);

  drawHeading(ctx, "2. Compliance & Battery", 1);

  // ASPRS compliance table
  drawCard(ctx, "ASPRS 2014 Positional Accuracy Standards", () => {
    // Table header
    const tableY = ctx.y;
    const cols = [
      { label: "Class", x: MARGIN + 12, width: 70 },
      { label: "Horizontal RMSE", x: MARGIN + 82, width: 110 },
      { label: "Vertical RMSE", x: MARGIN + 192, width: 100 },
      { label: "Scale", x: MARGIN + 292, width: 70 },
      { label: "Status", x: MARGIN + 362, width: 80 },
    ];
    for (const col of cols) {
      ctx.currentPage!.drawText(col.label, {
        x: col.x, y: tableY, size: 9, font: ctx.helveticaBold, color: COLORS.white,
      });
    }
    ctx.y -= 16;

    // Table rows
    for (const row of report.asprsCompliance) {
      const cls = row.asprsClass;
      const statusText = row.supported ? "SUPPORTED" : "NOT MET";
      const statusColor = row.supported ? COLORS.success : COLORS.error;

      ctx.currentPage!.drawText(cls.name, {
        x: cols[0]!.x, y: ctx.y, size: 9, font: ctx.helvetica, color: COLORS.primary,
      });
      ctx.currentPage!.drawText(`${cls.horizontalRmseCm} cm`, {
        x: cols[1]!.x, y: ctx.y, size: 9, font: ctx.helvetica, color: COLORS.primary,
      });
      ctx.currentPage!.drawText(`${cls.verticalRmseCm} cm`, {
        x: cols[2]!.x, y: ctx.y, size: 9, font: ctx.helvetica, color: COLORS.primary,
      });
      ctx.currentPage!.drawText(cls.scaleEquivalent, {
        x: cols[3]!.x, y: ctx.y, size: 9, font: ctx.helvetica, color: COLORS.primary,
      });
      ctx.currentPage!.drawText(statusText, {
        x: cols[4]!.x, y: ctx.y, size: 9, font: ctx.helveticaBold, color: statusColor,
      });
      ctx.y -= 14;
    }
    ctx.y -= 8;
    drawText(ctx, `GSD ${report.flightPlan.gsdCmPx.toFixed(2)} cm/px supports ${report.asprsCompliance.filter(r => r.supported).length} of 3 ASPRS classes.`, {
      size: 9, font: ctx.helveticaOblique, color: COLORS.muted,
    });
  });

  // Kenya compliance
  drawCard(ctx, "Kenya RDM 1.1 / Survey Act Cap. 299", () => {
    drawKeyValue(ctx, "Urban linear misclosure", report.kenyaCompliance.urbanLinearMisclosure);
    drawKeyValue(ctx, "Rural linear misclosure", report.kenyaCompliance.ruralLinearMisclosure);
    drawKeyValue(ctx, "Levelling tolerance", "10 x sqrt(K) mm (K = line length in km)");
    drawKeyValue(ctx, "Angular misclosure", "15 arcsec x sqrt(N) (N = number of stations)");
  });

  // Battery estimation
  drawCard(ctx, "Battery & Flight Time Estimation", () => {
    drawKeyValue(ctx, "Flight distance", `${(report.battery.flightDistanceMeters / 1000).toFixed(2)} km`);
    drawKeyValue(ctx, "Active flight time", `${report.battery.flightTimeMin.toFixed(1)} min`);
    drawKeyValue(ctx, "Turn time", `${report.battery.turnTimeMin.toFixed(1)} min (${report.battery.turnCount} turns)`);
    drawKeyValue(ctx, "Photo time", `${report.battery.photoTimeMin.toFixed(1)} min (${report.battery.photoCount} photos)`);
    drawKeyValue(ctx, "Ascent time", `${report.battery.ascentTimeMin.toFixed(2)} min`);
    drawKeyValue(ctx, "Usable per battery", `${report.battery.usableFlightTimePerBatteryMin.toFixed(1)} min (75% derating + 20% safety)`);
    drawKeyValue(ctx, "Batteries required", `${report.battery.batteryCount}`);
    drawKeyValue(ctx, "RTH time", `${report.battery.rthTimeMin} min`);
    if (report.battery.batterySwapTimeMin > 0) {
      drawKeyValue(ctx, "Battery swap time", `${report.battery.batterySwapTimeMin.toFixed(1)} min (${report.battery.batteryCount - 1} swaps)`);
      drawKeyValue(ctx, "Swap at waypoints", report.battery.batterySwapWaypoints.join(", "));
    }
    drawKeyValue(ctx, "Total mission time", `${report.battery.totalMissionTimeMin.toFixed(1)} min`, );
  });

  // Terrain (if present)
  if (report.terrain) {
    drawCard(ctx, "Terrain Statistics", () => {
      drawKeyValue(ctx, "Min elevation", `${report.terrain!.minElevationM.toFixed(1)} m AMSL`);
      drawKeyValue(ctx, "Max elevation", `${report.terrain!.maxElevationM.toFixed(1)} m AMSL`);
      drawKeyValue(ctx, "Mean elevation", `${report.terrain!.meanElevationM.toFixed(1)} m AMSL`);
      drawKeyValue(ctx, "Elevation range", `${report.terrain!.elevationRangeM.toFixed(1)} m`);
      drawKeyValue(ctx, "Std deviation", `${report.terrain!.elevationStdDevM.toFixed(1)} m`);
      drawKeyValue(ctx, "Min drone altitude", `${report.terrain!.minAltitudeAMSLM.toFixed(1)} m AMSL`);
      drawKeyValue(ctx, "Max drone altitude", `${report.terrain!.maxAltitudeAMSLM.toFixed(1)} m AMSL`);
    });
  }
}

// ─── Page 4: Diagrams ──────────────────────────────────────────────

function renderDiagramsPage(ctx: RenderContext, report: FlightPlanReportInput): void {
  newPage(ctx);

  drawHeading(ctx, "3. Diagrams", 1);

  // Note: pdf-lib doesn't natively embed SVG. We render a simplified
  // vector representation using pdf-lib's drawing primitives.
  // For full SVG embedding, the desktop app can use @svgpdf/svg2pdfjs
  // or render the SVG to PNG via sharp/canvas and embed as JPEG.

  drawCard(ctx, "Camera Footprint & Overlap", () => {
    drawFootprintDiagram(ctx, report);
  });

  drawCard(ctx, "Flight Pattern (Top-Down View)", () => {
    drawFlightPatternDiagram(ctx, report);
  });

  // Note about full SVG
  ctx.y -= 10;
  drawText(ctx, "Note: Vector diagrams shown above are simplified. The full SVG diagrams are included in the report JSON for embedding in web UIs or for high-resolution rendering via sharp/canvas.", {
    size: 8, font: ctx.helveticaOblique, color: COLORS.muted, maxWidth: ctx.pageW - 2 * MARGIN,
  });
}

/**
 * Draw a simplified camera footprint diagram using pdf-lib primitives.
 */
function drawFootprintDiagram(ctx: RenderContext, report: FlightPlanReportInput): void {
  const page = ctx.currentPage!;
  const fp = report.flightPlan;

  // Scale: fit the diagram in the card width
  const diagramW = ctx.pageW - 2 * MARGIN - 24;
  const diagramH = 140;
  const scale = Math.min(diagramW / (fp.footprintWidthM * 2.2), diagramH / (fp.footprintHeightM * 2.2));

  const fw = fp.footprintWidthM * scale;
  const fh = fp.footprintHeightM * scale;
  const ps = fp.photoSpacingM * scale;
  const ls = fp.lineSpacingM * scale;

  const originX = MARGIN + 24;
  const originY = ctx.y - fh - 10;

  // Footprint 1
  page.drawRectangle({
    x: originX, y: originY, width: fw, height: fh,
    borderColor: rgb(0.15, 0.39, 0.92), borderWidth: 1, color: rgb(0.86, 0.92, 0.99),
  });
  page.drawText("Photo 1", {
    x: originX + fw / 2 - 20, y: originY + fh / 2, size: 8, font: ctx.helvetica, color: COLORS.primary,
  });

  // Footprint 2 (shifted by photoSpacing)
  page.drawRectangle({
    x: originX + fw, y: originY, width: fw, height: fh,
    borderColor: rgb(0.15, 0.39, 0.92), borderWidth: 1, color: rgb(0.86, 0.92, 0.99), opacity: 0.7,
  });
  page.drawText("Photo 2", {
    x: originX + fw + fw / 2 - 20, y: originY + fh / 2, size: 8, font: ctx.helvetica, color: COLORS.primary,
  });

  // Front overlap region
  page.drawRectangle({
    x: originX + fw, y: originY, width: ps, height: fh,
    color: rgb(0.98, 0.75, 0.14), opacity: 0.4,
  });

  // Photo spacing arrow
  page.drawLine({
    start: { x: originX + fw, y: originY - 10 },
    end: { x: originX + fw + ps, y: originY - 10 },
    thickness: 1, color: rgb(0.86, 0.15, 0.15),
  });
  page.drawText(`Photo spacing: ${fp.photoSpacingM.toFixed(1)} m`, {
    x: originX + fw - 20, y: originY - 22, size: 8, font: ctx.helvetica, color: rgb(0.86, 0.15, 0.15),
  });

  // Footprint 3 (line 2)
  page.drawRectangle({
    x: originX, y: originY - fh - ls, width: fw, height: fh,
    borderColor: rgb(0.10, 0.64, 0.39), borderWidth: 1, color: rgb(0.86, 0.99, 0.91),
  });

  // Side overlap region
  page.drawRectangle({
    x: originX, y: originY - fh, width: fw, height: ls,
    color: rgb(0.65, 0.55, 0.98), opacity: 0.4,
  });

  // Line spacing arrow
  page.drawLine({
    start: { x: originX + fw + 20, y: originY - fh },
    end: { x: originX + fw + 20, y: originY - fh - ls },
    thickness: 1, color: rgb(0.86, 0.15, 0.15),
  });
  page.drawText(`Line spacing: ${fp.lineSpacingM.toFixed(1)} m`, {
    x: originX + fw + 30, y: originY - fh - ls / 2, size: 8, font: ctx.helvetica, color: rgb(0.86, 0.15, 0.15),
  });

  // Labels
  page.drawText(`Footprint: ${fp.footprintWidthM.toFixed(1)} × ${fp.footprintHeightM.toFixed(1)} m`, {
    x: originX, y: originY - fh - ls - 25, size: 9, font: ctx.helveticaBold, color: COLORS.primary,
  });
  page.drawText(`Front overlap: ${(fp.frontOverlap * 100).toFixed(0)}%   Side overlap: ${(fp.sideOverlap * 100).toFixed(0)}%`, {
    x: originX, y: originY - fh - ls - 38, size: 9, font: ctx.helvetica, color: COLORS.muted,
  });

  ctx.y = originY - fh - ls - 50;
}

/**
 * Draw a simplified flight pattern diagram using pdf-lib primitives.
 */
function drawFlightPatternDiagram(ctx: RenderContext, report: FlightPlanReportInput): void {
  const page = ctx.currentPage!;
  const bb = report.surveyArea.boundingBox;

  // Diagram area
  const diagramW = ctx.pageW - 2 * MARGIN - 24;
  const diagramH = 180;
  const scale = Math.min(diagramW / bb.widthMeters, diagramH / bb.heightMeters) * 0.9;

  const cx = MARGIN + 24 + diagramW / 2;
  const cy = ctx.y - diagramH / 2 - 10;

  // Bounding box
  const boxW = bb.widthMeters * scale;
  const boxH = bb.heightMeters * scale;
  page.drawRectangle({
    x: cx - boxW / 2, y: cy - boxH / 2, width: boxW, height: boxH,
    borderColor: COLORS.muted, borderWidth: 1, color: rgb(0.95, 0.95, 0.94), opacity: 0.5,
  });

  // North arrow
  page.drawLine({
    start: { x: cx + boxW / 2 + 15, y: cy + 10 },
    end: { x: cx + boxW / 2 + 15, y: cy + 30 },
    thickness: 1.5, color: COLORS.primary,
  });
  page.drawText("N", {
    x: cx + boxW / 2 + 11, y: cy + 33, size: 10, font: ctx.helveticaBold, color: COLORS.primary,
  });

  // Scale bar (100 m)
  const scaleBarLen = 100 * scale;
  page.drawLine({
    start: { x: cx - boxW / 2, y: cy - boxH / 2 - 15 },
    end: { x: cx - boxW / 2 + scaleBarLen, y: cy - boxH / 2 - 15 },
    thickness: 1.5, color: COLORS.primary,
  });
  page.drawText("100 m", {
    x: cx - boxW / 2 + scaleBarLen + 5, y: cy - boxH / 2 - 18, size: 9, font: ctx.helvetica, color: COLORS.primary,
  });

  // Stats text
  page.drawText(`${report.missionStats.totalWaypoints} waypoints · ${report.missionStats.flightLineCount} flight lines`, {
    x: cx - boxW / 2, y: cy - boxH / 2 - 32, size: 9, font: ctx.helvetica, color: COLORS.muted,
  });

  ctx.y = cy - boxH / 2 - 45;
}

// ─── Page numbers ──────────────────────────────────────────────────

function drawPageNumber(
  page: PDFPage,
  pageNum: number,
  totalPages: number,
  font: PDFFont,
  pageW: number,
): void {
  page.drawText(`Page ${pageNum} of ${totalPages}`, {
    x: pageW - MARGIN - 80,
    y: 25,
    size: 8,
    font,
    color: COLORS.muted,
  });
  page.drawText("MetaRDU Desktop v2.0", {
    x: MARGIN,
    y: 25,
    size: 8,
    font,
    color: COLORS.muted,
  });
  page.drawLine({
    start: { x: MARGIN, y: 40 },
    end: { x: pageW - MARGIN, y: 40 },
    thickness: 0.3, color: COLORS.border,
  });
}
