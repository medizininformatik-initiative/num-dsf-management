/**
 * auditQuery.service.ts — read-side queries against audit_logs.
 *
 * Call shapes:
 *   - queryAudit:               scoped (instance / own instances / all), filterable,
 *                               paginated, with anomaly flags + severity summary.
 *   - listInstanceAudit / listCrossInstanceAudit: thin wrappers over queryAudit.
 *   - queryAuditForExport:      same filters, capped, for CSV/JSON export.
 *   - listAdminAudit:           admin "everything" view, no joins.
 *
 * Audit_logs is append-only at the DB layer (migration 013).
 *
 * Dependencies: db/connection, auditAnomalies
 */
import type { Knex } from 'knex';
import { db } from '../db/connection';
import {
  ANOMALY_SCAN_CAP,
  computeAnomalyFlags,
  summarizeAnomalies,
  type AnomalyFlag,
  type AnomalySummary,
} from './auditAnomalies';

export interface AuditFilters {
  resource?: string;
  operation?: string;
  from?: Date;
  to?: Date;
  /** Substring of the actor e-mail. */
  actor?: string;
  /** Restrict to one site (instance id). */
  instanceId?: string;
  /** Free text over actor, resource id, IP, site name/label/identifier and details. */
  q?: string;
  flaggedOnly?: boolean;
}

export interface AuditQueryParams extends AuditFilters {
  page: number;
  limit: number;
}

/** Which rows the caller may see: one instance, the caller's own instances, or everything. */
export type AuditScope =
  | { kind: 'instance'; instanceId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'all' };

export interface AuditLogRow {
  id: string;
  timestamp: Date;
  user_email: string | null;
  instance_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  operation: string | null;
  diff_json: unknown;
  ip_address: string | null;
}

export interface CrossInstanceAuditRow extends AuditLogRow {
  instance_label: string | null;
  organization_identifier: string | null;
  organization_name: string | null;
  flags?: AnomalyFlag[];
}

export interface AuditPage<T> {
  rows: T[];
  total: number;
  summary?: AnomalySummary;
}

const ROW_COLUMNS = [
  'audit_logs.id',
  'audit_logs.timestamp',
  'audit_logs.user_email',
  'audit_logs.instance_id',
  'audit_logs.resource_type',
  'audit_logs.resource_id',
  'audit_logs.operation',
  'audit_logs.diff_json',
  'audit_logs.ip_address',
  'instances.label as instance_label',
  'organizations.identifier as organization_identifier',
  'organizations.name as organization_name',
];

type CountRows = Array<{ c: string | number }>;

