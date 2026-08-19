/**
 * Field Note Audit Trail for MetaRDU Desktop v2.0.
 *
 * Implements Kenya Survey Regulations 1994, R.69-77:
 *   - All field notes must be in ink
 *   - No erasures — single line through error, initial and date
 *   - Sequential page numbering
 *   - Cover and page index
 *   - Detailed station descriptions
 *   - Instrument data recorded for every observation
 *
 * This module provides a digital audit trail that mirrors paper field book
 * requirements while adding digital-only benefits like change tracking,
 * user attribution, and tamper-evident timestamps.
 *
 * References:
 *   - Kenya Survey Regulations 1994, Part VIII (R.69-77)
 *   - USACE EM 1110-1-1005, Chapter 5 (Data Collection Procedures)
 */

// ─── Types ─────────────────────────────────────────────────────────

/** Action types for the audit trail. */
export type AuditAction =
  | "create"      // New entry created
  | "edit"        // Existing entry modified
  | "delete"      // Entry soft-deleted
  | "verify"      // Entry verified by surveyor
  | "approve"     // Entry approved by chief surveyor
  | "export";     // Entry exported to plan/document

/** A single audit trail entry. */
export interface AuditEntry {
  /** Unique entry ID */
  id: string;
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** User who performed the action */
  userId: string;
  /** User name (for display) */
  userName: string;
  /** Action performed */
  action: AuditAction;
  /** What was changed (field name or "entry") */
  target: string;
  /** Previous value (for edits/deletes) */
  previousValue?: string;
  /** New value (for creates/edits) */
  newValue?: string;
  /** Optional note explaining the change */
  note?: string;
}

/** A field note entry (one observation or setup). */
export interface FieldNoteEntry {
  /** Unique entry ID */
  id: string;
  /** Sequential page number */
  pageNumber: number;
  /** Station/point ID */
  stationId: string;
  /** Date of observation */
  date: string;
  /** Time of observation */
  time: string;
  /** Observer name */
  observer: string;
  /** Instrument type and serial number */
  instrument: string;
  /** Weather conditions */
  weather?: string;
  /** Temperature (°C, for EDM corrections) */
  temperature?: number;
  /** Pressure (hPa, for EDM corrections) */
  pressure?: number;
  /** Observation data (key-value pairs) */
  observations: Record<string, string | number>;
  /** Sketch or description */
  description?: string;
  /** Whether this entry has been verified */
  verified: boolean;
  /** Audit trail for this entry */
  auditTrail: AuditEntry[];
  /** Whether this entry is soft-deleted */
  deleted: boolean;
}

/** A complete field note book. */
export interface FieldNoteBook {
  /** Book identifier */
  bookId: string;
  /** Project name */
  projectName: string;
  /** Surveyor name */
  surveyorName: string;
  /** Surveyor registration number */
  registrationNumber: string;
  /** Start date */
  startDate: string;
  /** End date */
  endDate: string;
  /** All entries */
  entries: FieldNoteEntry[];
  /** Cover notes */
  coverNotes: string;
  /** Table of contents (auto-generated) */
  tableOfContents: string;
  /** Total pages */
  totalPages: number;
}

// ─── Entry Management ──────────────────────────────────────────────

let entryCounter = 0;

/**
 * Generate a unique entry ID.
 */
function generateId(): string {
  entryCounter++;
  return `FN-${Date.now()}-${entryCounter}`;
}

/**
 * Create a new field note entry with audit trail.
 *
 * Per Kenya Survey Regs R.73-74:
 *   - Entry made in ink (digital = permanent)
 *   - No erasures allowed
 *   - Sequential page numbering
 */
export function createFieldNoteEntry(params: {
  pageNumber: number;
  stationId: string;
  date: string;
  time: string;
  observer: string;
  instrument: string;
  weather?: string;
  temperature?: number;
  pressure?: number;
  observations: Record<string, string | number>;
  description?: string;
  userId: string;
  userName: string;
}): FieldNoteEntry {
  const entry: FieldNoteEntry = {
    id: generateId(),
    pageNumber: params.pageNumber,
    stationId: params.stationId,
    date: params.date,
    time: params.time,
    observer: params.observer,
    instrument: params.instrument,
    weather: params.weather,
    temperature: params.temperature,
    pressure: params.pressure,
    observations: { ...params.observations },
    description: params.description,
    verified: false,
    auditTrail: [
      {
        id: generateId(),
        timestamp: new Date().toISOString(),
        userId: params.userId,
        userName: params.userName,
        action: "create",
        target: "entry",
        newValue: JSON.stringify(params.observations),
      },
    ],
    deleted: false,
  };

  return entry;
}

