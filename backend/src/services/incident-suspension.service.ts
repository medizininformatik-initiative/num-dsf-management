/**
 * incident-suspension.service.ts – "Standort sperren": the measures a single
 * admin takes against the affected site of an incident, each recorded as an
 * incident event with its result:
 *   BLOCK_CERTIFICATES  every certificate and login thumbprint of the site,
 *                       including those its latest approved and its pending
 *                       requests list, goes on the permanent block list;
 *   REMOVE_LOGINS       its login certificates are removed and the sessions of
 *                       its organization scope ended (also for an admin owner);
 *                       a non-admin owner loses every session;
 *   WITHDRAW            the site is suspended: published as withdrawn whatever
 *                       its approved snapshot says;
 *   MAIL_SITES          every site and admin is told.
 * A new allow-list version is published once, right away, whenever
 * BLOCK_CERTIFICATES or WITHDRAW ran.
 * Lifting the suspension needs the restart checklist; blocked thumbprints stay
 * blocked, so the site returns only with a new, approved certificate.
 * Dependencies: db/connection, incidents.service, incident-events.service,
 *               incident-blocks.service, org-login-certificates.service,
 *               auth.service, scope-revocation.service, bundle-versions.service, fhir.service,
 *               approved-snapshot.service,
 *               lib/certFingerprint, lib/isAdmin
 */
import type { Knex } from 'knex';
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
import { revokeInstanceSessions } from './scope-revocation.service';
import { createSnapshot } from './bundle-versions.service';
import { loadAllowListInput } from './fhir.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { isAdminEmail } from '../lib/isAdmin';
import { allowListSection, snapshotCertificateIds } from './approved-snapshot.service';
import type { IncidentMeasure } from '../schemas/incident.schema';

export type MeasureResult = { measure: IncidentMeasure } & Record<string, unknown>;

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
    if (section) {
      fps.push(
        ...[...section.member.thumbprints, ...(section.loginThumbprints ?? [])].filter(
          (t) => typeof t === 'string',
        ),
      );
    } else certIds.push(...(snapshotCertificateIds(snapshot) ?? []));
  }
  if (certIds.length > 0) {
    const pems: string[] = await db('certificates').whereIn('id', certIds).pluck('pem');
    fps.push(...pemFingerprints(pems));
  }
  return fps;
}

/**
 * Every thumbprint the site holds now or that its approved or pending data
 * lists. An admin certificate is never blocked by a site incident: it is the
 * admins' own login, which admin certificate management handles.
 */
async function siteFingerprints(row: IncidentRow): Promise<string[]> {
  const identifier = row.organization_id as string;
  const [pems, logins, snapshots, adminFps] = await Promise.all([
    db('certificates').where({ organization_id: identifier }).pluck('pem') as Promise<string[]>,
    db('org_login_certificates').where({ organization_id: identifier }).pluck('fingerprint'),
    snapshotFingerprints(row.org_instance_id),
    db('admin_cert_fingerprints').pluck('fingerprint') as Promise<string[]>,
  ]);
  const admin = new Set(adminFps.map((f) => f.toLowerCase()));
  return [...(logins as string[]), ...pemFingerprints(pems), ...snapshots].filter(
    (f) => !admin.has(f.toLowerCase()),
  );
}

async function record(
  row: IncidentRow,
  caller: IncidentCaller,
  result: MeasureResult,
): Promise<void> {
  await changeWithEvent(row.id, null, caller.email, 'MEASURE', result);
}

/** The incident row, locked for the rest of the transaction. */
async function lockIncident(trx: Knex.Transaction, id: string): Promise<IncidentRow> {
  const row = (await trx('incidents').where({ id }).forUpdate().first()) as IncidentRow | undefined;
  if (!row) throw new Error('INCIDENT_NOT_FOUND');
  return row;
}

/** Block the thumbprints and record the event in one transaction. */
async function blockCertificates(row: IncidentRow, caller: IncidentCaller): Promise<MeasureResult> {
  const fps = await siteFingerprints(row);
  return db.transaction(async (trx) => {
    const blocked = await blockFingerprints(trx, fps, row.id, caller.email);
    const result: MeasureResult = { measure: 'BLOCK_CERTIFICATES', blocked };
    await appendEvent(trx, row.id, caller.email, 'MEASURE', result);
    return result;
  });
}

/**
 * Remove the site's login certificates and end the sessions of its
 * organization scope (certificate logins of the instance), also when an
 * admin owns the instance. A non-admin owner also loses every personal
 * session; an admin's own account is not locked out by a site incident.
 */
async function removeLogins(row: IncidentRow, caller: IncidentCaller): Promise<MeasureResult> {
  const removed = await removeAllForOrganization(
    row.organization_id as string,
    caller.email,
    caller.ip,
  );
  const scopedSessionsRevoked = row.org_instance_id
    ? await revokeInstanceSessions(row.org_instance_id)
    : 0;
  const owner = (await db('instances as i')
    .join('users as u', 'u.id', 'i.user_id')
    .where('i.id', row.org_instance_id ?? '')
    .first('u.id', 'u.email')) as { id: string; email: string } | undefined;
  const sessionsRevoked =
    owner && !(await isAdminEmail(owner.email))
      ? await revokeAllSessions({ id: owner.id }).catch(() => 0)
      : 0;
  const result: MeasureResult = {
    measure: 'REMOVE_LOGINS',
    removedLogins: removed.length,
    scopedSessionsRevoked,
    sessionsRevoked,
  };
  await record(row, caller, result);
  return result;
}

