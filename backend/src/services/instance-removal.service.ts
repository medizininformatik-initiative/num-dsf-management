/**
 * instance-removal.service.ts – Remove a whole site (instance) with two admins
 * (table instance_removal_requests, migration 039).
 *
 * Admin A requests the removal with a reason. Admin B, whose e-mail domain
 * differs from A's (lib/approvalState.siteOfEmail, same rule as the approval
 * of a request), confirms; A may cancel while it is PENDING, and nobody can
 * confirm their own request. The first decision wins (conditional UPDATE).
 *
 * Executing a removal (soft: no row is deleted):
 *  - instances.removed_at is set; the site is then withdrawn from the allow
 *    list (approved-snapshot.service/fhir.service treat it as a withdrawn
 *    organization, so the next version carries conditional DELETEs for its
 *    Organization, Endpoints and affiliations) and cannot log in or be selected;
 *  - its pending approval requests are withdrawn, so none can resurrect it;
 *  - its login certificates are removed and the sessions of its organization
 *    scope are ended;
 *  - a new allow-list version (MANUAL) is published right away. When that fails
 *    the removal still stands and the response says so; an admin then creates
 *    the version by hand.
 * Dependencies: db/connection, audit.service, org-login-certificates.service,
 *               scope-revocation.service, bundle-versions.service, lib/approvalState
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { siteOfEmail } from '../lib/approvalState';
import { logger } from '../lib/logger';
import { writeAuditLog } from './audit.service';
import { removeAllForOrganization } from './org-login-certificates.service';
import { revokeInstanceSessions } from './scope-revocation.service';
import { createSnapshot } from './bundle-versions.service';

export type RemovalStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export class InstanceRemovalError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface InstanceRemoval {
  id: string;
  instanceId: string;
  organizationId: string | null;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  status: RemovalStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  versionNumber: number | null;
}

interface Row {
  id: string;
  instance_id: string;
  organization_id: string | null;
  reason: string;
  requested_by: string;
  requested_at: Date;
  status: RemovalStatus;
  decided_by: string | null;
  decided_at: Date | null;
  version_number: number | null;
}

const RECENT_DAYS = 30;
const lower = (e: string): string => e.toLowerCase().trim();

function toApi(r: Row): InstanceRemoval {
  return {
    id: r.id,
    instanceId: r.instance_id,
    organizationId: r.organization_id,
    reason: r.reason,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    versionNumber: r.version_number,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

function audit(
  actor: string,
  operation: 'CREATE' | 'UPDATE' | 'DELETE',
  row: Pick<Row, 'id' | 'instance_id' | 'organization_id'>,
  action: 'instance_removal_request' | 'instance_removal_confirm' | 'instance_removal_cancel',
  ip: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  return writeAuditLog({
    userEmail: actor,
    instanceId: row.instance_id,
    resourceType: 'AUTH',
    resourceId: row.id,
    operation,
    diffJson: { action, organization: row.organization_id, ...extra },
    ipAddress: ip,
  });
}

/**
 * Open a removal request for an instance.
 * @throws InstanceRemovalError INSTANCE_NOT_FOUND / ALREADY_REMOVED / REASON_REQUIRED /
 *   REQUEST_ALREADY_PENDING
 */
