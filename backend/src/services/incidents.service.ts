/**
 * incidents.service.ts – The incident register (migration 035): report,
 * confirm, update, BSI / DPO acknowledgements, comments and closing. The
 * suspension of a site lives in incident-suspension.service.
 *
 * Visibility: admins see everything; other users see incidents that were
 * confirmed at some point and their own reports (same e-mail and same
 * session scope, see isReporter). The description and the
 * reporter are shown to admins and the reporter only. A single admin acts
 * alone (no four-eyes); the routes require the step-up for sensitive actions.
 * Every change is an incident event (hash chain) and an audit_logs entry;
 * mails never carry the description.
 * Dependencies: db/connection, incident-events.service, incident-recipients.service,
 *               notification.service, audit.service, lib/isAdmin, lib/nis2Deadlines,
 *               approved-snapshot.service, lib/incidentHashChain, lib/logger, uuid
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import {
  appendEvent,
  chainHead,
  type IncidentEvent,
  type IncidentEventType,
} from './incident-events.service';
import { fieldHashes, type HashedFields } from '../lib/incidentHashChain';
import { adminRecipients, siteRecipients } from './incident-recipients.service';
import { sendIncidentEmail } from './notification.service';
import { writeAuditLog } from './audit.service';
import { isAdminCaller } from '../lib/isAdmin';
import { approvedActive, loadLatestApprovedSites } from './approved-snapshot.service';
import { NIS2_COLUMNS, type Nis2Stage } from '../lib/nis2Deadlines';
import {
  buildNis2Entries,
  FIELD_STAGE,
  nis2ScheduleOf,
  stageFields,
  stageHashValue,
  type Nis2Entry,
} from '../lib/nis2Entries';
import { Nis2FieldsIncompleteError } from '../lib/incidentErrors';
import { missingNis2Fields } from '../schemas/nis2Report.schema';
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
  reported_by_instance_id?: string | null;
  /** Organization of reported_by_instance_id (joined). */
  reporter_org?: string | null;
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
  bsi_interim_requested_at: Date | null;
  bsi_interim_requested_by: string | null;
  bsi_interim_at: Date | null;
  bsi_interim_by: string | null;
  bsi_progress_at: Date | null;
  bsi_progress_by: string | null;
  /** Structured report fields per NIS2 stage (JSON; parsed or text, see lib/nis2Entries). */
  nis2_data: unknown;
  archived_at?: Date | null;
  archived_by?: string | null;
}

/** The signed-in user as the incident register needs it. */
export interface IncidentCaller {
  email: string;
  isAdmin: boolean;
  /** Instances whose organization the caller acts for. */
  instanceIds: string[];
  ip: string;
  /** Instance of an organization certificate session; null for a personal login. */
  scopeInstanceId: string | null;
}

export interface ApiIncident {
  id: string;
  title: string;
  description: string | null;
  status: IncidentStatus;
  escalationLevel: number;
  organization: { identifier: string; name: string } | null;
  reportedBy: string | null;
  /** Set when the report came through this organization's certificate session. */
  reportedByOrganization: string | null;
  reportedAt: Date;
  detectedAt: Date;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  closedBy: string | null;
  closedAt: Date | null;
  suspended: boolean;
  zulipUrl: string | null;
  nis2: Nis2Entry[];
  dpoInformed: { at: Date; by: string | null } | null;
  canAcknowledge: boolean;
  isMine: boolean;
  /** Set once an admin archived the incident (admins only see it with includeArchived). */
  archivedAt: Date | null;
  archivedBy: string | null;
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
  return {
    email: user.email.toLowerCase().trim(),
    isAdmin,
    instanceIds,
    ip,
    scopeInstanceId: user.scopeInstanceId ?? null,
  };
}

function baseQuery() {
  return db('incidents as i')
    .leftJoin('organizations as o', 'o.identifier', 'i.organization_id')
    .leftJoin('organizations as ro', 'ro.instance_id', 'i.reported_by_instance_id')
    .select(
      'i.*',
      'o.name as org_name',
      'o.instance_id as org_instance_id',
      'ro.identifier as reporter_org',
    );
}

async function loadRow(id: string): Promise<IncidentRow | undefined> {
  return (await baseQuery().where('i.id', id).first()) as IncidentRow | undefined;
}

/**
 * The reporter is the e-mail AND the session scope: an organization
 * certificate session carries the instance owner's e-mail, so without the
 * scope it would inherit the owner's own reports (and the other way round).
 */
const isReporter = (row: IncidentRow, caller: IncidentCaller) =>
  row.reported_by.toLowerCase() === caller.email &&
  (row.reported_by_instance_id ?? null) === caller.scopeInstanceId;