/** LIKE pattern for a literal substring (escapes \, % and _). */
function likeTerm(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** audit_logs joined with site labels, restricted to the scope and the filters. */
function scopedQuery(scope: AuditScope, f: AuditFilters): Knex.QueryBuilder {
  const q = db('audit_logs')
    .leftJoin('instances', 'audit_logs.instance_id', 'instances.id')
    .leftJoin('organizations', 'organizations.instance_id', 'instances.id');

  if (scope.kind === 'instance') q.where('audit_logs.instance_id', scope.instanceId);
  else {
    if (scope.kind === 'user') q.where('instances.user_id', scope.userId);
    if (f.instanceId) q.where('audit_logs.instance_id', f.instanceId);
  }

  if (f.resource) q.where('audit_logs.resource_type', f.resource);
  if (f.operation) q.where('audit_logs.operation', f.operation);
  if (f.from) q.where('audit_logs.timestamp', '>=', f.from);
  if (f.to) q.where('audit_logs.timestamp', '<=', f.to);
  if (f.actor) q.where('audit_logs.user_email', 'like', likeTerm(f.actor));
  if (f.q) {
    const term = likeTerm(f.q);
    q.where((w) => {
      w.where('audit_logs.user_email', 'like', term)
        .orWhere('audit_logs.resource_id', 'like', term)
        .orWhere('audit_logs.ip_address', 'like', term)
        .orWhere('organizations.name', 'like', term)
        .orWhere('organizations.identifier', 'like', term)
        .orWhere('instances.label', 'like', term)
        .orWhereRaw('CAST(audit_logs.diff_json AS CHAR) LIKE ?', [term]);
    });
  }
  return q;
}

function newestFirst(q: Knex.QueryBuilder): Knex.QueryBuilder {
  return q.select(ROW_COLUMNS).orderBy([
    { column: 'audit_logs.timestamp', order: 'desc' },
    { column: 'audit_logs.id', order: 'desc' },
  ]);
}

function withFlags(rows: CrossInstanceAuditRow[]): {
  flags: Map<string, AnomalyFlag[]>;
  rows: CrossInstanceAuditRow[];
} {
  const flags = computeAnomalyFlags(rows);
  return { flags, rows: rows.map((r) => ({ ...r, flags: flags.get(r.id) ?? [] })) };
}

async function countMatching(scope: AuditScope, f: AuditFilters): Promise<number> {
  const rows = await scopedQuery(scope, f).count<CountRows>('audit_logs.id as c');
  return Number(rows[0]?.c ?? 0);
}

/**
 * Page through the audit log of a scope (newest first) with the given filters.
 * Anomaly flags are evaluated over the newest ANOMALY_SCAN_CAP rows of the
 * filter, so the summary and "flagged only" cover the same window the pages come from.
 * @returns The page rows (with flags), the total for the filter and the severity summary.
 */
export async function queryAudit(
  scope: AuditScope,
  params: AuditQueryParams,
): Promise<AuditPage<CrossInstanceAuditRow>> {
  const offset = (params.page - 1) * params.limit;
  const scanned: CrossInstanceAuditRow[] = await newestFirst(scopedQuery(scope, params)).limit(
    ANOMALY_SCAN_CAP,
  );
  const { flags, rows: scanRows } = withFlags(scanned);
  const summary = summarizeAnomalies(flags, scanRows.length);

  if (params.flaggedOnly) {
    const flagged = scanRows.filter((r) => (r.flags?.length ?? 0) > 0);
    return { rows: flagged.slice(offset, offset + params.limit), total: flagged.length, summary };
  }

  const scanComplete = scanRows.length < ANOMALY_SCAN_CAP;
  if (scanComplete) {
    return { rows: scanRows.slice(offset, offset + params.limit), total: scanRows.length, summary };
  }
  if (offset + params.limit <= scanRows.length) {
    return {
      rows: scanRows.slice(offset, offset + params.limit),
      total: await countMatching(scope, params),
      summary,
    };
  }

  // Page lies beyond the scanned window: fetch it directly; its flags use the page alone.
  const [pageRows, total] = await Promise.all([
    newestFirst(scopedQuery(scope, params)).limit(params.limit).offset(offset) as Promise<
      CrossInstanceAuditRow[]
    >,
    countMatching(scope, params),
  ]);
  return { rows: withFlags(pageRows).rows, total, summary };
}

/**
 * Fetch up to `cap` rows (newest first) with flags for an export.
 * @returns The rows and whether more rows matched than the cap allows.
 */
export async function queryAuditForExport(
  scope: AuditScope,
  filters: AuditFilters,
  cap: number,
): Promise<{ rows: CrossInstanceAuditRow[]; truncated: boolean }> {
  const fetched: CrossInstanceAuditRow[] = await newestFirst(scopedQuery(scope, filters)).limit(
    cap + 1,
  );
  const truncated = fetched.length > cap;
  const { rows } = withFlags(truncated ? fetched.slice(0, cap) : fetched);
  return {
    rows: filters.flaggedOnly ? rows.filter((r) => (r.flags?.length ?? 0) > 0) : rows,
    truncated,
  };
}

/**
 * Page through one instance's audit logs (newest first), optionally filtered.
 * @returns The matching rows and the total count for the same filter.
 */
export function listInstanceAudit(
  instanceId: string,
  params: AuditQueryParams,
): Promise<AuditPage<CrossInstanceAuditRow>> {
  return queryAudit({ kind: 'instance', instanceId }, params);
}

/**
 * Page through audit logs joined with instance/organization labels (newest first).
 * Admins see all rows; non-admins are scoped to instances they own (instances.user_id = userId);
 * an org-scoped session (scopeInstanceId) sees only that one instance.
 * @returns The enriched rows and the total count for the caller's scope.
 */
export function listCrossInstanceAudit(
  userId: string,
  isAdmin: boolean,
  params: AuditQueryParams,
  scopeInstanceId?: string,
): Promise<AuditPage<CrossInstanceAuditRow>> {
  if (scopeInstanceId) return queryAudit({ kind: 'instance', instanceId: scopeInstanceId }, params);
  return queryAudit(isAdmin ? { kind: 'all' } : { kind: 'user', userId }, params);
}

/**
 * Page through every audit log row (newest first), unscoped — for the admin "everything" view.
 * @param params Pagination (page, limit).
 * @returns The rows and the total count across all instances.
 */
export async function listAdminAudit(params: {
  page: number;
  limit: number;
}): Promise<AuditPage<AuditLogRow>> {
  const offset = (params.page - 1) * params.limit;
  const [rows, countRows] = await Promise.all([
    db<AuditLogRow>('audit_logs').orderBy('timestamp', 'desc').limit(params.limit).offset(offset),
    db('audit_logs').count<Array<{ count: string | number }>>('id as count'),
  ]);
  return { rows, total: Number(countRows[0]?.count ?? 0) };
}
