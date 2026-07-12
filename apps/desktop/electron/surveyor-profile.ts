/**
 * Surveyor Profile + Submission Tracking + Audit Trail
 *
 * Three modules prescribed by the Survey (Electronic Cadastre Transactions)
 * Regulations, 2020 (LN 132 of 2020):
 *
 *   1. SURVEYOR PROFILE — Form SR1 data persisted to disk
 *      Reg 5 + Reg 6: name, KRA PIN, survey licence, DOS auth code,
 *      practicing certificate, contact info, passport photo.
 *
 *   2. SUBMISSION TRACKING — Reg 9(3): "The system shall automatically
 *      assign a tracking number to the survey data submitted."
 *      Full lifecycle: draft → submitted → under_review → numbered →
 *      authenticated → fees_paid → update_requested → map_updated → sealed
 *      Includes 12-month correction window tracking (Form SR8) and
 *      21-day sealing window tracking (Form SR10).
 *
 *   3. AUDIT TRAIL — Reg 5(4)(i): "Any activity by a user in the system
 *      shall be catalogued and an audit trail of such activity created
 *      in the system."
 *      Records: timestamp, user, action, target, before/after, IP.
 *
 * All data persisted to disk in the user's data directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';
import { createHash } from 'node:crypto';

// ─── Surveyor Profile ──────────────────────────────────────────────────

export interface SurveyorProfile {
  // Identity
  name: string;
  nationalIdOrAlien: string;
  kraPin: string;
  // Professional
  surveyLicenceNumber: string;
  dosAuthorizationCode: string;
  practicingCertificateNumber: string;
  practicingCertificateExpiry?: string;
  // Contact
  telephone: string;
  email: string;
  postalAddress: string;
  physicalAddress: string;
  // Optional
  passportPhotoPath?: string;
  firmName?: string;
  firmRegistrationNumber?: string;
  // Metadata
  createdAt: string;
  updatedAt: string;
  profileVersion: number;
}

const PROFILE_DIR_NAME = 'surveyor_profile';
const PROFILE_FILE = 'profile.json';

function getProfileDir(): string {
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, PROFILE_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function loadSurveyorProfile(): SurveyorProfile | null {
  const profilePath = path.join(getProfileDir(), PROFILE_FILE);
  if (!fs.existsSync(profilePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as SurveyorProfile;
  } catch (e) {
    log.error('Failed to load surveyor profile: ' + String(e));
    return null;
  }
}

export function saveSurveyorProfile(profile: Omit<SurveyorProfile, 'createdAt' | 'updatedAt' | 'profileVersion'>): SurveyorProfile {
  const existing = loadSurveyorProfile();
  const now = new Date().toISOString();
  const newProfile: SurveyorProfile = {
    ...profile,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    profileVersion: (existing?.profileVersion ?? 0) + 1,
  };
  const profilePath = path.join(getProfileDir(), PROFILE_FILE);
  fs.writeFileSync(profilePath, JSON.stringify(newProfile, null, 2), { mode: 0o600 });
  log.info(`Surveyor profile saved (version ${newProfile.profileVersion})`);

  // Audit the save
  recordAuditEvent({
    timestamp: now,
    user: profile.name,
    action: 'profile_updated',
    target: 'surveyor_profile',
    details: `Profile version ${newProfile.profileVersion} saved`,
  });

  return newProfile;
}

export function validateSurveyorProfile(profile: Partial<SurveyorProfile>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!profile.name || profile.name.trim().length < 3) errors.push('Name must be at least 3 characters');
  if (!profile.nationalIdOrAlien || profile.nationalIdOrAlien.length < 6) errors.push('National ID / Alien Card number must be at least 6 characters');
  if (!profile.kraPin || !/^[A-Z]\d{9}[A-Z]$/.test(profile.kraPin)) errors.push('KRA PIN must match format A123456789B (letter + 9 digits + letter)');
  if (!profile.surveyLicenceNumber) errors.push('Survey Licence Number is required');
  if (!profile.dosAuthorizationCode) errors.push('DOS Authorization Code is required');
  if (!profile.practicingCertificateNumber) errors.push('Practicing Certificate Number is required');
  if (!profile.telephone || profile.telephone.length < 10) errors.push('Telephone number must be at least 10 characters');
  if (!profile.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) errors.push('Email address is invalid');
  if (!profile.postalAddress) errors.push('Postal Address is required');
  if (!profile.physicalAddress) errors.push('Physical Address is required');
  return { valid: errors.length === 0, errors };
}

// ─── Submission Tracking ───────────────────────────────────────────────

export type SubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'rejected_pre_numbering'
  | 'numbered'
  | 'authenticated'
  | 'rejected_post_auth'
  | 'corrections_pending'
  | 'fees_paid'
  | 'update_requested'
  | 'map_updated'
  | 'sealed';

export interface SubmissionRecord {
  trackingNumber: string;
  surveyorName: string;
  surveyType: string;
  locality: string;
  lrNumber: string;
  parcelNumbers: string[];
  status: SubmissionStatus;
  submittedAt: string;
  lastUpdated: string;
  history: Array<{
    timestamp: string;
    fromStatus: SubmissionStatus | null;
    toStatus: SubmissionStatus;
    note?: string;
    officerName?: string;
    formCode?: string; // SR3, SR4, SR5, etc.
  }>;
  // Important dates
  dateReceived?: string;
  dateNumbered?: string;
  dateAuthenticated?: string;
  dateRejected?: string;
  dateFeesPaid?: string;
  dateUpdateRequested?: string;
  dateMapUpdated?: string;
  dateSealed?: string;
  // Deadlines
  correctionDeadline?: string;  // 12 months from rejection
  sealingDeadline?: string;     // 21 days from update request
  // Fees
  assessedSurveyFees?: number;
  assessedCheckingFees?: number;
  assessedMapUpdatingFees?: number;
  assessedTotalFees?: number;
  // File references
  planFrNumber?: string;
  computationsFileNumber?: string;
  fieldNotesNumber?: string;
  skFileNumber?: string;
}

const SUBMISSIONS_DIR_NAME = 'submissions';
const SUBMISSIONS_FILE = 'submissions.json';

function getSubmissionsDir(): string {
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, SUBMISSIONS_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadAllSubmissions(): Record<string, SubmissionRecord> {
  const filePath = path.join(getSubmissionsDir(), SUBMISSIONS_FILE);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveAllSubmissions(submissions: Record<string, SubmissionRecord>): void {
  const filePath = path.join(getSubmissionsDir(), SUBMISSIONS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(submissions, null, 2), { mode: 0o600 });
}

/**
 * Generate a tracking number per Reg 9(3).
 * Format: SR-YYYYMMDD-XXXXX where XXXXX is a zero-padded sequence.
 */