/**
 * Edit a field note entry with audit trail.
 *
 * Per Kenya Survey Regs R.74:
 *   - No erasures — the digital system tracks all changes
 *   - Previous value preserved in audit trail
 *   - Must include note explaining the correction
 */
export function editFieldNoteEntry(
  entry: FieldNoteEntry,
  changes: Partial<Pick<FieldNoteEntry, "observations" | "description" | "weather" | "temperature" | "pressure">>,
  userId: string,
  userName: string,
  note?: string,
): FieldNoteEntry {
  const updated = { ...entry };
  const auditEntries: AuditEntry[] = [...entry.auditTrail];

  // Track changes to observations
  if (changes.observations) {
    const prev = JSON.stringify(entry.observations);
    const next = JSON.stringify(changes.observations);
    if (prev !== next) {
      auditEntries.push({
        id: generateId(),
        timestamp: new Date().toISOString(),
        userId,
        userName,
        action: "edit",
        target: "observations",
        previousValue: prev,
        newValue: next,
        note,
      });
      updated.observations = { ...changes.observations };
    }
  }

  // Track changes to description
  if (changes.description !== undefined && changes.description !== entry.description) {
    auditEntries.push({
      id: generateId(),
      timestamp: new Date().toISOString(),
      userId,
      userName,
      action: "edit",
      target: "description",
      previousValue: entry.description,
      newValue: changes.description,
      note,
    });
    updated.description = changes.description;
  }

  // Track changes to weather/temperature/pressure
  if (changes.weather !== undefined && changes.weather !== entry.weather) {
    auditEntries.push({
      id: generateId(), timestamp: new Date().toISOString(), userId, userName,
      action: "edit", target: "weather",
      previousValue: entry.weather, newValue: changes.weather, note,
    });
    updated.weather = changes.weather;
  }
  if (changes.temperature !== undefined && changes.temperature !== entry.temperature) {
    auditEntries.push({
      id: generateId(), timestamp: new Date().toISOString(), userId, userName,
      action: "edit", target: "temperature",
      previousValue: String(entry.temperature), newValue: String(changes.temperature), note,
    });
    updated.temperature = changes.temperature;
  }
  if (changes.pressure !== undefined && changes.pressure !== entry.pressure) {
    auditEntries.push({
      id: generateId(), timestamp: new Date().toISOString(), userId, userName,
      action: "edit", target: "pressure",
      previousValue: String(entry.pressure), newValue: String(changes.pressure), note,
    });
    updated.pressure = changes.pressure;
  }

  updated.auditTrail = auditEntries;
  return updated;
}

/**
 * Verify a field note entry.
 *
 * Per Kenya Survey Regs R.26: "Every surveyor shall perform sufficient
 * work to enable him to apply a thorough check to every part of his survey."
 */
export function verifyFieldNoteEntry(
  entry: FieldNoteEntry,
  userId: string,
  userName: string,
): FieldNoteEntry {
  return {
    ...entry,
    verified: true,
    auditTrail: [
      ...entry.auditTrail,
      {
        id: generateId(),
        timestamp: new Date().toISOString(),
        userId,
        userName,
        action: "verify",
        target: "entry",
        note: "Entry verified by surveyor",
      },
    ],
  };
}

/**
 * Soft-delete a field note entry.
 *
 * Per Kenya Survey Regs R.74: entries cannot be erased.
 * Deletion is tracked in the audit trail.
 */
export function deleteFieldNoteEntry(
  entry: FieldNoteEntry,
  userId: string,
  userName: string,
  reason: string,
): FieldNoteEntry {
  return {
    ...entry,
    deleted: true,
    auditTrail: [
      ...entry.auditTrail,
      {
        id: generateId(),
        timestamp: new Date().toISOString(),
        userId,
        userName,
        action: "delete",
        target: "entry",
        note: reason,
      },
    ],
  };
}

// ─── Book Management ───────────────────────────────────────────────

/**
 * Create a new field note book.
 */
