/**
 * incident-suspension.service.ts – "Standort sperren": the measures a single
 * admin takes against the affected site of an incident, each recorded as an
 * incident event with its result:
 *   BLOCK_CERTIFICATES  every certificate and login thumbprint of the site,
 *                       including those its latest approved and its pending
 *                       requests list, goes on the permanent block list;
 *   REMOVE_LOGINS       its login certificates are removed and the sessions of
 *                       its users revoked (skipped for an owner who is an admin);
 *   WITHDRAW            the site is suspended: published as withdrawn whatever
 *                       its approved snapshot says, and a new allow-list
 *                       version is published right away;
 *   MAIL_SITES          every site and admin is told.
 * Lifting the suspension needs the restart checklist; blocked thumbprints stay
 * blocked, so the site returns only with a new, approved certificate.
 * Dependencies: db/connection, incidents.service, incident-events.service,
 *               incident-blocks.service, org-login-certificates.service,
 *               auth.service, bundle-versions.service, approved-snapshot.service,
 *               lib/certFingerprint, lib/isAdmin
 */
import { db } from '../db/connection';
import {
  auditIncident,
  changeWithEvent,
  confirmIncident,
  loadIncidentRow,
  notifyIncident,
  toApi,
  type ApiIncident,
  type IncidentCaller,
  type IncidentRow,
} from './incidents.service';
import { appendEvent } from './incident-events.service';
import { blockFingerprints } from './incident-blocks.service';
import { removeAllForOrganization } from './org-login-certificates.service';
import { revokeAllSessions } from './auth.service';
import { createSnapshot } from './bundle-versions.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { isAdminEmail } from '../lib/isAdmin';
import { allowListSection, snapshotCertificateIds } from './approved-snapshot.service';
import type { IncidentMeasure } from '../schemas/incident.schema';

export type MeasureResult = { measure: IncidentMeasure } & Record<string, unknown>;

/** Measures run in this order: block before publishing, publish before mailing. */
const ORDER: IncidentMeasure[] = ['BLOCK_CERTIFICATES', 'REMOVE_LOGINS', 'WITHDRAW', 'MAIL_SITES'];

/** SHA-512 thumbprints of stored PEMs. */
function pemFingerprints(pems: string[]): string[] {
  const fps: string[] = [];
  for (const pem of pems) {
    try {
      fps.push(sha512FingerprintFromPem(pem));
    } catch {
      // An unreadable stored PEM is never published and cannot log in.
    }
  }
  return fps;
}