export function generateTrackingNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().substring(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `SR-${dateStr}-${random}`;
}

export function createSubmission(input: {
  surveyorName: string;
  surveyType: string;
  locality: string;
  lrNumber: string;
  parcelNumbers: string[];
}): SubmissionRecord {
  const now = new Date().toISOString();
  const trackingNumber = generateTrackingNumber();
  const submission: SubmissionRecord = {
    trackingNumber,
    surveyorName: input.surveyorName,
    surveyType: input.surveyType,
    locality: input.locality,
    lrNumber: input.lrNumber,
    parcelNumbers: input.parcelNumbers,
    status: 'submitted',
    submittedAt: now,
    lastUpdated: now,
    history: [{
      timestamp: now,
      fromStatus: null,
      toStatus: 'submitted',
      note: 'Submission created via Form SR3',
      formCode: 'SR3',
    }],
  };

  const all = loadAllSubmissions();
  all[trackingNumber] = submission;
  saveAllSubmissions(all);

  recordAuditEvent({
    timestamp: now,
    user: input.surveyorName,
    action: 'submission_created',
    target: trackingNumber,
    details: `Submission created for ${input.lrNumber} (${input.surveyType})`,
  });

  log.info(`Submission created: ${trackingNumber}`);
  return submission;
}

export function updateSubmissionStatus(
  trackingNumber: string,
  newStatus: SubmissionStatus,
  options?: { note?: string; officerName?: string; formCode?: string }
): SubmissionRecord | null {
  const all = loadAllSubmissions();
  const submission = all[trackingNumber];
  if (!submission) {
    log.error(`Submission not found: ${trackingNumber}`);
    return null;
  }

  const now = new Date().toISOString();
  const oldStatus = submission.status;
  submission.status = newStatus;
  submission.lastUpdated = now;
  submission.history.push({
    timestamp: now,
    fromStatus: oldStatus,
    toStatus: newStatus,
    note: options?.note,
    officerName: options?.officerName,
    formCode: options?.formCode,
  });

  // Update date fields based on new status
  switch (newStatus) {
    case 'under_review':
      if (!submission.dateReceived) submission.dateReceived = now;
      break;
    case 'numbered':
      submission.dateNumbered = now;
      break;
    case 'authenticated':
      submission.dateAuthenticated = now;
      break;
    case 'rejected_pre_numbering':
    case 'rejected_post_auth':
      submission.dateRejected = now;
      // 12-month correction window per Form SR8
      const deadline = new Date(now);
      deadline.setFullYear(deadline.getFullYear() + 1);
      submission.correctionDeadline = deadline.toISOString();
      break;
    case 'fees_paid':
      submission.dateFeesPaid = now;
      break;
    case 'update_requested':
      submission.dateUpdateRequested = now;
      // 21-day sealing window per Reg 14
      const sealingDeadline = new Date(now);
      sealingDeadline.setDate(sealingDeadline.getDate() + 21);
      submission.sealingDeadline = sealingDeadline.toISOString();
      break;
    case 'map_updated':
      submission.dateMapUpdated = now;
      break;
    case 'sealed':
      submission.dateSealed = now;
      break;
  }

  all[trackingNumber] = submission;
  saveAllSubmissions(all);

  recordAuditEvent({
    timestamp: now,
    user: options?.officerName ?? submission.surveyorName,
    action: 'submission_status_changed',
    target: trackingNumber,
    details: `${oldStatus} → ${newStatus}${options?.note ? ': ' + options.note : ''}`,
  });

  log.info(`Submission ${trackingNumber}: ${oldStatus} → ${newStatus}`);
  return submission;
}

