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

export { loadRow as loadIncidentRow };
