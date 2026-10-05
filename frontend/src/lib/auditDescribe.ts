/**
 * auditDescribe.ts – turns an audit entry into a readable event description,
 * resolves anomaly-flag metadata and flattens diff_json into a before/after table.
 * Dependencies: audit.api types, i18n keys (en.ts), statusColors (tones)
 */
import type { AuditEntry, AuditFlag, AuditFlagSeverity } from '../api/audit.api';
import type { TranslationKey } from '../i18n/en';
import type { StatusTone } from './statusColors';

type Vars = Record<string, string | number>;

export interface EventDescription {
  key: TranslationKey;
  vars: Vars;
}

const ACTION_KEYS: Record<string, TranslationKey> = {
  admin_instance_access: 'auditEv_action_admin_instance_access',
  full_bundle_download: 'auditEv_action_full_bundle_download',
  bundle_download: 'auditEv_action_bundle_download',
  ip_address_list_download: 'auditEv_action_ip_address_list_download',
  ca_whitelist_add: 'auditEv_action_ca_whitelist_add',
  ca_whitelist_remove: 'auditEv_action_ca_whitelist_remove',
  ca_blacklist_add: 'auditEv_action_ca_blacklist_add',
  ca_blacklist_remove: 'auditEv_action_ca_blacklist_remove',
  bundle_restore: 'auditEv_action_bundle_restore',
  bundle_snapshot: 'auditEv_action_bundle_snapshot',
};

const PROMOTION_KEYS: Record<string, TranslationKey> = {
  REQUEST: 'auditEv_promotion_REQUEST',
  APPROVE: 'auditEv_promotion_APPROVE',
  REJECT: 'auditEv_promotion_REJECT',
  CANCEL: 'auditEv_promotion_CANCEL',
};

const WHITELIST_KEYS: Record<string, TranslationKey> = {
  ADD: 'auditEv_whitelist_ADD',
  LOCK: 'auditEv_whitelist_LOCK',
  UNLOCK: 'auditEv_whitelist_UNLOCK',
  REMOVE: 'auditEv_whitelist_REMOVE',
};

const DENIED_KEYS: Record<string, TranslationKey> = {
  PRIVATE_KEY_REJECTED: 'auditEv_denied_PRIVATE_KEY_REJECTED',
  CA_NOT_WHITELISTED: 'auditEv_denied_CA_NOT_WHITELISTED',
  CA_BLACKLISTED: 'auditEv_denied_CA_BLACKLISTED',
  ALREADY_DECIDED: 'auditEv_denied_ALREADY_DECIDED',
  ALREADY_APPROVED_SAME_SITE: 'auditEv_denied_ALREADY_APPROVED_SAME_SITE',
};

const OP_KEYS: Record<string, TranslationKey> = {
  STEP_UP_FAILED: 'auditEv_op_STEP_UP_FAILED',
  RATE_LIMITED: 'auditEv_op_RATE_LIMITED',
  EXPORT: 'auditEv_op_EXPORT',
  FAILED_LOGIN: 'auditEv_op_FAILED_LOGIN',
};

export function parseDiff(diff: unknown): Record<string, unknown> {
  if (typeof diff === 'string') {
    try {
      return parseDiff(JSON.parse(diff));
    } catch {
      return {};
    }
  }
  return diff && typeof diff === 'object' && !Array.isArray(diff)
    ? (diff as Record<string, unknown>)
    : {};
}

function str(v: unknown, fallback = '—'): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : fallback;
}

/**
 * Pick the translation key + variables describing an entry, or null when no
 * specific wording exists (the caller then shows "<resource> <operation>").
 */
export function describeEvent(entry: AuditEntry): EventDescription | null {
  const d = parseDiff(entry.diff_json);

  if (typeof d.promotion_action === 'string' && PROMOTION_KEYS[d.promotion_action]) {
    return { key: PROMOTION_KEYS[d.promotion_action], vars: { target: str(d.target) } };
  }
  if (typeof d.whitelist_action === 'string' && WHITELIST_KEYS[d.whitelist_action]) {
    return { key: WHITELIST_KEYS[d.whitelist_action], vars: { email: str(d.email) } };
  }
  if (d.admin_action === 'DEMOTE') {
    return { key: 'auditEv_admin_DEMOTE', vars: { email: str(d.email) } };
  }
  if (typeof d.action === 'string' && ACTION_KEYS[d.action]) {
    return { key: ACTION_KEYS[d.action], vars: { subjectDn: str(d.subjectDn) } };
  }
  if (entry.operation === 'DENIED' && typeof d.reason === 'string' && DENIED_KEYS[d.reason]) {
    return { key: DENIED_KEYS[d.reason], vars: {} };
  }
  if (OP_KEYS[entry.operation]) {
    return {
      key: OP_KEYS[entry.operation],
      vars: {
        reason: str(d.reason),
        bucket: str(d.bucket),
        format: str(d.format).toUpperCase(),
        rows: str(d.rows, '0'),
      },
    };
  }
  return null;
}