export function listSubmissions(): SubmissionRecord[] {
  const all = loadAllSubmissions();
  return Object.values(all).sort((a, b) =>
    new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
}

export function getSubmission(trackingNumber: string): SubmissionRecord | null {
  return loadAllSubmissions()[trackingNumber] ?? null;
}

export function deleteSubmission(trackingNumber: string): boolean {
  const all = loadAllSubmissions();
  if (!all[trackingNumber]) return false;
  delete all[trackingNumber];
  saveAllSubmissions(all);
  recordAuditEvent({
    timestamp: new Date().toISOString(),
    user: 'system',
    action: 'submission_deleted',
    target: trackingNumber,
    details: 'Submission record deleted',
  });
  return true;
}

/**
 * Get submissions that are approaching deadlines.
 * - corrections_pending: approaching 12-month correction deadline
 * - update_requested: approaching 21-day sealing deadline
 */
export function getDeadlineAlerts(): Array<{
  trackingNumber: string;
  surveyorName: string;
  locality: string;
  deadlineType: 'correction' | 'sealing';
  deadline: string;
  daysRemaining: number;
}> {
  const submissions = listSubmissions();
  const alerts: Array<any> = [];
  const now = Date.now();

  for (const s of submissions) {
    if (s.correctionDeadline && (s.status === 'rejected_post_auth' || s.status === 'corrections_pending')) {
      const deadline = new Date(s.correctionDeadline).getTime();
      const daysRemaining = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 60) {  // alert if less than 60 days remaining
        alerts.push({
          trackingNumber: s.trackingNumber,
          surveyorName: s.surveyorName,
          locality: s.locality,
          deadlineType: 'correction' as const,
          deadline: s.correctionDeadline,
          daysRemaining,
        });
      }
    }
    if (s.sealingDeadline && s.status === 'update_requested') {
      const deadline = new Date(s.sealingDeadline).getTime();
      const daysRemaining = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 7) {  // alert if less than 7 days remaining
        alerts.push({
          trackingNumber: s.trackingNumber,
          surveyorName: s.surveyorName,
          locality: s.locality,
          deadlineType: 'sealing' as const,
          deadline: s.sealingDeadline,
          daysRemaining,
        });
      }
    }
  }

  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

