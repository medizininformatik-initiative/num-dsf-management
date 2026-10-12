/**
 * auditAnomalies.ts – Pure anomaly rules over audit-log rows ("Auffälligkeiten").
 *
 * No I/O: takes rows, returns per-row flags and severity counts. Rules look at
 * the rows they are given, so the caller decides the window (the audit query
 * scans the newest ANOMALY_SCAN_CAP rows of the current filter).
 *
 * Flag codes are stable identifiers; the UI maps each to a localized
 * explanation. All thresholds are named constants below.
 *
 * Dependencies: none
 */

export type AnomalySeverity = 'info' | 'warning' | 'critical';

export type AnomalyCode =
  | 'FAILED_AUTH_BURST'
  | 'RATE_LIMITED'
  | 'STEP_UP_FAILED'
  | 'PRIVATE_KEY_REJECTED'
  | 'CA_NOT_WHITELISTED'
  | 'CA_BLACKLISTED'
  | 'OFF_HOURS_ADMIN'
  | 'MASS_DELETE'
  | 'ADMIN_CHANGE'
  | 'CA_LIST_CHANGE'
  | 'APPROVAL_DENIED';

export interface AnomalyFlag {
  code: AnomalyCode;
  severity: AnomalySeverity;
}

export interface AnomalyRow {
  id: string;
  timestamp: Date | string;
  user_email: string | null;
  ip_address: string | null;
  resource_type: string | null;
  operation: string | null;
  diff_json: unknown;
}

export interface AnomalySummary {
  info: number;
  warning: number;
  critical: number;
  /** Number of rows carrying at least one flag. */
  flagged: number;
  /** Number of rows the rules were evaluated over. */
  scanned: number;
}

/** Newest rows of the current filter the rules are evaluated over. */
export const ANOMALY_SCAN_CAP = 5000;
/** Failed sign-in / step-up / rate-limit events per email or IP that count as a burst. */
export const FAILED_BURST_THRESHOLD = 5;
/** Burst size that is escalated to critical. */
export const FAILED_BURST_CRITICAL = 10;
export const FAILED_BURST_WINDOW_MS = 15 * 60 * 1000;
/** Deletes by one actor inside the window that count as a mass delete. */
export const MASS_DELETE_THRESHOLD = 10;
export const MASS_DELETE_WINDOW_MS = 10 * 60 * 1000;
/** Office hours in Europe/Berlin: admin actions from OFF_HOURS_START to OFF_HOURS_END are flagged. */
export const OFF_HOURS_START = 22;
export const OFF_HOURS_END = 6;
const OFFICE_TIME_ZONE = 'Europe/Berlin';

const FAILURE_OPERATIONS = new Set(['FAILED_LOGIN', 'STEP_UP_FAILED', 'RATE_LIMITED']);
const SEVERITY_RANK: Record<AnomalySeverity, number> = { info: 0, warning: 1, critical: 2 };

function toMs(ts: Date | string): number {
  return ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
}

function diffOf(row: AnomalyRow): Record<string, unknown> {
  const d = row.diff_json;
  if (typeof d === 'string') {
    try {
      const parsed: unknown = JSON.parse(d);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
}

/** Hour of day (0-23) of the instant in Europe/Berlin, DST-aware. */
export function berlinHour(ts: Date | string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: OFFICE_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(toMs(ts)));
  return parseInt(hour, 10);
}

export function isOffHours(ts: Date | string): boolean {
  const h = berlinHour(ts);
  return h >= OFF_HOURS_START || h < OFF_HOURS_END;
}

/** True for actions performed with admin powers (approvals, admin management, CA lists, bundles). */
function isAdminAction(row: AnomalyRow): boolean {
  const diff = diffOf(row);
  if (row.resource_type === 'APPROVAL') return true;
  return (
    'promotion_action' in diff ||
    'whitelist_action' in diff ||
    'admin_action' in diff ||
    (typeof diff.action === 'string' && /^(ca_|bundle_restore|bundle_snapshot)/.test(diff.action))
  );
}

/** Sliding-window groups: rows per key whose neighbours within windowMs reach the threshold. */
function windowHits(
  rows: AnomalyRow[],
  keyOf: (r: AnomalyRow) => string | null,
  windowMs: number,
  threshold: number,
): Map<string, number> {
  // id -> size of the largest qualifying window the row is part of
  const hits = new Map<string, number>();
  const byKey = new Map<string, AnomalyRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
    let lo = 0;
    for (let hi = 0; hi < sorted.length; hi++) {
      while (toMs(sorted[hi].timestamp) - toMs(sorted[lo].timestamp) > windowMs) lo++;
      const size = hi - lo + 1;
      if (size >= threshold) {
        for (let i = lo; i <= hi; i++) {
          hits.set(sorted[i].id, Math.max(hits.get(sorted[i].id) ?? 0, size));
        }
      }
    }
  }
  return hits;
}

function push(map: Map<string, AnomalyFlag[]>, id: string, flag: AnomalyFlag): void {
  const list = map.get(id) ?? [];
  // One flag per code per row; keep the stronger severity.
  const existing = list.find((f) => f.code === flag.code);
  if (existing) {
    if (SEVERITY_RANK[flag.severity] > SEVERITY_RANK[existing.severity]) {
      existing.severity = flag.severity;
    }
  } else {
    list.push(flag);
  }
  map.set(id, list);
}