export function canView(row: IncidentRow, caller: IncidentCaller): boolean {
  return caller.isAdmin || isReporter(row, caller) || row.confirmed_at !== null;
}

export function canAcknowledge(row: IncidentRow, caller: IncidentCaller): boolean {
  if (caller.isAdmin || isReporter(row, caller)) return true;
  return !!row.org_instance_id && caller.instanceIds.includes(row.org_instance_id);
}

/**
 * For callers who may not know the reporter: an actor e-mail that is the
 * reporter's becomes null (ticks, confirmations and events would otherwise
 * name the reporter of an incident whose reporter is hidden).
 */
function actorFor(row: IncidentRow, caller: IncidentCaller) {
  const privileged = caller.isAdmin || isReporter(row, caller);
  const reporter = row.reported_by.toLowerCase();
  return (email: string | null): string | null =>
    !privileged && email && email.toLowerCase() === reporter ? null : email;
}

export function toApi(row: IncidentRow, caller: IncidentCaller): ApiIncident {
  const privileged = caller.isAdmin || isReporter(row, caller);
  const actor = actorFor(row, caller);
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
    reportedByOrganization: privileged ? (row.reporter_org ?? null) : null,
    reportedAt: row.reported_at,
    detectedAt,
    confirmedBy: actor(row.confirmed_by),
    confirmedAt: row.confirmed_at,
    closedBy: actor(row.closed_by),
    closedAt: row.closed_at,
    suspended: Boolean(row.suspended),
    zulipUrl: row.zulip_url,
    nis2: buildNis2Entries(row as IncidentRow & Record<string, unknown>, {
      now: new Date(),
      canSeeFields: canAcknowledge(row, caller),
      actor,
    }),
    dpoInformed:
      row.dpo_informed_at && row.dpo_informed_by
        ? { at: row.dpo_informed_at, by: actor(row.dpo_informed_by) }
        : null,
    canAcknowledge: canAcknowledge(row, caller),
    isMine: isReporter(row, caller),
    archivedAt: row.archived_at ?? null,
    archivedBy: caller.isAdmin ? (row.archived_by ?? null) : null,
  };
}

/**
 * Visible incidents: open ones (REPORTED, CONFIRMED) first, then newest first.
 * Archived incidents are left out; only an admin can ask for them.
 */
