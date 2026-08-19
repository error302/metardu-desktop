/**
 * map-export.ts — main-process 300 DPI map export (sharp rasterizer).
 *
 * Turns a survey workflow output into a print-ready PNG of the survey plan:
 *
 *   survey output (projected CRS)
 *     → extractMapGeometry (pure normalizer)
 *     → buildSurveyMapSvg (pure plan SVG, point-sized)
 *     → sharp(svg, { density: 300 }).png()  (native rasterization)
 *
 * Per the invariants: the renderer never sees Node/fs/sharp — this module
 * lives in the main process and is reached via the preload bridge
 * (`window.metardu.map.exportPng`).
 *
 * # 300 DPI math
 *
 * buildSurveyMapSvg emits the SVG in points (72/inch). sharp's `density`
 * option rasterizes SVG at the given DPI, so:
 *   output_px = width_pt × dpi / 72
 * A4 landscape (842×595 pt) → 3508×2480 px at 300 DPI — print resolution.
 */

import sharp from "sharp";
import { app, dialog, BrowserWindow } from "electron";
import { renderParcelBookletPdf, renderSinglePlanPdf, renderStatutoryReportPdf } from "@metardu/report-pdf";
import {
  detectAutoExportKind,
  extractMapGeometry,
  summarizeGeometry,
  splitGeometryIntoParcels,
  type MapParcel,
} from "../renderer/map-geometry.js";
import {
  buildSurveyMapSvg,
  PRINT_DPI,
  resolveSheetPt,
  type StatutoryTitleBlock,
  type SurveyMapSvgResult,
} from "../renderer/map-svg.js";

export interface MapExportInput {
  /** The survey workflow output (any survey type). */
  surveyOutput: unknown;
  /** Plan title (e.g. project name). */
  projectName: string;
  /** Coordinate system label, e.g. "Arc 1960 / UTM zone 37S". */
  coordinateSystemLabel?: string;
  /** Surveyor name for the plan footer. */
  surveyorName?: string;
  /** ISO date string. Defaults to today. */
  date?: string;
  /** Named ISO/ANSI sheet (a4..a0, letter, legal). Default A4. */
  sheetSize?: string;
  /** Paper orientation. Default landscape. */
  orientation?: "landscape" | "portrait";
  /** Fixed scale 1:denominator, or undefined for auto-fit. */
  scaleDenominator?: number;
  /** Statutory header centered in the title strip (from the country planSheet). */
  titleBlockLabel?: string;
  /** Plan-type label prefixed to the title (e.g. "DEED PLAN"). */
  planTypeLabel?: string;
  /** Statutory footer disclaimer (from the country planSheet). */
  footerNote?: string;
  /** Per-market statutory title block (field grid, certification, seal). */
  titleBlockLayout?: StatutoryTitleBlock;
}

export interface MapExportResult {
  /** PNG bytes at 300 DPI. */
  pngBytes: Uint8Array;
  /** Output pixel dimensions. */
  widthPx: number;
  heightPx: number;
  /** Approximate scale denominator (1:denominator). */
  scaleDenominator: number;
  /** True when the whole extent fits the sheet at the chosen scale. */
  fitsSheet: boolean;
  /** Human summary of what was plotted, e.g. "4 beacons · 1 boundary". */
  summary: string;
}

/** Result of an auto-export (no save dialog — written to the auto-exports dir). */
export interface AutoExportResult {
  kind: "png" | "booklet";
  /** Directory the files were written into (userData/auto-exports/…). */
  directory: string;
  files: Array<{ label: string; path: string; bytes: number }>;
  /** Booklet page count (cover/index + plans) when kind === "booklet". */
  pageCount?: number;
  /** Scale denominator of the first/only sheet. */
  scaleDenominator: number;
  /** Human summary of what was plotted. */
  summary: string;
  /**
   * Statutory report PDF (A4 cover + the exact plan sheet as the
   * survey-map page) written alongside the plan — present when the run
   * completed and the report rendered successfully.
   */
  reportFile?: { path: string; bytes: number };
}

/**
 * Render the survey plan SVG to a 300 DPI PNG. Pure rasterization — no
 * dialog, no fs. Exposed separately so callers can embed the bytes
 * (e.g. into the report PDF) without a Save-As prompt.
 */
