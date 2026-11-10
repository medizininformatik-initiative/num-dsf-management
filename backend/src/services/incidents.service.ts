/**
 * incidents.service.ts – The incident register (migration 035): report,
 * confirm, update, BSI / DPO acknowledgements, comments and closing. The
 * suspension of a site lives in incident-suspension.service.
 *
 * Visibility: admins see everything; other users see incidents that were
 * confirmed at some point and their own reports. The description and the
 * reporter are shown to admins and the reporter only. A single admin acts
 * alone (no four-eyes); the routes require the step-up for sensitive actions.
 * Every change is an incident event (hash chain) and an audit_logs entry;
 * mails never carry the description.
 * Dependencies: db/connection, incident-events.service, incident-recipients.service,
 *               notification.service, audit.service, lib/isAdmin, lib/nis2Deadlines,
 *               lib/logger, uuid
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { appendEvent, type IncidentEvent, type IncidentEventType } from './incident-events.service';
import { adminRecipients, siteRecipients } from './incident-recipients.service';
import { sendIncidentEmail } from './notification.service';
import { writeAuditLog } from './audit.service';
import { isAdminCaller } from '../lib/isAdmin';
import { NIS2_COLUMNS, NIS2_STAGES, nis2DueAt, type Nis2Stage } from '../lib/nis2Deadlines';
import { logger } from '../lib/logger';
import type { IncidentMailEvent } from './mail-templates/incident-mail';

export type IncidentStatus = 'REPORTED' | 'CONFIRMED' | 'CLOSED' | 'FALSE_ALARM';

export interface IncidentRow {
  id: string;
  organization_id: string | null;
  org_name?: string | null;
  org_instance_id?: string | null;
  title: string;
  description: string;
  status: IncidentStatus;
  reported_by: string;
  reported_at: Date;
  detected_at: Date;
  escalation_level: number;
  zulip_url: string | null;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  closed_by: string | null;
  closed_at: Date | null;
  suspended: number | boolean;
  bsi_early_warning_at: Date | null;
  bsi_early_warning_by: string | null;
  bsi_notification_at: Date | null;
  bsi_notification_by: string | null;
  bsi_final_report_at: Date | null;
  bsi_final_report_by: string | null;
  dpo_informed_at: Date | null;
  dpo_informed_by: string | null;
}

/** The signed-in user as the incident register needs it. */
export interface IncidentCaller {
  email: string;
  isAdmin: boolean;
  /** Instances whose organization the caller acts for. */
  instanceIds: string[];
  ip: string;
}

export interface ApiIncident {
  id: string;
  title: string;
  description: string | null;
  status: IncidentStatus;
  escalationLevel: number;
  organization: { identifier: string; name: string } | null;
  reportedBy: string | null;
  reportedAt: Date;
  detectedAt: Date;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  closedBy: string | null;
  closedAt: Date | null;
  suspended: boolean;
  zulipUrl: string | null;
  nis2: Array<{
    stage: Nis2Stage;
    dueAt: Date;
    reportedAt: Date | null;
    reportedBy: string | null;
  }>;
  dpoInformed: { at: Date; by: string } | null;
  canAcknowledge: boolean;
  isMine: boolean;
}

/** Caller from an authenticated request user (org-scoped sessions act for one instance). */
export async function callerOf(
  user: { id: string; email: string; scopeInstanceId?: string },
  ip: string,
): Promise<IncidentCaller> {
  const isAdmin = await isAdminCaller(user);
  const instanceIds = user.scopeInstanceId
    ? [user.scopeInstanceId]
    : await db('instances').where({ user_id: user.id }).pluck('id');
  return { email: user.email.toLowerCase().trim(), isAdmin, instanceIds, ip };
}

function baseQuery() {
  return db('incidents as i')
    .leftJoin('organizations as o', 'o.identifier', 'i.organization_id')
    .select('i.*', 'o.name as org_name', 'o.instance_id as org_instance_id');
}

async function loadRow(id: string): Promise<IncidentRow | undefined> {
  return (await baseQuery().where('i.id', id).first()) as IncidentRow | undefined;
}