/**
 * Evaluate all rules over the given rows.
 * @returns Flags per row id (rows without a flag are absent), most severe first.
 */
export function computeAnomalyFlags(rows: AnomalyRow[]): Map<string, AnomalyFlag[]> {
  const flags = new Map<string, AnomalyFlag[]>();
  const failures = rows.filter((r) => r.operation !== null && FAILURE_OPERATIONS.has(r.operation));

  // Bursts of failed attempts, per e-mail and per IP.
  const burstByEmail = windowHits(
    failures,
    (r) => (r.user_email ? `e:${r.user_email.toLowerCase()}` : null),
    FAILED_BURST_WINDOW_MS,
    FAILED_BURST_THRESHOLD,
  );
  const burstByIp = windowHits(
    failures,
    (r) => (r.ip_address ? `i:${r.ip_address}` : null),
    FAILED_BURST_WINDOW_MS,
    FAILED_BURST_THRESHOLD,
  );
  for (const r of failures) {
    const size = Math.max(burstByEmail.get(r.id) ?? 0, burstByIp.get(r.id) ?? 0);
    if (size >= FAILED_BURST_THRESHOLD) {
      push(flags, r.id, {
        code: 'FAILED_AUTH_BURST',
        severity: size >= FAILED_BURST_CRITICAL ? 'critical' : 'warning',
      });
    }
  }

  // Many deletes by one actor in a short window.
  const deletes = rows.filter((r) => r.operation === 'DELETE');
  const massDeletes = windowHits(
    deletes,
    (r) => (r.user_email ? r.user_email.toLowerCase() : null),
    MASS_DELETE_WINDOW_MS,
    MASS_DELETE_THRESHOLD,
  );
  for (const id of massDeletes.keys())
    push(flags, id, { code: 'MASS_DELETE', severity: 'warning' });

  for (const r of rows) {
    const diff = diffOf(r);
    const reason = typeof diff.reason === 'string' ? diff.reason : '';

    if (r.operation === 'RATE_LIMITED') {
      push(flags, r.id, { code: 'RATE_LIMITED', severity: 'warning' });
    }
    if (r.operation === 'STEP_UP_FAILED') {
      push(flags, r.id, { code: 'STEP_UP_FAILED', severity: 'info' });
    }
    if (r.operation === 'DENIED') {
      if (reason === 'PRIVATE_KEY_REJECTED') {
        push(flags, r.id, { code: 'PRIVATE_KEY_REJECTED', severity: 'critical' });
      } else if (reason === 'CA_NOT_WHITELISTED') {
        push(flags, r.id, { code: 'CA_NOT_WHITELISTED', severity: 'warning' });
      } else if (reason === 'CA_BLACKLISTED') {
        push(flags, r.id, { code: 'CA_BLACKLISTED', severity: 'critical' });
      } else if (r.resource_type === 'APPROVAL') {
        push(flags, r.id, { code: 'APPROVAL_DENIED', severity: 'warning' });
      }
    }

    if (typeof diff.action === 'string' && /^ca_(whitelist|blacklist)_/.test(diff.action)) {
      push(flags, r.id, { code: 'CA_LIST_CHANGE', severity: 'info' });
    }
    if (
      'promotion_action' in diff ||
      'whitelist_action' in diff ||
      diff.admin_action === 'DEMOTE'
    ) {
      push(flags, r.id, {
        code: 'ADMIN_CHANGE',
        severity: diff.promotion_action === 'APPROVE' ? 'warning' : 'info',
      });
    }

    // Admin login certificates: a colleague (or the server CLI) changing them is
    // a warning, an admin maintaining their own certificates is informational.
    if (diff.action === 'admin_certificate') {
      push(flags, r.id, {
        code: 'ADMIN_CHANGE',
        severity: diff.self === true ? 'info' : 'warning',
      });
    }

    // Four-eyes certificate requests: opening one is informational, the approval
    // that actually activates a colleague's certificate is a warning.
    if (diff.action === 'admin_certificate_request') {
      push(flags, r.id, {
        code: 'ADMIN_CHANGE',
        severity: diff.decision === 'approve' ? 'warning' : 'info',
      });
    }
    // An admin enabling a certificate as login for an organization.
    if (diff.action === 'login_certificate' && diff.change === 'enable') {
      push(flags, r.id, { code: 'ADMIN_CHANGE', severity: 'info' });
    }

    const mutating = r.operation !== 'LOGIN' && r.operation !== 'LOGOUT';
    if (mutating && isAdminAction(r) && isOffHours(r.timestamp)) {
      push(flags, r.id, { code: 'OFF_HOURS_ADMIN', severity: 'info' });
    }
  }

  for (const list of flags.values()) {
    list.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  }
  return flags;
}

/** Count rows by their most severe flag. */
export function summarizeAnomalies(
  flags: Map<string, AnomalyFlag[]>,
  scanned: number,
): AnomalySummary {
  const summary: AnomalySummary = { info: 0, warning: 0, critical: 0, flagged: 0, scanned };
  for (const list of flags.values()) {
    if (list.length === 0) continue;
    summary.flagged += 1;
    summary[list[0].severity] += 1;
  }
  return summary;
}