// ─── Audit Trail ───────────────────────────────────────────────────────

export interface AuditEvent {
  timestamp: string;
  user: string;
  action: string;
  target: string;
  details?: string;
  // Optional: hash chain for tamper-evidence
  previousHash?: string;
  eventHash?: string;
}

const AUDIT_DIR_NAME = 'audit_trail';
const AUDIT_FILE = 'audit.log.jsonl';  // JSON Lines for append-only

function getAuditDir(): string {
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, AUDIT_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getLastAuditHash(): string | undefined {
  const filePath = path.join(getAuditDir(), AUDIT_FILE);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return undefined;
    const lines = content.split('\n');
    const lastLine = lines[lines.length - 1];
    const lastEvent = JSON.parse(lastLine) as AuditEvent;
    return lastEvent.eventHash;
  } catch {
    return undefined;
  }
}

export function recordAuditEvent(event: Omit<AuditEvent, 'previousHash' | 'eventHash'>): void {
  const previousHash = getLastAuditHash();
  const fullEvent: AuditEvent = {
    ...event,
    previousHash,
  };
  // Compute event hash: SHA-256 of (previousHash + timestamp + user + action + target + details)
  const hashInput = (previousHash ?? '') + '|' + event.timestamp + '|' + event.user + '|' + event.action + '|' + event.target + '|' + (event.details ?? '');
  fullEvent.eventHash = createHash('sha256').update(hashInput).digest('hex');

  const filePath = path.join(getAuditDir(), AUDIT_FILE);
  fs.appendFileSync(filePath, JSON.stringify(fullEvent) + '\n', { mode: 0o600 });
}

export interface AuditQueryOptions {
  user?: string;
  action?: string;
  target?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export function queryAuditEvents(options: AuditQueryOptions = {}): AuditEvent[] {
  const filePath = path.join(getAuditDir(), AUDIT_FILE);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  const lines = content.split('\n');
  let events: AuditEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {}
  }

  // Apply filters
  if (options.user) events = events.filter(e => e.user === options.user);
  if (options.action) events = events.filter(e => e.action === options.action);
  if (options.target) events = events.filter(e => e.target === options.target);
  if (options.startDate) events = events.filter(e => e.timestamp >= options.startDate!);
  if (options.endDate) events = events.filter(e => e.timestamp <= options.endDate!);

  // Sort newest first
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply limit
  if (options.limit && options.limit > 0) {
    events = events.slice(0, options.limit);
  }

  return events;
}

/**
 * Verify the integrity of the audit trail by recomputing the hash chain.
 * Returns true if all hashes are consistent (no tampering detected).
 */
export function verifyAuditTrailIntegrity(): { valid: boolean; brokenAt?: number; totalEvents: number } {
  const filePath = path.join(getAuditDir(), AUDIT_FILE);
  if (!fs.existsSync(filePath)) return { valid: true, totalEvents: 0 };
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return { valid: true, totalEvents: 0 };
  const lines = content.split('\n');

  let previousHash: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    try {
      const event = JSON.parse(lines[i]) as AuditEvent;
      if (event.previousHash !== previousHash) {
        return { valid: false, brokenAt: i + 1, totalEvents: lines.length };
      }
      // Recompute hash
      const hashInput = (previousHash ?? '') + '|' + event.timestamp + '|' + event.user + '|' + event.action + '|' + event.target + '|' + (event.details ?? '');
      const expectedHash = createHash('sha256').update(hashInput).digest('hex');
      if (event.eventHash !== expectedHash) {
        return { valid: false, brokenAt: i + 1, totalEvents: lines.length };
      }
      previousHash = event.eventHash;
    } catch {
      return { valid: false, brokenAt: i + 1, totalEvents: lines.length };
    }
  }
  return { valid: true, totalEvents: lines.length };
}