export async function renderSurveyMapPng(
  input: MapExportInput,
): Promise<MapExportResult> {
  const geometry = extractMapGeometry(input.surveyOutput);
  const summary = summarizeGeometry(geometry);

  const built: SurveyMapSvgResult = buildSurveyMapSvg(geometry, {
    title: input.projectName || "Survey Plan",
    coordinateSystemLabel: input.coordinateSystemLabel,
    surveyorName: input.surveyorName,
    date: input.date ?? new Date().toISOString().split("T")[0],
    sheetSize: input.sheetSize,
    orientation: input.orientation,
    scaleMode:
      input.scaleDenominator && input.scaleDenominator > 0
        ? { mode: "fixed", denominator: input.scaleDenominator }
        : undefined,
    titleBlockLabel: input.titleBlockLabel,
    planTypeLabel: input.planTypeLabel,
    footerNote: input.footerNote,
    titleBlockLayout: input.titleBlockLayout,
  });

  // sharp rasterizes SVG with the density option = DPI. The SVG is sized in
  // points, so output_px = width_pt × density / 72 (verified: 300 DPI).
  const png = await sharp(Buffer.from(built.svg), { density: PRINT_DPI })
    .png()
    .toBuffer();

  return {
    pngBytes: new Uint8Array(png),
    widthPx: built.widthPx,
    heightPx: built.heightPx,
    scaleDenominator: built.scaleDenominator,
    fitsSheet: built.fitsSheet,
    summary,
  };
}

/**
 * Render a statutory survey report PDF: an A4 cover (project, surveyor,
 * date, CRS, scale) followed by the plan sheet itself — the exact 300 DPI
 * PNG rendered with the same sheet/orientation/scale choices as the
 * print-preview panel, embedded full-bleed on a page sized to the sheet.
 * The report's survey-map page therefore matches what the user previewed
 * pixel-for-pixel (see renderStatutoryReportPdf).
 */
export async function renderStatutoryReport(
  input: MapExportInput,
): Promise<MapExportResult & { pdfBytes: Uint8Array }> {
  const rendered = await renderSurveyMapPng(input);
  const sheet = resolveSheetPt(input.sheetSize, input.orientation);
  const pdfBytes = await renderStatutoryReportPdf({
    title: input.projectName || "Survey Plan",
    surveyorName: input.surveyorName,
    date: input.date ?? new Date().toISOString().split("T")[0],
    coordinateSystemLabel: input.coordinateSystemLabel,
    scaleDenominator: rendered.scaleDenominator,
    titleBlockLabel: input.titleBlockLabel,
    planTypeLabel: input.planTypeLabel,
    footerNote: input.footerNote,
    summary: rendered.summary,
    png: rendered.pngBytes,
    mapWidthPt: sheet?.widthPt ?? 842,
    mapHeightPt: sheet?.heightPt ?? 595,
    mapCaption: `Plan sheet ${(input.sheetSize ?? "a4").toUpperCase()} ${input.orientation ?? "landscape"} — 300 DPI, scale 1:${rendered.scaleDenominator}`,
  });
  return { ...rendered, pdfBytes };
}

/**
 * Render the statutory survey report PDF and show a Save-As dialog.
 */