export async function requestRemoval(
  instanceId: string,
  reason: string,
  requestedBy: string,
  ip: string,
): Promise<InstanceRemoval> {
  const clean = (reason || '').trim().slice(0, 2000);
  if (!clean) throw new InstanceRemovalError('REASON_REQUIRED');
  const instance = await db('instances').where({ id: instanceId }).first('id', 'removed_at');
  if (!instance) throw new InstanceRemovalError('INSTANCE_NOT_FOUND');
  if (instance.removed_at) throw new InstanceRemovalError('ALREADY_REMOVED');
  const org = await db('organizations').where({ instance_id: instanceId }).first('identifier');
  const id = uuidv4();
  try {
    await db('instance_removal_requests').insert({
      id,
      instance_id: instanceId,
      organization_id: org?.identifier ?? null,
      reason: clean,
      requested_by: lower(requestedBy),
      requested_at: new Date(),
      status: 'PENDING',
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new InstanceRemovalError('REQUEST_ALREADY_PENDING');
    throw err;
  }
  const row: Row = await db('instance_removal_requests').where({ id }).first();
  await audit(lower(requestedBy), 'CREATE', row, 'instance_removal_request', ip, {
    reason: clean,
  });
  return toApi(row);
}

/** Every pending request plus the ones decided in the last 30 days, newest first. */
export async function listRemovals(now: Date = new Date()): Promise<InstanceRemoval[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const rows: Row[] = await db('instance_removal_requests')
    .where('status', 'PENDING')
    .orWhere('requested_at', '>=', since)
    .orderBy('requested_at', 'desc');
  return rows.map(toApi);
}

async function requirePending(id: string): Promise<Row> {
  const row: Row | undefined = await db('instance_removal_requests').where({ id }).first();
  if (!row) throw new InstanceRemovalError('NOT_FOUND');
  if (row.status !== 'PENDING') throw new InstanceRemovalError('NOT_PENDING');
  return row;
}

/**
 * The requester withdraws a pending request.
 * @throws InstanceRemovalError NOT_FOUND / NOT_PENDING / NOT_REQUESTER
 */
export async function cancelRemoval(id: string, requester: string, ip: string): Promise<void> {
  const row = await requirePending(id);
  if (lower(requester) !== lower(row.requested_by)) {
    throw new InstanceRemovalError('NOT_REQUESTER');
  }
  const won = await db('instance_removal_requests')
    .where({ id, status: 'PENDING' })
    .update({ status: 'CANCELLED', decided_by: lower(requester), decided_at: new Date() });
  if (!won) throw new InstanceRemovalError('NOT_PENDING');
  await audit(lower(requester), 'DELETE', row, 'instance_removal_cancel', ip);
}

export interface RemovalResult {
  removal: InstanceRemoval;
  /** New allow-list version; null when publishing failed (create one by hand). */
  versionNumber: number | null;
  published: boolean;
}

/**
 * Second admin confirms: the removal is executed.
 * @throws InstanceRemovalError NOT_FOUND / NOT_PENDING / SELF_CONFIRM / SAME_SITE
 */
export async function confirmRemoval(
  id: string,
  confirmer: string,
  ip: string,
): Promise<RemovalResult> {
  const by = lower(confirmer);
  const row = await requirePending(id);
  if (by === lower(row.requested_by)) throw new InstanceRemovalError('SELF_CONFIRM');
  const requesterSite = siteOfEmail(lower(row.requested_by));
  const confirmerSite = siteOfEmail(by);
  if (!requesterSite || !confirmerSite || requesterSite === confirmerSite) {
    throw new InstanceRemovalError('SAME_SITE');
  }

  const now = new Date();
  await db.transaction(async (trx) => {
    // Lock the instance row first: a submit (which locks it too) either finished before, so its
    // request is withdrawn below, or waits and then sees the removal.
    await trx('instances').where({ id: row.instance_id }).forUpdate().first('id');
    // First decision wins: only a still-PENDING row can be flipped.
    const won = await trx('instance_removal_requests')
      .where({ id, status: 'PENDING' })
      .update({ status: 'CONFIRMED', decided_by: by, decided_at: now });
    if (!won) throw new InstanceRemovalError('NOT_PENDING');
    await trx('instances')
      .where({ id: row.instance_id })
      .whereNull('removed_at')
      .update({ removed_at: now, removed_by: by });
    // A pending request of a removed site must never be approved afterwards.
    await trx('approval_requests')
      .where({ instance_id: row.instance_id, status: 'PENDING' })
      .update({ status: 'WITHDRAWN', resolved_at: now, resolved_by: by });
  });

  let removedLogins = 0;
  let sessionsRevoked = 0;
  try {
    if (row.organization_id) {
      removedLogins = (await removeAllForOrganization(row.organization_id, by, ip)).length;
    }
    sessionsRevoked = await revokeInstanceSessions(row.instance_id);
  } catch (err) {
    // resolveOrgLogin and requireAuth refuse the site anyway (removed_at); keep going.
    logger.error({ err, instanceId: row.instance_id }, '[InstanceRemoval] revoking logins failed');
  }

  let versionNumber: number | null = null;
  try {
    const version = await createSnapshot({
      triggeredBy: 'MANUAL',
      triggeredByEmail: by,
      notes: `Site removed: ${row.organization_id ?? row.instance_id}`,
    });
    versionNumber = version.versionNumber;
    await db('instance_removal_requests').where({ id }).update({ version_number: versionNumber });
  } catch (err) {
    logger.error({ err, instanceId: row.instance_id }, '[InstanceRemoval] publishing failed');
  }

  const done: Row = await db('instance_removal_requests').where({ id }).first();
  await audit(by, 'UPDATE', done, 'instance_removal_confirm', ip, {
    requestedBy: row.requested_by,
    reason: row.reason,
    removedLogins,
    sessionsRevoked,
    versionNumber,
  });
  return { removal: toApi(done), versionNumber, published: versionNumber !== null };
}