export async function listIncidents(
  caller: IncidentCaller,
  opts: { includeArchived?: boolean } = {},
): Promise<ApiIncident[]> {
  const query = baseQuery()
    .orderByRaw("CASE WHEN i.status IN ('REPORTED','CONFIRMED') THEN 0 ELSE 1 END")
    .orderBy('i.reported_at', 'desc');
  if (!(caller.isAdmin && opts.includeArchived)) query.whereNull('i.archived_at');
  if (!caller.isAdmin) {
    query.where((q) =>
      q.whereNotNull('i.confirmed_at').orWhere((own) => {
        own.where('i.reported_by', caller.email);
        if (caller.scopeInstanceId) own.where('i.reported_by_instance_id', caller.scopeInstanceId);
        else own.whereNull('i.reported_by_instance_id');
      }),
    );
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
  const privileged = caller.isAdmin || isReporter(row, caller);
  const hideActor = event.type === 'REPORTED' && !privileged;
  // The field hashes cover the description, which only privileged callers see.
  let details = event.details;
  if (!privileged && details && 'fieldSha256' in details) {
    const { fieldSha256: _hidden, ...rest } = details;
    details = rest;
  }
  return {
    ...event,
    details,
    actorEmail: hideActor ? null : actorFor(row, caller)(event.actorEmail),
  };
}

/**
 * Sites offered in the report form: admins get every organization, other
 * users the approved, active sites of the network plus their own (a site not
 * yet approved is not shown to others).
 */
export async function listOrganizations(
  caller: IncidentCaller,
): Promise<Array<{ identifier: string; name: string }>> {
  const query = db('organizations').select('identifier', 'name').orderBy('name');
  if (!caller.isAdmin) {
    const approved = (await loadLatestApprovedSites())
      .filter(approvedActive)
      .map((s) => s.orgIdentifier);
    query.where((q) => {
      q.whereIn('identifier', approved);
      if (caller.instanceIds.length) q.orWhereIn('instance_id', caller.instanceIds);
    });
  }
  return query;
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

/**
 * Audit entry of an incident action. Never bound to the affected site's
 * instance: the site's own audit views (instance, own instances, export)
 * would otherwise show unconfirmed reports and who made them. The affected
 * organization goes into diff_json instead; admins see the entries in the
 * global audit log.
 */
export async function auditIncident(
  row: Pick<IncidentRow, 'id' | 'organization_id'>,
  caller: IncidentCaller,
  operation: 'CREATE' | 'UPDATE',
  diffJson: Record<string, unknown>,
): Promise<void> {
  // The chain head (seq + hash) anchors the timeline in the append-only audit
  // log: rewriting the events afterwards no longer matches the anchor.
  const head = await chainHead(row.id);
  await writeAuditLog({
    userEmail: caller.email,
    resourceType: 'INCIDENT',
    resourceId: row.id,
    operation,
    diffJson: { organization: row.organization_id, ...diffJson, chainHead: head },
    ipAddress: caller.ip,
  });
}

/** The incident fields the chain covers, as recorded by reportIncident / updateIncident. */
export function hashedFieldsOf(row: IncidentRow): HashedFields {
  return {
    title: row.title,
    description: row.description,
    organizationId: row.organization_id,
    detectedAt: new Date(row.detected_at).toISOString(),
    nis2EarlyWarning: stageHashValue(row.nis2_data, 'EARLY_WARNING'),
    nis2Notification: stageHashValue(row.nis2_data, 'NOTIFICATION'),
    nis2FinalReport: stageHashValue(row.nis2_data, 'FINAL_REPORT'),
  };
}

/**
 * Update incident columns and append the event in one transaction. `check`
 * runs on the row locked FOR UPDATE, so a status test cannot race a
 * concurrent change (two confirms, two ticks of one stage, ...).
 */
async function changeWithEvent(
  id: string,
  update: Record<string, unknown> | null,
  actor: string,
  type: IncidentEventType,
  details: Record<string, unknown> | null,
  check?: (locked: IncidentRow) => void,
): Promise<IncidentEvent> {
  return db.transaction(async (trx) => {
    if (check) {
      const locked = (await trx('incidents').where({ id }).forUpdate().first()) as
        | IncidentRow
        | undefined;
      if (!locked) throw new Error('INCIDENT_NOT_FOUND');
      check(locked);
    }
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
  const detectedAt = input.detectedAt ? new Date(input.detectedAt) : now;
  await db.transaction(async (trx) => {
    await trx('incidents').insert({
      id,
      organization_id: input.organizationId ?? null,
      title: input.title,
      description: input.description,
      status: 'REPORTED',
      reported_by: caller.email,
      reported_by_instance_id: caller.scopeInstanceId,
      reported_at: now,
      detected_at: detectedAt,
      escalation_level: input.escalationLevel,
      zulip_url: input.zulipUrl ?? null,
      dpo_informed_at: input.dpoInformed ? now : null,
      dpo_informed_by: input.dpoInformed ? caller.email : null,
    });
    await appendEvent(trx, id, caller.email, 'REPORTED', {
      escalationLevel: input.escalationLevel,
      ...(input.dpoInformed ? { dpoInformed: true } : {}),
      fieldSha256: fieldHashes({
        title: input.title,
        description: input.description,
        organizationId: input.organizationId ?? null,
        detectedAt: detectedAt.toISOString(),
      }),
    });
  });
  const row = (await loadRow(id))!;
  await auditIncident(row, caller, 'CREATE', {
    action: 'incident_report',
    escalationLevel: input.escalationLevel,
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
    (locked) => {
      if (locked.status !== 'REPORTED') throw new Error('INVALID_STATUS');
    },
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
      const locked = (await trx('incidents').where({ id }).forUpdate().first()) as IncidentRow;
      if (isClosed(locked)) throw new Error('INVALID_STATUS');
      for (const c of changes) {
        const value = c.column === 'detected_at' ? new Date(String(c.to)) : c.to;
        await trx('incidents')
          .where({ id })
          .update({ [c.column]: value });
        await appendEvent(trx, id, caller.email, 'UPDATED', {
          field: c.field,
          from: c.from,
          to: c.to,
          ...(c.field === 'detectedAt'
            ? { fieldSha256: fieldHashes({ detectedAt: String(c.to) }) }
            : {}),
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

/**
 * A closed incident still takes its final report (it is due one month after
 * the closure); a false alarm has nothing to report.
 */
export function assertNis2Editable(row: IncidentRow): void {
  if (row.status === 'FALSE_ALARM') throw new Error('INVALID_STATUS');
}

/** Tick "reported to BSI" for one NIS2 stage. @throws FORBIDDEN / ALREADY_ACKNOWLEDGED / INVALID_STATUS (false alarm) / INTERIM_NOT_REQUESTED / STAGE_NOT_DUE */
export async function acknowledgeNis2(
  id: string,
  stage: Nis2Stage,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  const row = await requireVisible(id, caller);
  if (!canAcknowledge(row, caller)) throw new Error('FORBIDDEN');
  const cols = NIS2_COLUMNS[stage];
  const check = (locked: IncidentRow) => {
    assertNis2Editable(locked);
    if ((locked as unknown as Record<string, unknown>)[cols.at]) {
      throw new Error('ALREADY_ACKNOWLEDGED');
    }
    if (stage === 'INTERIM_REPORT' && !locked.bsi_interim_requested_at) {
      throw new Error('INTERIM_NOT_REQUESTED');
    }
    if (stage === 'PROGRESS_REPORT' && !nis2ScheduleOf(locked, new Date()).progressVisible) {
      throw new Error('STAGE_NOT_DUE');
    }
    const fieldStage = FIELD_STAGE[stage];
    if (fieldStage) {
      const missing = missingNis2Fields(fieldStage, stageFields(locked.nis2_data, fieldStage));
      if (missing.length > 0) throw new Nis2FieldsIncompleteError(missing);
    }
  };
  check(row);
  await changeWithEvent(
    id,
    { [cols.at]: new Date(), [cols.by]: caller.email },
    caller.email,
    'UPDATED',
    { field: 'nis2', stage, from: null, to: 'REPORTED_TO_BSI' },
    check,
  );
  await auditIncident(row, caller, 'UPDATE', { action: 'incident_nis2', stage });
  return toApi((await loadRow(id))!, caller);
}

/** Tick "data protection officer informed". @throws FORBIDDEN / ALREADY_ACKNOWLEDGED / INVALID_STATUS (closed) */
export async function acknowledgeDpo(id: string, caller: IncidentCaller): Promise<ApiIncident> {
  const row = await requireVisible(id, caller);
  if (!canAcknowledge(row, caller)) throw new Error('FORBIDDEN');
  const check = (locked: IncidentRow) => {
    if (isClosed(locked)) throw new Error('INVALID_STATUS');
    if (locked.dpo_informed_at) throw new Error('ALREADY_ACKNOWLEDGED');
  };
  check(row);
  await changeWithEvent(
    id,
    { dpo_informed_at: new Date(), dpo_informed_by: caller.email },
    caller.email,
    'UPDATED',
    { field: 'dpoInformed', from: false, to: true },
    check,
  );
  await auditIncident(row, caller, 'UPDATE', { action: 'incident_dpo_informed' });
  return toApi((await loadRow(id))!, caller);
}

/** Free-text admin entry, e.g. a measure taken outside the portal. Allowed in every status. */
export async function commentIncident(
  id: string,
  text: string,
  caller: IncidentCaller,
): Promise<IncidentEvent> {
  const row = await requireAdminRow(id);
  const event = await changeWithEvent(id, null, caller.email, 'COMMENT', { text });
  await auditIncident(row, caller, 'UPDATE', { action: 'incident_comment', seq: event.seq });
  return event;
}

/**
 * CLOSED (with the post-incident review and derived measures) or FALSE_ALARM
 * (with the reason). Lift a suspension first. Never deleted.
 * @throws INVALID_STATUS / STILL_SUSPENDED
 */
export async function closeIncident(
  id: string,
  outcome: 'CLOSED' | 'FALSE_ALARM',
  note: string,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  const row = await requireAdminRow(id);
  const check = (locked: IncidentRow) => {
    if (isClosed(locked)) throw new Error('INVALID_STATUS');
    if (locked.suspended) throw new Error('STILL_SUSPENDED');
  };
  check(row);
  await changeWithEvent(
    id,
    { status: outcome, closed_by: caller.email, closed_at: new Date() },
    caller.email,
    outcome,
    outcome === 'CLOSED' ? { reviewNote: note } : { reason: note },
    check,
  );
  const updated = (await loadRow(id))!;
  await auditIncident(updated, caller, 'UPDATE', { action: 'incident_close', outcome });
  await notifyIncident(updated, 'closed', caller.email);
  return toApi(updated, caller);
}

/**
 * Archive (soft delete) a finished incident: only FALSE_ALARM or CLOSED, and
 * only once it no longer suspends a site. The row, its timeline and the
 * blocked thumbprints stay; the incident just leaves the default lists.
 * @throws NOT_ARCHIVABLE / ALREADY_ARCHIVED
 */
export async function archiveIncident(id: string, caller: IncidentCaller): Promise<ApiIncident> {
  const row = await requireAdminRow(id);
  const check = (locked: IncidentRow) => {
    if (locked.archived_at) throw new Error('ALREADY_ARCHIVED');
    if (!isClosed(locked) || locked.suspended) throw new Error('NOT_ARCHIVABLE');
  };
  check(row);
  await changeWithEvent(
    id,
    { archived_at: new Date(), archived_by: caller.email },
    caller.email,
    'ARCHIVED',
    { status: row.status },
    check,
  );
  const updated = (await loadRow(id))!;
  await auditIncident(updated, caller, 'UPDATE', {
    action: 'incident_archive',
    status: row.status,
  });
  return toApi(updated, caller);
}

export { loadRow as loadIncidentRow, changeWithEvent };