/**
 * Publish a new allow-list version and, for WITHDRAW, set the suspension
 * flag, in one transaction with the event that records it. The version is
 * built with the suspension already applied; when publishing fails the flag
 * stays unset and the admin simply retries. An already suspended site is
 * published again, so a retry after a failed publish also works.
 * @throws INVALID_STATUS when the incident was closed meanwhile
 */
async function publish(
  row: IncidentRow,
  caller: IncidentCaller,
  withdraw: boolean,
): Promise<MeasureResult> {
  const org = row.organization_id as string;
  return db.transaction(async (trx) => {
    const locked = await lockIncident(trx, row.id);
    if (locked.status === 'CLOSED' || locked.status === 'FALSE_ALARM') {
      throw new Error('INVALID_STATUS');
    }
    const alreadySuspended = Boolean(locked.suspended);
    const version = await createSnapshot({
      triggeredBy: 'MANUAL',
      triggeredByEmail: caller.email,
      notes: withdraw ? `Incident: ${org} suspended` : `Incident: certificates of ${org} blocked`,
      input: await loadAllowListInput(withdraw ? { suspend: org } : {}),
    });
    if (!withdraw) {
      // Blocking alone: the blocked thumbprints leave the served bundle now.
      const result: MeasureResult = {
        measure: 'BLOCK_CERTIFICATES',
        versionNumber: version.versionNumber,
      };
      await appendEvent(trx, row.id, caller.email, 'MEASURE', result);
      return result;
    }
    if (!alreadySuspended) await trx('incidents').where({ id: row.id }).update({ suspended: 1 });
    const result: MeasureResult = {
      measure: 'WITHDRAW',
      versionNumber: version.versionNumber,
      ...(alreadySuspended ? { alreadySuspended: true } : {}),
    };
    await appendEvent(trx, row.id, caller.email, 'SUSPENDED', result);
    return result;
  });
}

async function mailSites(row: IncidentRow, caller: IncidentCaller): Promise<MeasureResult> {
  const fresh = (await loadIncidentRow(row.id)) as IncidentRow;
  // Only a withdrawn site is announced as suspended.
  const event = fresh.suspended ? 'suspended' : 'measures';
  const mailed = await notifyIncident(fresh, event, caller.email, { sites: true });
  const result: MeasureResult = { measure: 'MAIL_SITES', mailed };
  await record(row, caller, result);
  return result;
}

/**
 * Suspend the affected site with the chosen measures. `confirm` first
 * confirms a REPORTED incident, so both fit in one dialog. Order: block,
 * remove logins, publish once (whenever blocking or withdrawing ran), mail.
 * WITHDRAW on an already suspended site publishes again.
 * @throws INCIDENT_NOT_FOUND / INVALID_STATUS / NO_ORGANIZATION
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
  if (row.status === 'REPORTED') {
    await confirmIncident(id, caller);
    row = (await loadIncidentRow(id)) as IncidentRow;
  }
  const chosen = new Set(measures);
  const results: MeasureResult[] = [];
  if (chosen.has('BLOCK_CERTIFICATES')) results.push(await blockCertificates(row, caller));
  if (chosen.has('REMOVE_LOGINS')) results.push(await removeLogins(row, caller));
  if (chosen.has('WITHDRAW') || chosen.has('BLOCK_CERTIFICATES')) {
    const published = await publish(row, caller, chosen.has('WITHDRAW'));
    if (chosen.has('WITHDRAW')) results.push(published);
    else results[0] = { ...results[0], versionNumber: published.versionNumber };
  }
  if (chosen.has('MAIL_SITES')) results.push(await mailSites(row, caller));
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
 * End the suspension after the restart checklist. The new version (built
 * without this incident's suspension), the cleared flag and the event are one
 * transaction: when publishing fails the site stays suspended and the admin
 * retries. Blocked thumbprints stay blocked.
 * @throws INCIDENT_NOT_FOUND / NOT_SUSPENDED
 */
export async function liftSuspension(
  id: string,
  checklist: RestartChecklist,
  caller: IncidentCaller,
): Promise<ApiIncident> {
  const row = await loadIncidentRow(id);
  if (!row) throw new Error('INCIDENT_NOT_FOUND');
  const versionNumber = await db.transaction(async (trx) => {
    const locked = await lockIncident(trx, id);
    if (!locked.suspended) throw new Error('NOT_SUSPENDED');
    const version = await createSnapshot({
      triggeredBy: 'MANUAL',
      triggeredByEmail: caller.email,
      notes: `Incident: suspension of ${row.organization_id ?? 'unknown site'} lifted`,
      input: await loadAllowListInput({ excludeIncidentId: id }),
    });
    await trx('incidents').where({ id }).update({ suspended: 0 });
    await appendEvent(trx, id, caller.email, 'SUSPENSION_LIFTED', {
      causeFixed: checklist.causeFixed,
      fixTested: checklist.fixTested,
      releasedByTechBoard: checklist.releasedByTechBoard,
      note: checklist.note,
      versionNumber: version.versionNumber,
    });
    return version.versionNumber;
  });
  await auditIncident(row, caller, 'UPDATE', {
    action: 'incident_lift_suspension',
    versionNumber,
  });
  const updated = (await loadIncidentRow(id)) as IncidentRow;
  await notifyIncident(updated, 'lifted', caller.email, { versionNumber });
  return toApi(updated, caller);
}