export async function exportStatutoryReport(
  parentWindow: BrowserWindow | null,
  input: MapExportInput,
): Promise<(MapExportResult & { pdfBytes: Uint8Array; filePath: string }) | null> {
  const rendered = await renderStatutoryReport(input);

  const saveResult = await dialog.showSaveDialog(parentWindow ?? undefined!, {
    title: "Export Statutory Survey Report (PDF)",
    defaultPath: `metardu-statutory-report.pdf`,
    filters: [
      { name: "PDF Document", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return null;
  }

  const { writeFileSync } = await import("node:fs");
  writeFileSync(saveResult.filePath, Buffer.from(rendered.pdfBytes));
  console.log(
    `[map-export] wrote statutory report (${rendered.pdfBytes.length} bytes, ${rendered.widthPx}×${rendered.heightPx} @ ${PRINT_DPI} DPI, scale 1:${rendered.scaleDenominator}) → ${saveResult.filePath}`,
  );
  return { ...rendered, filePath: saveResult.filePath };
}

/**
 * Render the survey plan to a single-page, print-grade PDF.
 *
 * Reuses renderSurveyMapPng for the exact sheet (same SVG builder, same
 * title block / statutory layout / footer, same 300 DPI rasterization),
 * then embeds the PNG full-bleed on a page sized to the sheet in points:
 *   page_w = sheet width pt, page_h = sheet height pt
 * so every PDF point carries a print-resolution cell. The result is the
 * plan sheet itself — no flight-plan report wrapper, no cover page.
 */
export async function renderSurveyMapPdf(
  input: MapExportInput,
): Promise<MapExportResult & { pdfBytes: Uint8Array }> {
  const rendered = await renderSurveyMapPng(input);
  const sheet = resolveSheetPt(input.sheetSize, input.orientation);
  const widthPt = sheet?.widthPt ?? 842;   // A4 landscape fallback (matches SVG builder)
  const heightPt = sheet?.heightPt ?? 595;
  const pdfBytes = await renderSinglePlanPdf({
    title: input.projectName || "Survey Plan",
    surveyorName: input.surveyorName,
    date: input.date ?? new Date().toISOString().split("T")[0],
    coordinateSystemLabel: input.coordinateSystemLabel,
    scaleDenominator: rendered.scaleDenominator,
    widthPt,
    heightPt,
    png: rendered.pngBytes,
  });
  return { ...rendered, pdfBytes };
}

/**
 * Render the plan-sheet PDF and show a Save-As dialog (main process owns fs).
 */
export async function exportSurveyMapPdf(
  parentWindow: BrowserWindow | null,
  input: MapExportInput,
): Promise<(MapExportResult & { pdfBytes: Uint8Array; filePath: string }) | null> {
  const rendered = await renderSurveyMapPdf(input);

  const saveResult = await dialog.showSaveDialog(parentWindow ?? undefined!, {
    title: "Export Survey Plan (PDF)",
    defaultPath: `metardu-survey-plan.pdf`,
    filters: [
      { name: "PDF Document", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return null;
  }

  const { writeFileSync } = await import("node:fs");
  writeFileSync(saveResult.filePath, Buffer.from(rendered.pdfBytes));
  console.log(
    `[map-export] wrote plan PDF (${rendered.pdfBytes.length} bytes, ${rendered.widthPx}×${rendered.heightPx} @ ${PRINT_DPI} DPI, scale 1:${rendered.scaleDenominator}) → ${saveResult.filePath}`,
  );
  return { ...rendered, filePath: saveResult.filePath };
}

/**
 * Auto-export on workflow completion — no dialog, no user interaction.
 *
 * Writes the statutory plan into a deterministic folder under
 * userData/auto-exports/<slug>-<timestamp>/ so every run produces a
 * fresh, findable artifact:
 *   - single sheet  → <project>-300dpi.png
 *   - multi-parcel  → <project>-booklet.pdf + one 300 DPI PNG per parcel
 *
 * The plan-sheet profile (title block, layout, footer, sheet defaults)
 * is resolved by the caller (main/index.ts resolvePlanSheet) exactly as
 * the dialog exporters use it, so the auto-exported sheet is identical
 * to a manual export.
 */
export async function autoExportSurveyPlan(
  input: MapExportInput,
): Promise<AutoExportResult> {
  const kind = detectAutoExportKind(input.surveyOutput);
  if (kind === "skip") {
    throw new Error("Nothing to plot — the survey output has no plottable geometry.");
  }

  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const slug = (input.projectName || "survey")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "survey";
  // Millisecond precision so two runs inside one second can't collide on
  // the same directory and silently overwrite each other's plan files.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  const dir = join(app.getPath("userData"), "auto-exports", `${slug}-${stamp}`);
  mkdirSync(dir, { recursive: true });

  // Statutory report PDF (A4 cover + the exact plan sheet as the
  // survey-map page) — the filing-ready artifact. Same renderSurveyMapPng
  // path as the dialog exporters, so the embedded map is pixel-identical
  // to the plan sheets written below. Written for BOTH single-sheet and
  // booklet runs, so every workflow completion lands a full report with
  // the embedded map — no ExportPanel / Map View visit needed. A report
  // render failure never fails the auto-export; the plan sheet is still
  // written, we just log and continue.
  let reportFile: { path: string; bytes: number } | undefined;
  try {
    const report = await renderStatutoryReport(input);
    const reportPath = join(dir, `${slug}-statutory-report.pdf`);
    writeFileSync(reportPath, Buffer.from(report.pdfBytes));
    reportFile = { path: reportPath, bytes: report.pdfBytes.length };
    console.log(
      `[map-export] auto statutory report (${report.pdfBytes.length} bytes) → ${reportPath}`,
    );
  } catch (err) {
    console.warn(
      `[map-export] auto statutory report skipped: ${(err as Error).message} — plan sheet still written`,
    );
  }

  if (kind === "booklet") {
    const { parcels, bookletPdfBytes } = await renderParcelBooklet(input);
    const pdfPath = join(dir, `${slug}-booklet.pdf`);
    writeFileSync(pdfPath, Buffer.from(bookletPdfBytes));

    // One full-res PNG AND one statutory report PDF per parcel,
    // sanitized slugs never collide.
    const used = new Set<string>();
    const files: AutoExportResult["files"] = [
      { label: "booklet", path: pdfPath, bytes: bookletPdfBytes.length },
    ];
    const sanitize = (s: string): string =>
      s.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "parcel";
    for (const plan of parcels) {
      let name = `${slug}-${sanitize(plan.label)}-300dpi.png`;
      let n = 2;
      while (used.has(name)) {
        name = `${slug}-${sanitize(plan.label)}-300dpi-${n}.png`;
        n += 1;
      }
      used.add(name);
      const pngPath = join(dir, name);
      writeFileSync(pngPath, Buffer.from(plan.result.pngBytes));
      files.push({ label: plan.label, path: pngPath, bytes: plan.result.pngBytes.length });

      // One filing-ready statutory report per parcel (cover + embedded
      // plan sheet), written beside the PNG and the combined booklet.
      let reportName = `${slug}-${sanitize(plan.label)}-report.pdf`;
      let m = 2;
      while (used.has(reportName)) {
        reportName = `${slug}-${sanitize(plan.label)}-report-${m}.pdf`;
        m += 1;
      }
      if (plan.reportPdfBytes) {
        used.add(reportName);
        const reportPath = join(dir, reportName);
        writeFileSync(reportPath, Buffer.from(plan.reportPdfBytes));
        files.push({ label: `${plan.label} report`, path: reportPath, bytes: plan.reportPdfBytes.length });
      }
    }

    console.log(`[map-export] auto booklet (${parcels.length} parcels + ${parcels.length} per-parcel reports) → ${dir}`);
    return {
      kind: "booklet",
      directory: dir,
      files,
      pageCount: parcels.length + 1,
      scaleDenominator: parcels[0]?.result.scaleDenominator ?? 0,
      // First sheet's summary — each parcel's own summary is on its PNG.
      summary: parcels[0]?.result.summary ?? "",
      reportFile,
    };
  }

  // Single sheet.
  const result = await renderSurveyMapPng(input);
  const pngPath = join(dir, `${slug}-300dpi.png`);
  writeFileSync(pngPath, Buffer.from(result.pngBytes));
  console.log(`[map-export] auto PNG (${result.widthPx}×${result.heightPx}) → ${pngPath}`);
  return {
    kind: "png",
    directory: dir,
    files: [{ label: "plan", path: pngPath, bytes: result.pngBytes.length }],
    scaleDenominator: result.scaleDenominator,
    summary: result.summary,
    reportFile,
  };
}

/**
 * Render the map PNG and show a Save-As dialog (main process owns fs).
 * Returns the write result, or null if the user cancelled.
 */
export async function exportSurveyMapPng(
  parentWindow: BrowserWindow | null,
  input: MapExportInput,
): Promise<MapExportResult & { filePath: string } | null> {
  const rendered = await renderSurveyMapPng(input);

  const saveResult = await dialog.showSaveDialog(parentWindow ?? undefined!, {
    title: "Export Survey Map (300 DPI)",
    defaultPath: `metardu-survey-plan-300dpi.png`,
    filters: [
      { name: "PNG Image", extensions: ["png"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return null;
  }

  const buf = Buffer.from(rendered.pngBytes);
  // fs is imported by the caller (main/index.ts) — write via node:fs here.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(saveResult.filePath, buf);

  console.log(
    `[map-export] wrote ${buf.length} bytes (${rendered.widthPx}×${rendered.heightPx} @ ${PRINT_DPI} DPI, scale 1:${rendered.scaleDenominator}) to ${saveResult.filePath}`,
  );

  return { ...rendered, filePath: saveResult.filePath };
}

/** One parcel's rendered 300 DPI plan sheet + its statutory report PDF. */
export interface ParcelPlanResult {
  label: string;
  result: MapExportResult;
  /**
   * Statutory report PDF (A4 cover + this parcel's plan sheet embedded).
   * Optional: a per-parcel report render failure is logged and skipped so
   * the plan PNG + booklet still write (same resilience as auto-export).
   */
  reportPdfBytes?: Uint8Array;
}

export interface ParcelBookletRenderResult {
  parcels: ParcelPlanResult[];
  bookletPdfBytes: Uint8Array;
}

/** SVG-build options shared by every per-parcel plan sheet. */
interface ParcelSheetBuildOptions {
  title: string;
  coordinateSystemLabel?: string;
  surveyorName?: string;
  date: string;
  sheetSize?: string;
  orientation?: "landscape" | "portrait";
  scaleDenominator?: number;
  titleBlockLabel?: string;
  planTypeLabel?: string;
  footerNote?: string;
  titleBlockLayout?: StatutoryTitleBlock;
}

/**
 * Render one parcel's geometry to a 300 DPI plan PNG. Shared by the
 * single-project and multi-project booklet paths so the rasterization
 * ladder (SVG → sharp) is defined exactly once.
 */
async function renderParcelSheet(
  parcel: MapParcel,
  opts: ParcelSheetBuildOptions,
): Promise<MapExportResult> {
  const built: SurveyMapSvgResult = buildSurveyMapSvg(parcel.geometry, {
    title: opts.title,
    coordinateSystemLabel: opts.coordinateSystemLabel,
    surveyorName: opts.surveyorName,
    date: opts.date,
    sheetSize: opts.sheetSize,
    orientation: opts.orientation,
    scaleMode:
      opts.scaleDenominator && opts.scaleDenominator > 0
        ? { mode: "fixed", denominator: opts.scaleDenominator }
        : undefined,
    titleBlockLabel: opts.titleBlockLabel,
    planTypeLabel: opts.planTypeLabel,
    footerNote: opts.footerNote,
    titleBlockLayout: opts.titleBlockLayout,
  });
  const png = await sharp(Buffer.from(built.svg), { density: PRINT_DPI }).png().toBuffer();
  return {
    pngBytes: new Uint8Array(png),
    widthPx: built.widthPx,
    heightPx: built.heightPx,
    scaleDenominator: built.scaleDenominator,
    fitsSheet: built.fitsSheet,
    summary: summarizeGeometry(parcel.geometry),
  };
}

/**
 * Build a parcel's statutory report PDF (A4 cover + the exact plan sheet
 * as the survey-map page) from its already-rendered 300 DPI PNG. Each
 * parcel in a batch export gets its own filing-ready report, so a
 * surveyor files one PDF per parcel — plus the combined booklet with the
 * index page. Mirrors renderStatutoryReport's cover fields but is scoped
 * to a single parcel's sheet and label.
 */
async function renderParcelStatutoryReportPdf(
  result: MapExportResult,
  opts: ParcelSheetBuildOptions,
): Promise<Uint8Array> {
  const sheet = resolveSheetPt(opts.sheetSize, opts.orientation);
  return renderStatutoryReportPdf({
    title: opts.title,
    surveyorName: opts.surveyorName,
    date: opts.date,
    coordinateSystemLabel: opts.coordinateSystemLabel,
    scaleDenominator: result.scaleDenominator,
    titleBlockLabel: opts.titleBlockLabel,
    planTypeLabel: opts.planTypeLabel,
    footerNote: opts.footerNote,
    summary: result.summary,
    png: result.pngBytes,
    mapWidthPt: sheet?.widthPt ?? 842,
    mapHeightPt: sheet?.heightPt ?? 595,
    mapCaption: `Plan sheet ${(opts.sheetSize ?? "a4").toUpperCase()} ${opts.orientation ?? "landscape"} — 300 DPI, scale 1:${result.scaleDenominator}`,
  });
}

/**
 * Render one 300 DPI plan PNG per parcel (split via splitGeometryIntoParcels),
 * one statutory report PDF per parcel (cover + embedded plan sheet), and
 * compile them into a statutory parcel-plan booklet PDF (cover/index +
 * one full-page plan per parcel). Pure render — no dialog, no fs.
 */
export async function renderParcelBooklet(
  input: MapExportInput,
): Promise<ParcelBookletRenderResult> {
  const geometry = extractMapGeometry(input.surveyOutput);
  const parcels: MapParcel[] = splitGeometryIntoParcels(input.surveyOutput, geometry);

  const plans: ParcelPlanResult[] = [];
  for (const parcel of parcels) {
    const opts: ParcelSheetBuildOptions = {
      title:
        parcel.label === "Parcel"
          ? input.projectName || "Survey Plan"
          : `${input.projectName || "Survey Plan"} — ${parcel.label}`,
      coordinateSystemLabel: input.coordinateSystemLabel,
      surveyorName: input.surveyorName,
      date: input.date ?? new Date().toISOString().split("T")[0],
      sheetSize: input.sheetSize,
      orientation: input.orientation,
      scaleDenominator: input.scaleDenominator,
      titleBlockLabel: input.titleBlockLabel,
      planTypeLabel: input.planTypeLabel,
      footerNote: input.footerNote,
      titleBlockLayout: input.titleBlockLayout,
    };
    const result = await renderParcelSheet(parcel, opts);
    // One bad parcel's report must never kill the batch: render it under a
    // guard and skip (plan PNG + booklet still write) on failure.
    let reportPdfBytes: Uint8Array | undefined;
    try {
      reportPdfBytes = await renderParcelStatutoryReportPdf(result, opts);
    } catch (err) {
      console.warn(
        `[map-export] per-parcel statutory report skipped for "${parcel.label}": ${(err as Error).message}`,
      );
    }
    plans.push({ label: parcel.label, result, reportPdfBytes });
  }

  const bookletPdfBytes = await renderParcelBookletPdf({
    projectName: input.projectName || "Survey Plan Booklet",
    surveyorName: input.surveyorName,
    date: input.date ?? new Date().toISOString().split("T")[0],
    coordinateSystemLabel: input.coordinateSystemLabel,
    parcels: plans.map((p) => ({
      label: p.label,
      png: p.result.pngBytes,
      scaleDenominator: p.result.scaleDenominator,
      widthPx: p.result.widthPx,
      heightPx: p.result.heightPx,
    })),
  });

  return { parcels: plans, bookletPdfBytes: new Uint8Array(bookletPdfBytes) };
}

/**
 * Render the parcel booklet PDF + individual per-parcel 300 DPI PNGs,
 * show a Save-As dialog for the PDF, and write the PNGs into the same
 * directory. Returns null if the user cancelled.
 */
export async function exportParcelBooklet(
  parentWindow: BrowserWindow | null,
  input: MapExportInput,
): Promise<{
  bookletPath: string;
  pageCount: number;
  pngFiles: Array<{ label: string; path: string; bytes: number }>;
  reportFiles: Array<{ label: string; path: string; bytes: number }>;
} | null> {
  const { parcels, bookletPdfBytes } = await renderParcelBooklet(input);

  const saveResult = await dialog.showSaveDialog(parentWindow ?? undefined!, {
    title: "Export Parcel Plan Booklet (PDF)",
    defaultPath: `metardu-parcel-booklet.pdf`,
    filters: [
      { name: "PDF Document", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return null;
  }

  const { writeFileSync } = await import("node:fs");
  const { dirname, basename, join } = await import("node:path");
  const outDir = dirname(saveResult.filePath);
  const stem = basename(saveResult.filePath, ".pdf");

  writeFileSync(saveResult.filePath, Buffer.from(bookletPdfBytes));

  // Write the individual full-resolution plan PNGs AND one statutory
  // report PDF per parcel beside the booklet. Labels that sanitize to
  // the same slug (e.g. non-ASCII names) get a numeric suffix so no file
  // is silently overwritten.
  const pngFiles: Array<{ label: string; path: string; bytes: number }> = [];
  const reportFiles: Array<{ label: string; path: string; bytes: number }> = [];
  const usedPngPaths = new Set<string>();
  const usedReportPaths = new Set<string>();
  for (const plan of parcels) {
    const safeLabel = plan.label.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "parcel";
    let pngPath = join(outDir, `${stem}-${safeLabel}-300dpi.png`);
    let n = 2;
    while (usedPngPaths.has(pngPath)) {
      pngPath = join(outDir, `${stem}-${safeLabel}-300dpi-${n}.png`);
      n += 1;
    }
    usedPngPaths.add(pngPath);
    writeFileSync(pngPath, Buffer.from(plan.result.pngBytes));
    pngFiles.push({ label: plan.label, path: pngPath, bytes: plan.result.pngBytes.length });

    if (plan.reportPdfBytes) {
      let reportPath = join(outDir, `${stem}-${safeLabel}-report.pdf`);
      let m = 2;
      while (usedReportPaths.has(reportPath)) {
        reportPath = join(outDir, `${stem}-${safeLabel}-report-${m}.pdf`);
        m += 1;
      }
      usedReportPaths.add(reportPath);
      writeFileSync(reportPath, Buffer.from(plan.reportPdfBytes));
      reportFiles.push({ label: plan.label, path: reportPath, bytes: plan.reportPdfBytes.length });
    }
  }

  console.log(
    `[map-export] booklet (${parcels.length} parcels, ${bookletPdfBytes.length} bytes) + ${reportFiles.length} per-parcel statutory reports → ${saveResult.filePath}`,
  );

  return {
    bookletPath: saveResult.filePath,
    pageCount: parcels.length + 1, // cover/index + one plan page per parcel
    pngFiles,
    reportFiles,
  };
}

/** One project contributing plan sheets to a scheme booklet. */
export interface ProjectBookletProjectInput {
  name: string;
  surveyOutput: unknown;
  /** CRS label for the plan title strip (resolved per project's country). */
  coordinateSystemLabel?: string;
  /** Per-country plan-sheet title block / footer (resolved per project). */
  titleBlockLabel?: string;
  planTypeLabel?: string;
  footerNote?: string;
  /** Per-market statutory title block (field grid, certification, seal). */
  titleBlockLayout?: StatutoryTitleBlock;
}

export interface ProjectBookletInput {
  projects: ProjectBookletProjectInput[];
  /** Shared sheet for the whole scheme compilation. */
  sheetSize?: string;
  orientation?: "landscape" | "portrait";
  scaleDenominator?: number;
  surveyorName?: string;
  date?: string;
}

export interface ProjectBookletRenderResult {
  /** Every plan sheet across every project, tagged with its project. */
  sheets: Array<{
    projectName: string;
    label: string;
    result: MapExportResult;
    /** Statutory report PDF for this sheet (cover + embedded plan). */
    reportPdfBytes?: Uint8Array;
  }>;
  bookletPdfBytes: Uint8Array;
}

/**
 * Render a multi-project scheme booklet: every parcel of every selected
 * project gets its own 300 DPI plan sheet (using that project's country
 * title block / footer), compiled into one booklet with a master index
 * grouping rows by project. Pure render — no dialog, no fs.
 */
export async function renderProjectsBooklet(
  input: ProjectBookletInput,
): Promise<ProjectBookletRenderResult> {
  const sheets: ProjectBookletRenderResult["sheets"] = [];

  for (const project of input.projects) {
    const geometry = extractMapGeometry(project.surveyOutput);
    const parcels: MapParcel[] = splitGeometryIntoParcels(project.surveyOutput, geometry);
    for (const parcel of parcels) {
      const opts: ParcelSheetBuildOptions = {
        title: parcel.label === "Parcel" ? project.name : `${project.name} — ${parcel.label}`,
        coordinateSystemLabel: project.coordinateSystemLabel,
        surveyorName: input.surveyorName,
        date: input.date ?? new Date().toISOString().split("T")[0],
        sheetSize: input.sheetSize,
        orientation: input.orientation,
        scaleDenominator: input.scaleDenominator,
        titleBlockLabel: project.titleBlockLabel,
        planTypeLabel: project.planTypeLabel,
        footerNote: project.footerNote,
        titleBlockLayout: project.titleBlockLayout,
      };
      const result = await renderParcelSheet(parcel, opts);
      // Same log-and-continue resilience as the single-project booklet.
      let reportPdfBytes: Uint8Array | undefined;
      try {
        reportPdfBytes = await renderParcelStatutoryReportPdf(result, opts);
      } catch (err) {
        console.warn(
          `[map-export] per-sheet statutory report skipped for "${project.name} — ${parcel.label}": ${(err as Error).message}`,
        );
      }
      sheets.push({ projectName: project.name, label: parcel.label, result, reportPdfBytes });
    }
  }

  const bookletPdfBytes = await renderParcelBookletPdf({
    projectName: input.projects.length === 1
      ? input.projects[0]!.name
      : `Survey Scheme (${input.projects.length} projects)`,
    surveyorName: input.surveyorName,
    date: input.date ?? new Date().toISOString().split("T")[0],
    coordinateSystemLabel:
      input.projects.length === 1 ? input.projects[0]!.coordinateSystemLabel : undefined,
    parcels: sheets.map((s) => ({
      label: s.label,
      projectName: s.projectName,
      png: s.result.pngBytes,
      scaleDenominator: s.result.scaleDenominator,
      widthPx: s.result.widthPx,
      heightPx: s.result.heightPx,
    })),
  });

  return { sheets, bookletPdfBytes: new Uint8Array(bookletPdfBytes) };
}

/**
 * Render the scheme booklet PDF + individual per-parcel 300 DPI PNGs, show
 * a Save-As dialog for the PDF, and write the PNGs into the same directory.
 */
export async function exportProjectsBooklet(
  parentWindow: BrowserWindow | null,
  input: ProjectBookletInput,
): Promise<{
  bookletPath: string;
  pageCount: number;
  pngFiles: Array<{ label: string; path: string; bytes: number }>;
  reportFiles: Array<{ label: string; path: string; bytes: number }>;
} | null> {
  const { sheets, bookletPdfBytes } = await renderProjectsBooklet(input);
  if (sheets.length === 0) {
    throw new Error("None of the selected projects contain plottable survey output.");
  }

  const saveResult = await dialog.showSaveDialog(parentWindow ?? undefined!, {
    title: "Export Survey Scheme Booklet (PDF)",
    defaultPath: `metardu-scheme-booklet.pdf`,
    filters: [
      { name: "PDF Document", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return null;
  }

  const { writeFileSync } = await import("node:fs");
  const { dirname, basename, join } = await import("node:path");
  const outDir = dirname(saveResult.filePath);
  const stem = basename(saveResult.filePath, ".pdf");

  writeFileSync(saveResult.filePath, Buffer.from(bookletPdfBytes));

  // Write the individual full-resolution plan PNGs beside the booklet,
  // named project-parcel so a whole scheme files as one package.
  // Sanitized slugs that collide (duplicate project names, non-ASCII
  // names) get a numeric suffix so no plan is silently overwritten.
  const sanitize = (s: string): string =>
    s.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "plan";
  const pngFiles: Array<{ label: string; path: string; bytes: number }> = [];
  const reportFiles: Array<{ label: string; path: string; bytes: number }> = [];
  const usedPngPaths = new Set<string>();
  const usedReportPaths = new Set<string>();
  for (const sheet of sheets) {
    const base = `${stem}-${sanitize(sheet.projectName)}-${sanitize(sheet.label)}`;
    let pngPath = join(outDir, `${base}-300dpi.png`);
    let n = 2;
    while (usedPngPaths.has(pngPath)) {
      pngPath = join(outDir, `${base}-300dpi-${n}.png`);
      n += 1;
    }
    usedPngPaths.add(pngPath);
    writeFileSync(pngPath, Buffer.from(sheet.result.pngBytes));
    pngFiles.push({
      label: `${sheet.projectName} — ${sheet.label}`,
      path: pngPath,
      bytes: sheet.result.pngBytes.length,
    });

    // One statutory report PDF per sheet, beside its PNG.
    if (sheet.reportPdfBytes) {
      let reportPath = join(outDir, `${base}-report.pdf`);
      let m = 2;
      while (usedReportPaths.has(reportPath)) {
        reportPath = join(outDir, `${base}-report-${m}.pdf`);
        m += 1;
      }
      usedReportPaths.add(reportPath);
      writeFileSync(reportPath, Buffer.from(sheet.reportPdfBytes));
      reportFiles.push({
        label: `${sheet.projectName} — ${sheet.label}`,
        path: reportPath,
        bytes: sheet.reportPdfBytes.length,
      });
    }
  }

  console.log(
    `[map-export] scheme booklet (${sheets.length} sheets across ${input.projects.length} projects, ${bookletPdfBytes.length} bytes) + ${reportFiles.length} per-sheet reports → ${saveResult.filePath}`,
  );

  return {
    bookletPath: saveResult.filePath,
    pageCount: sheets.length + 1, // master index + one plan page per sheet
    pngFiles,
    reportFiles,
  };
}