const isReporter = (row: IncidentRow, caller: IncidentCaller) =>
  row.reported_by.toLowerCase() === caller.email;

export function canView(row: IncidentRow, caller: IncidentCaller): boolean {
  return caller.isAdmin || isReporter(row, caller) || row.confirmed_at !== null;
}

function canAcknowledge(row: IncidentRow, caller: IncidentCaller): boolean {
  if (caller.isAdmin || isReporter(row, caller)) return true;
  return !!row.org_instance_id && caller.instanceIds.includes(row.org_instance_id);
}

export function toApi(row: IncidentRow, caller: IncidentCaller): ApiIncident {
  const privileged = caller.isAdmin || isReporter(row, caller);
  const detectedAt = new Date(row.detected_at);
  return {
    id: row.id,
    title: row.title,
    description: privileged ? row.description : null,
    status: row.status,
    escalationLevel: Number(row.escalation_level),
    organization: row.organization_id
      ? { identifier: row.organization_id, name: row.org_name ?? row.organization_id }
      : null,
    reportedBy: privileged ? row.reported_by : null,
    reportedAt: row.reported_at,
    detectedAt,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    suspended: Boolean(row.suspended),
    zulipUrl: row.zulip_url,
    nis2: NIS2_STAGES.map((stage) => {
      const cols = NIS2_COLUMNS[stage];
      const record = row as unknown as Record<string, Date | string | null>;
      return {
        stage,
        dueAt: nis2DueAt(stage, detectedAt),
        reportedAt: (record[cols.at] as Date | null) ?? null,
        reportedBy: (record[cols.by] as string | null) ?? null,
      };
    }),
    dpoInformed:
      row.dpo_informed_at && row.dpo_informed_by
        ? { at: row.dpo_informed_at, by: row.dpo_informed_by }
        : null,
    canAcknowledge: canAcknowledge(row, caller),
    isMine: isReporter(row, caller),
  };
}

/** Visible incidents: open ones (REPORTED, CONFIRMED) first, then newest first. */
export async function listIncidents(caller: IncidentCaller): Promise<ApiIncident[]> {
  const query = baseQuery()
    .orderByRaw("CASE WHEN i.status IN ('REPORTED','CONFIRMED') THEN 0 ELSE 1 END")
    .orderBy('i.reported_at', 'desc');
  if (!caller.isAdmin) {
    query.where((q) => q.whereNotNull('i.confirmed_at').orWhere('i.reported_by', caller.email));
  }
  const rows = (await query) as IncidentRow[];
  return rows.map((r) => toApi(r, caller));
}

/** A visible incident's row. @throws INCIDENT_NOT_FOUND */
export async function requireVisible(id: string, caller: IncidentCaller): Promise<IncidentRow> {
  const row = await loadRow(id);
  if (!row || !canView(row, caller)) throw new Error('INCIDENT_NOT_FOUND');
  return row;
}

/** Event as a caller may see it: the reporter of someone else's report stays hidden. */
export function eventForCaller(
  event: IncidentEvent,
  row: IncidentRow,
  caller: IncidentCaller,
): Omit<IncidentEvent, 'actorEmail'> & { actorEmail: string | null } {
  const hideActor = event.type === 'REPORTED' && !caller.isAdmin && !isReporter(row, caller);
  return { ...event, actorEmail: hideActor ? null : event.actorEmail };
}

export async function listOrganizations(): Promise<Array<{ identifier: string; name: string }>> {
  return db('organizations').select('identifier', 'name').orderBy('name');
}

// ---- notifications and audit ---------------------------------------------

function portalLink(id: string, admin: boolean): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  return admin ? `${base}/app/admin/incidents?id=${id}` : `${base}/app/incidents?id=${id}`;
}

function siteLabel(row: IncidentRow): string | null {
  if (!row.organization_id) return null;
  return row.org_name ? `${row.org_name} (${row.organization_id})` : row.organization_id;
}

/**
 * Mail admins and, when `sites` is set, every site. A failing mail never
 * undoes the action; returns how many messages went out.
 */