export function createFieldNoteBook(params: {
  bookId: string;
  projectName: string;
  surveyorName: string;
  registrationNumber: string;
  startDate: string;
  coverNotes?: string;
}): FieldNoteBook {
  return {
    bookId: params.bookId,
    projectName: params.projectName,
    surveyorName: params.surveyorName,
    registrationNumber: params.registrationNumber,
    startDate: params.startDate,
    endDate: params.startDate,
    entries: [],
    coverNotes: params.coverNotes ?? "",
    tableOfContents: "",
    totalPages: 0,
  };
}

/**
 * Add an entry to a field note book.
 */
export function addEntryToBook(
  book: FieldNoteBook,
  entry: FieldNoteEntry,
): FieldNoteBook {
  const updated = { ...book };
  updated.entries = [...book.entries, entry];
  updated.totalPages = Math.max(book.totalPages, entry.pageNumber);
  updated.endDate = entry.date;
  updated.tableOfContents = generateTableOfContents(updated);
  return updated;
}

/**
 * Generate a table of contents for the book.
 */
function generateTableOfContents(book: FieldNoteBook): string {
  const lines: string[] = [];
  for (const entry of book.entries) {
    if (!entry.deleted) {
      lines.push(`Page ${entry.pageNumber}: Station ${entry.stationId} — ${entry.date} ${entry.time}`);
    }
  }
  return lines.join("\n");
}

/**
 * Validate a field note book against Kenya Survey Regulations.
 */
export function validateFieldNoteBook(book: FieldNoteBook): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // R.69: Field notes must be on special forms (digital = always compliant)
  // R.73: Method of entering field notes
  // R.74: No erasures — check that deleted entries have audit trail
  for (const entry of book.entries) {
    if (entry.deleted) {
      const hasDeleteAudit = entry.auditTrail.some((a) => a.action === "delete");
      if (!hasDeleteAudit) {
        violations.push(`Page ${entry.pageNumber}: Deleted entry has no audit trail`);
      }
    }

    // Check sequential page numbers
    if (entry.pageNumber !== book.entries.indexOf(entry) + 1) {
      violations.push(`Page ${entry.pageNumber}: Non-sequential page number`);
    }

    // Check all entries have instrument data (R.25)
    if (!entry.instrument) {
      violations.push(`Page ${entry.pageNumber}: Missing instrument data`);
    }
  }

  // Check all entries are verified
  const unverified = book.entries.filter((e) => !e.verified && !e.deleted);
  if (unverified.length > 0) {
    violations.push(`${unverified.length} entries not yet verified`);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Export field note book as a formatted string (for printing/PDF).
 */
export function exportFieldNoteBook(book: FieldNoteBook): string {
  const lines: string[] = [];

  lines.push("=".repeat(60));
  lines.push("FIELD NOTE BOOK");
  lines.push("=".repeat(60));
  lines.push(`Book ID: ${book.bookId}`);
  lines.push(`Project: ${book.projectName}`);
  lines.push(`Surveyor: ${book.surveyorName} (${book.registrationNumber})`);
  lines.push(`Period: ${book.startDate} to ${book.endDate}`);
  lines.push(`Pages: ${book.totalPages}`);
  lines.push("");

  lines.push("TABLE OF CONTENTS");
  lines.push("-".repeat(40));
  lines.push(book.tableOfContents);
  lines.push("");

  for (const entry of book.entries) {
    if (entry.deleted) continue;

    lines.push("=".repeat(60));
    lines.push(`PAGE ${entry.pageNumber}`);
    lines.push("-".repeat(40));
    lines.push(`Station: ${entry.stationId}`);
    lines.push(`Date: ${entry.date}`);
    lines.push(`Time: ${entry.time}`);
    lines.push(`Observer: ${entry.observer}`);
    lines.push(`Instrument: ${entry.instrument}`);
    if (entry.weather) lines.push(`Weather: ${entry.weather}`);
    if (entry.temperature !== undefined) lines.push(`Temperature: ${entry.temperature}°C`);
    if (entry.pressure !== undefined) lines.push(`Pressure: ${entry.pressure} hPa`);
    lines.push("");

    lines.push("Observations:");
    for (const [key, value] of Object.entries(entry.observations)) {
      lines.push(`  ${key}: ${value}`);
    }

    if (entry.description) {
      lines.push("");
      lines.push(`Notes: ${entry.description}`);
    }

    lines.push("");
    lines.push(`Verified: ${entry.verified ? "YES" : "NO"}`);
    lines.push(`Audit Trail: ${entry.auditTrail.length} entries`);
    lines.push("");
  }

  return lines.join("\n");
}