function parseSnapshot(raw: unknown): Record<string, unknown> | null {
  try {
    const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Thumbprints of the site's latest APPROVED request and of its PENDING ones:
 * the allow list publishes the approved snapshot, not the live certificate
 * list, so a certificate deleted before the suspension would come back when
 * it is lifted (and a pending request could approve it later). Legacy
 * snapshots only list certificate ids; those still stored are resolved.
 */
async function snapshotFingerprints(instanceId: string | null | undefined): Promise<string[]> {
  if (!instanceId) return [];
  const [approved, pending] = await Promise.all([
    db('approval_requests')
      .where({ instance_id: instanceId, status: 'APPROVED' })
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .first('snapshot_json') as Promise<{ snapshot_json: unknown } | undefined>,
    db('approval_requests')
      .where({ instance_id: instanceId, status: 'PENDING' })
      .select('snapshot_json') as Promise<Array<{ snapshot_json: unknown }>>,
  ]);
  const snapshots = [approved, ...pending]
    .filter((r): r is { snapshot_json: unknown } => r !== undefined)
    .map((r) => parseSnapshot(r.snapshot_json));
  const fps: string[] = [];
  const certIds: string[] = [];
  for (const snapshot of snapshots) {
    const section = allowListSection(snapshot);
    if (section) fps.push(...section.member.thumbprints.filter((t) => typeof t === 'string'));
    else certIds.push(...(snapshotCertificateIds(snapshot) ?? []));
  }
  if (certIds.length > 0) {
    const pems: string[] = await db('certificates').whereIn('id', certIds).pluck('pem');
    fps.push(...pemFingerprints(pems));
  }
  return fps;
}

/** Every thumbprint the site holds now or that its approved or pending data lists. */
async function siteFingerprints(row: IncidentRow): Promise<string[]> {
  const identifier = row.organization_id as string;
  const [pems, logins, snapshots] = await Promise.all([
    db('certificates').where({ organization_id: identifier }).pluck('pem') as Promise<string[]>,
    db('org_login_certificates').where({ organization_id: identifier }).pluck('fingerprint'),
    snapshotFingerprints(row.org_instance_id),
  ]);
  return [...(logins as string[]), ...pemFingerprints(pems), ...snapshots];
}

async function record(
  row: IncidentRow,
  caller: IncidentCaller,
  type: 'MEASURE' | 'SUSPENDED',
  result: MeasureResult,
): Promise<void> {
  await changeWithEvent(row.id, null, caller.email, type, result);
}

async function runMeasure(
  measure: IncidentMeasure,
  row: IncidentRow,
  caller: IncidentCaller,
): Promise<MeasureResult> {
  const org = row.organization_id as string;
  if (measure === 'BLOCK_CERTIFICATES') {
    const fps = await siteFingerprints(row);
    const blocked = await db.transaction((trx) =>
      blockFingerprints(trx, fps, row.id, caller.email),
    );
    return { measure, blocked };
  }
  if (measure === 'REMOVE_LOGINS') {
    const removed = await removeAllForOrganization(org, caller.email, caller.ip);
    const owner = (await db('instances as i')
      .join('users as u', 'u.id', 'i.user_id')
      .where('i.id', row.org_instance_id ?? '')
      .first('u.id', 'u.email')) as { id: string; email: string } | undefined;
    if (!owner) return { measure, removedLogins: removed.length, sessionsRevoked: 0 };
    // An admin's own account is not locked out by a site incident.
    if (await isAdminEmail(owner.email)) {
      return {
        measure,
        removedLogins: removed.length,
        sessionsRevoked: 0,
        sessionsSkipped: 'OWNER_IS_ADMIN',
      };
    }
    const revoked = await revokeAllSessions({ id: owner.id }).catch(() => 0);
    return { measure, removedLogins: removed.length, sessionsRevoked: revoked };
  }
  if (measure === 'WITHDRAW') {
    await db('incidents').where({ id: row.id }).update({ suspended: 1 });
    const version = await createSnapshot({
      triggeredBy: 'MANUAL',
      triggeredByEmail: caller.email,
      notes: `Incident: ${org} suspended`,
    });
    return { measure, versionNumber: version.versionNumber };
  }
  const fresh = (await loadIncidentRow(row.id)) as IncidentRow;
  const mailed = await notifyIncident(fresh, 'suspended', caller.email, { sites: true });
  return { measure, mailed };
}

/**
 * Suspend the affected site with the chosen measures. `confirm` first
 * confirms a REPORTED incident, so both fit in one dialog.
 * @throws INCIDENT_NOT_FOUND / INVALID_STATUS / NO_ORGANIZATION / ALREADY_SUSPENDED
 */
export async function suspendIncident(
  id: string,
  measures: IncidentMeasure[],
  confirm: boolean,
  caller: IncidentCaller,
): Promise<{ incident: ApiIncident; results: MeasureResult[] }> {
  let row = await loadIncidentRow(id);
  if (!row) throw new Error('INCIDENT_NOT_FOUND');
  if (!row.organization_id) throw new Error('NO_ORGANIZATION');
  if (row.status === 'REPORTED' && !confirm) throw new Error('INVALID_STATUS');
  if (row.status === 'CLOSED' || row.status === 'FALSE_ALARM') throw new Error('INVALID_STATUS');
  if (measures.includes('WITHDRAW') && row.suspended) throw new Error('ALREADY_SUSPENDED');
  if (row.status === 'REPORTED') {
    await confirmIncident(id, caller);
    row = (await loadIncidentRow(id)) as IncidentRow;
  }
  const results: MeasureResult[] = [];
  for (const measure of ORDER.filter((m) => measures.includes(m))) {
    const result = await runMeasure(measure, row, caller);
    await record(row, caller, measure === 'WITHDRAW' ? 'SUSPENDED' : 'MEASURE', result);
    results.push(result);
  }
  await auditIncident(row, caller, 'UPDATE', { action: 'incident_suspend', results });
  return { incident: toApi((await loadIncidentRow(id)) as IncidentRow, caller), results };
}

export interface RestartChecklist {
  causeFixed: true;
  fixTested: true;
  releasedByTechBoard: true;
  note: string;
}

/**
 * End the suspension after the restart checklist; publishes a new version.
 * Blocked thumbprints stay blocked.
 * @throws INCIDENT_NOT_FOUND / NOT_SUSPENDED
 */
export async function liftSuspension(
  id: string,
  checklist: RestartChecklist,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  const row = await loadIncidentRow(id);
  if (!row) throw new Error('INCIDENT_NOT_FOUND');
  if (!row.suspended) throw new Error('NOT_SUSPENDED');
  await db('incidents').where({ id }).update({ suspended: 0 });
  const version = await createSnapshot({
    triggeredBy: 'MANUAL',
    triggeredByEmail: caller.email,
    notes: `Incident: suspension of ${row.organization_id ?? 'unknown site'} lifted`,
  });
  await db.transaction((trx) =>
    appendEvent(trx, id, caller.email, 'SUSPENSION_LIFTED', {
      causeFixed: checklist.causeFixed,
      fixTested: checklist.fixTested,
      releasedByTechBoard: checklist.releasedByTechBoard,
      note: checklist.note,
      versionNumber: version.versionNumber,
    }),
  );
  await auditIncident(row, caller, 'UPDATE', {
    action: 'incident_lift_suspension',
    versionNumber: version.versionNumber,
  });
  const updated = (await loadIncidentRow(id)) as IncidentRow;
  await notifyIncident(updated, 'lifted', caller.email, { versionNumber: version.versionNumber });
  return toApi(updated, caller);
}