export async function notifyIncident(
  row: IncidentRow,
  event: IncidentMailEvent,
  actor: string,
  opts: { sites?: boolean; versionNumber?: number | null } = {},
): Promise<number> {
  const context = {
    event,
    title: row.title,
    site: siteLabel(row),
    escalationLevel: Number(row.escalation_level),
    actor,
    versionNumber: opts.versionNumber ?? null,
  };
  let sent = 0;
  try {
    const admins = await adminRecipients();
    sent += await sendIncidentEmail(admins, { ...context, link: portalLink(row.id, true) });
    if (opts.sites) {
      const adminSet = new Set(admins.map((a) => a.toLowerCase()));
      const sites = (await siteRecipients()).filter((e) => !adminSet.has(e));
      sent += await sendIncidentEmail(sites, { ...context, link: portalLink(row.id, false) });
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : 'unknown' },
      '[Incidents] mail failed',
    );
  }
  return sent;
}

export async function auditIncident(
  row: Pick<IncidentRow, 'id' | 'organization_id'> & { org_instance_id?: string | null },
  caller: IncidentCaller,
  operation: 'CREATE' | 'UPDATE',
  diffJson: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userEmail: caller.email,
    instanceId: row.org_instance_id ?? undefined,
    resourceType: 'INCIDENT',
    resourceId: row.id,
    operation,
    diffJson,
    ipAddress: caller.ip,
  });
}

/** Update incident columns and append the event in one transaction. */
async function changeWithEvent(
  id: string,
  update: Record<string, unknown> | null,
  actor: string,
  type: IncidentEventType,
  details: Record<string, unknown> | null,
): Promise<IncidentEvent> {
  return db.transaction(async (trx) => {
    if (update) await trx('incidents').where({ id }).update(update);
    return appendEvent(trx, id, actor, type, details);
  });
}

// ---- actions ---------------------------------------------------------------

export interface ReportInput {
  organizationId?: string | null;
  title: string;
  description: string;
  escalationLevel: 1 | 2 | 3;
  detectedAt?: string;
  dpoInformed?: boolean;
  zulipUrl?: string;
}

/** Report an incident (any signed-in user; also an admin's direct entry). @throws ORGANIZATION_NOT_FOUND */
export async function reportIncident(
  input: ReportInput,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  if (input.organizationId) {
    const org = await db('organizations').where({ identifier: input.organizationId }).first();
    if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
  }
  const id = uuidv4();
  const now = new Date();
  await db.transaction(async (trx) => {
    await trx('incidents').insert({
      id,
      organization_id: input.organizationId ?? null,
      title: input.title,
      description: input.description,
      status: 'REPORTED',
      reported_by: caller.email,
      reported_at: now,
      detected_at: input.detectedAt ? new Date(input.detectedAt) : now,
      escalation_level: input.escalationLevel,
      zulip_url: input.zulipUrl ?? null,
      dpo_informed_at: input.dpoInformed ? now : null,
      dpo_informed_by: input.dpoInformed ? caller.email : null,
    });
    await appendEvent(trx, id, caller.email, 'REPORTED', {
      escalationLevel: input.escalationLevel,
      ...(input.dpoInformed ? { dpoInformed: true } : {}),
    });
  });
  const row = (await loadRow(id))!;
  await auditIncident(row, caller, 'CREATE', {
    action: 'incident_report',
    escalationLevel: input.escalationLevel,
    organization: row.organization_id,
  });
  await notifyIncident(row, 'reported', caller.email);
  return toApi(row, caller);
}

async function requireAdminRow(id: string): Promise<IncidentRow> {
  const row = await loadRow(id);
  if (!row) throw new Error('INCIDENT_NOT_FOUND');
  return row;
}

const isClosed = (row: IncidentRow) => row.status === 'CLOSED' || row.status === 'FALSE_ALARM';

/** REPORTED -> CONFIRMED, visible to all users, mail to all sites. @throws INVALID_STATUS */
export async function confirmIncident(id: string, caller: IncidentCaller): Promise<ApiIncident> {
  const row = await requireAdminRow(id);
  if (row.status !== 'REPORTED') throw new Error('INVALID_STATUS');
  await changeWithEvent(
    id,
    { status: 'CONFIRMED', confirmed_by: caller.email, confirmed_at: new Date() },
    caller.email,
    'CONFIRMED',
    {},
  );
  const updated = (await loadRow(id))!;
  await auditIncident(updated, caller, 'UPDATE', { action: 'incident_confirm' });
  await notifyIncident(updated, 'confirmed', caller.email, { sites: true });
  return toApi(updated, caller);
}