export interface FlagMeta {
  title: TranslationKey;
  explain: TranslationKey;
}

export const FLAG_META: Record<string, FlagMeta> = {
  FAILED_AUTH_BURST: {
    title: 'auditFlag_FAILED_AUTH_BURST',
    explain: 'auditFlagExplain_FAILED_AUTH_BURST',
  },
  RATE_LIMITED: { title: 'auditFlag_RATE_LIMITED', explain: 'auditFlagExplain_RATE_LIMITED' },
  STEP_UP_FAILED: {
    title: 'auditFlag_STEP_UP_FAILED',
    explain: 'auditFlagExplain_STEP_UP_FAILED',
  },
  PRIVATE_KEY_REJECTED: {
    title: 'auditFlag_PRIVATE_KEY_REJECTED',
    explain: 'auditFlagExplain_PRIVATE_KEY_REJECTED',
  },
  CA_NOT_WHITELISTED: {
    title: 'auditFlag_CA_NOT_WHITELISTED',
    explain: 'auditFlagExplain_CA_NOT_WHITELISTED',
  },
  CA_BLACKLISTED: {
    title: 'auditFlag_CA_BLACKLISTED',
    explain: 'auditFlagExplain_CA_BLACKLISTED',
  },
  OFF_HOURS_ADMIN: {
    title: 'auditFlag_OFF_HOURS_ADMIN',
    explain: 'auditFlagExplain_OFF_HOURS_ADMIN',
  },
  MASS_DELETE: { title: 'auditFlag_MASS_DELETE', explain: 'auditFlagExplain_MASS_DELETE' },
  ADMIN_CHANGE: { title: 'auditFlag_ADMIN_CHANGE', explain: 'auditFlagExplain_ADMIN_CHANGE' },
  CA_LIST_CHANGE: {
    title: 'auditFlag_CA_LIST_CHANGE',
    explain: 'auditFlagExplain_CA_LIST_CHANGE',
  },
  APPROVAL_DENIED: {
    title: 'auditFlag_APPROVAL_DENIED',
    explain: 'auditFlagExplain_APPROVAL_DENIED',
  },
};

export const SEVERITY_TONE: Record<AuditFlagSeverity, StatusTone> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

export const SEVERITY_ICON: Record<AuditFlagSeverity, string> = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
};

export const SEVERITY_LABEL: Record<AuditFlagSeverity, TranslationKey> = {
  info: 'auditSeverityInfo',
  warning: 'auditSeverityWarning',
  critical: 'auditSeverityCritical',
};

const SEVERITY_RANK: Record<AuditFlagSeverity, number> = { info: 0, warning: 1, critical: 2 };

/** The most severe flag of an entry, or null. */
export function topFlag(flags: AuditFlag[] | undefined): AuditFlag | null {
  if (!flags?.length) return null;
  return flags.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a));
}

export interface DiffRow {
  field: string;
  before?: string;
  after?: string;
  value?: string;
}

export interface DiffTable {
  /** 'change' has before/after columns, 'values' a single value column. */
  kind: 'change' | 'values';
  rows: DiffRow[];
}

function show(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Flatten diff_json: `{ before, after }` becomes a field table with both
 * columns, anything else a field/value table. Field names stay as recorded
 * (FHIR resource names are English). Returns null when nothing was recorded.
 */
export function diffTable(diff: unknown): DiffTable | null {
  const d = parseDiff(diff);
  if (Object.keys(d).length === 0) return null;

  if (isRecord(d.before) || isRecord(d.after)) {
    const before = isRecord(d.before) ? d.before : {};
    const after = isRecord(d.after) ? d.after : {};
    const fields = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const rows = fields
      .filter((f) => show(before[f]) !== show(after[f]) || !isRecord(d.before))
      .map((f) => ({ field: f, before: show(before[f]), after: show(after[f]) }));
    return { kind: 'change', rows };
  }
  return {
    kind: 'values',
    rows: Object.entries(d).map(([field, v]) => ({ field, value: show(v) })),
  };
}