export interface UpdateInput {
  escalationLevel?: 1 | 2 | 3;
  detectedAt?: string;
  zulipUrl?: string | null;
}

/** Admin changes of escalation level, detection time and Zulip link; each change is an event. */
export async function updateIncident(
  id: string,
  input: UpdateInput,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  const row = await requireAdminRow(id);
  if (isClosed(row)) throw new Error('INVALID_STATUS');
  const changes: Array<{ field: string; column: string; from: unknown; to: unknown }> = [];
  if (
    input.escalationLevel !== undefined &&
    input.escalationLevel !== Number(row.escalation_level)
  ) {
    changes.push({
      field: 'escalationLevel',
      column: 'escalation_level',
      from: Number(row.escalation_level),
      to: input.escalationLevel,
    });
  }
  if (input.detectedAt !== undefined) {
    const to = new Date(input.detectedAt);
    if (to.getTime() !== new Date(row.detected_at).getTime()) {
      changes.push({
        field: 'detectedAt',
        column: 'detected_at',
        from: new Date(row.detected_at).toISOString(),
        to: to.toISOString(),
      });
    }
  }
  if (input.zulipUrl !== undefined && input.zulipUrl !== row.zulip_url) {
    changes.push({
      field: 'zulipUrl',
      column: 'zulip_url',
      from: row.zulip_url,
      to: input.zulipUrl,
    });
  }
  if (changes.length > 0) {
    await db.transaction(async (trx) => {
      for (const c of changes) {
        const value = c.column === 'detected_at' ? new Date(String(c.to)) : c.to;
        await trx('incidents')
          .where({ id })
          .update({ [c.column]: value });
        await appendEvent(trx, id, caller.email, 'UPDATED', {
          field: c.field,
          from: c.from,
          to: c.to,
        });
      }
    });
    await auditIncident(row, caller, 'UPDATE', {
      action: 'incident_update',
      changes: changes.map(({ field, from, to }) => ({ field, from, to })),
    });
  }
  return toApi((await loadRow(id))!, caller);
}

/** Tick "reported to BSI" for one NIS2 stage. @throws FORBIDDEN / ALREADY_ACKNOWLEDGED */
export async function acknowledgeNis2(
  id: string,
  stage: Nis2Stage,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  const row = await requireVisible(id, caller);
  if (!canAcknowledge(row, caller)) throw new Error('FORBIDDEN');
  const cols = NIS2_COLUMNS[stage];
  if ((row as unknown as Record<string, unknown>)[cols.at]) throw new Error('ALREADY_ACKNOWLEDGED');
  await changeWithEvent(
    id,
    { [cols.at]: new Date(), [cols.by]: caller.email },
    caller.email,
    'UPDATED',
    { field: 'nis2', stage, from: null, to: 'REPORTED_TO_BSI' },
  );
  await auditIncident(row, caller, 'UPDATE', { action: 'incident_nis2', stage });
  return toApi((await loadRow(id))!, caller);
}

/** Tick "data protection officer informed". @throws FORBIDDEN / ALREADY_ACKNOWLEDGED */
export async function acknowledgeDpo(id: string, caller: IncidentCaller): Promise<ApiIncident> {
  const row = await requireVisible(id, caller);
  if (!canAcknowledge(row, caller)) throw new Error('FORBIDDEN');
  if (row.dpo_informed_at) throw new Error('ALREADY_ACKNOWLEDGED');
  await changeWithEvent(
    id,
    { dpo_informed_at: new Date(), dpo_informed_by: caller.email },
    caller.email,
    'UPDATED',
    { field: 'dpoInformed', from: false, to: true },
  );
  await auditIncident(row, caller, 'UPDATE', { action: 'incident_dpo_informed' });
  return toApi((await loadRow(id))!, caller);
}

export { loadRow as loadIncidentRow, changeWithEvent };
