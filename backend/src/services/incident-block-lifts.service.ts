/**
 * incident-block-lifts.service.ts – Lift the certificate blocks of an incident that turned out to
 * be a false alarm, with two admins (tables certificate_block_lift_requests and
 * certificate_block_lifts, migration 041).
 *
 * Admin A requests the lift with a reason (only for a FALSE_ALARM incident that does not suspend
 * its site). Admin B, whose e-mail domain differs from A's (lib/approvalState.siteOfEmail, the
 * four-eyes rule of the approval), confirms; A may cancel while it is PENDING and nobody can
 * confirm their own request. The first decision wins (conditional UPDATE).
 *
 * Confirming appends one record per still-blocked thumbprint to the append-only
 * certificate_block_lifts (the block rows themselves stay): incident-blocks.service treats a block
 * as effective only while no lift exists for its (fingerprint, incident), so the allow list, the
 * login, the login sync and the upload guards all follow. Afterwards the site's APPROVAL login
 * entries are restored from its approved request (unless the instance was removed or another
 * incident still suspends the organization) and a new allow-list version is published; when that
 * fails the lift still stands and the result says so. Both steps append incident events
 * (BLOCK_LIFT_REQUESTED, BLOCKS_LIFTED) and are audited.
 * Dependencies: db/connection, incidents.service, incident-events.service,
 *               incident-blocks.service, bundle-versions.service,
 *               login-certificate-sync.service, lib/approvalState, lib/logger
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { siteOfEmail } from '../lib/approvalState';
import { logger } from '../lib/logger';
import {
  auditIncident,
  loadIncidentRow,
  type IncidentCaller,
  type IncidentRow,
} from './incidents.service';
import { appendEvent } from './incident-events.service';
import { suspendedOrganizations } from './incident-blocks.service';
import { createSnapshot } from './bundle-versions.service';
import { syncLoginCertificatesAfterApproval } from './login-certificate-sync.service';

export type LiftStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface BlockLiftRequest {
  id: string;
  incidentId: string;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  status: LiftStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
}

export interface BlockedThumbprint {
  fingerprint: string;
  blockedAt: Date;
  blockedBy: string;
  lifted: boolean;
  liftedAt: Date | null;
  liftedBy: string | null;
}

interface RequestRow {
  id: string;
  incident_id: string;
  reason: string;
  requested_by: string;
  requested_at: Date;
  status: LiftStatus;
  decided_by: string | null;
  decided_at: Date | null;
}

const lower = (e: string): string => e.toLowerCase().trim();

function toApi(r: RequestRow): BlockLiftRequest {
  return {
    id: r.id,
    incidentId: r.incident_id,
    reason: r.reason,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

/** Blocked thumbprints of the incident with their lifted state, and the pending request. */
export async function listBlocks(
  incidentId: string,
): Promise<{ blocks: BlockedThumbprint[]; request: BlockLiftRequest | null }> {
  const rows: Array<{
    fingerprint: string;
    created_at: Date;
    created_by: string;
    confirmed_at: Date | null;
    confirmed_by: string | null;
  }> = await db('blocked_certificate_thumbprints as b')
    .leftJoin('certificate_block_lifts as l', function join() {
      this.on('l.fingerprint', 'b.fingerprint').andOn('l.incident_id', 'b.incident_id');
    })
    .where('b.incident_id', incidentId)
    .orderBy('b.created_at', 'asc')
    .orderBy('b.fingerprint', 'asc')
    .select('b.fingerprint', 'b.created_at', 'b.created_by', 'l.confirmed_at', 'l.confirmed_by');
  const pending: RequestRow | undefined = await db('certificate_block_lift_requests')
    .where({ incident_id: incidentId, status: 'PENDING' })
    .first();
  return {
    blocks: rows.map((r) => ({
      fingerprint: r.fingerprint,
      blockedAt: r.created_at,
      blockedBy: r.created_by,
      lifted: r.confirmed_at !== null,
      liftedAt: r.confirmed_at,
      liftedBy: r.confirmed_by,
    })),
    request: pending ? toApi(pending) : null,
  };
}

/** Thumbprints of the incident that are still blocked (no lift record yet). */
async function unliftedBlocks(incidentId: string): Promise<string[]> {
  return db('blocked_certificate_thumbprints as b')
    .where('b.incident_id', incidentId)
    .whereNotExists(
      db('certificate_block_lifts as l')
        .whereRaw('l.fingerprint = b.fingerprint')
        .whereRaw('l.incident_id = b.incident_id'),
    )
    .pluck('b.fingerprint');
}

/** The incident, which must be a false alarm that does not suspend its site. */
async function requireLiftable(incidentId: string): Promise<IncidentRow> {
  const row = await loadIncidentRow(incidentId);
  if (!row) throw new Error('INCIDENT_NOT_FOUND');
  if (row.status !== 'FALSE_ALARM') throw new Error('NOT_FALSE_ALARM');
  if (row.suspended) throw new Error('STILL_SUSPENDED');
  return row;
}

/**
 * Open a request to lift the blocks of a false-alarm incident.
 * @throws INCIDENT_NOT_FOUND / NOT_FALSE_ALARM / STILL_SUSPENDED / REASON_REQUIRED /
 *   NOTHING_TO_LIFT / LIFT_ALREADY_PENDING
 */
export async function requestLift(
  incidentId: string,
  reason: string,
  caller: IncidentCaller,
): Promise<BlockLiftRequest> {
  const clean = (reason || '').trim().slice(0, 2000);
  if (!clean) throw new Error('REASON_REQUIRED');
  const row = await requireLiftable(incidentId);
  if ((await unliftedBlocks(incidentId)).length === 0) throw new Error('NOTHING_TO_LIFT');
  const id = uuidv4();
  try {
    await db.transaction(async (trx) => {
      await trx('certificate_block_lift_requests').insert({
        id,
        incident_id: incidentId,
        reason: clean,
        requested_by: lower(caller.email),
        requested_at: new Date(),
        status: 'PENDING',
      });
      await appendEvent(trx, incidentId, caller.email, 'BLOCK_LIFT_REQUESTED', {
        requestId: id,
        reason: clean,
      });
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new Error('LIFT_ALREADY_PENDING');
    throw err;
  }
  await auditIncident(row, caller, 'CREATE', {
    action: 'incident_block_lift_request',
    requestId: id,
  });
  const created: RequestRow = await db('certificate_block_lift_requests').where({ id }).first();
  return toApi(created);
}

async function requirePending(incidentId: string, requestId: string): Promise<RequestRow> {
  const row: RequestRow | undefined = await db('certificate_block_lift_requests')
    .where({ id: requestId, incident_id: incidentId })
    .first();
  if (!row) throw new Error('LIFT_NOT_FOUND');
  if (row.status !== 'PENDING') throw new Error('LIFT_NOT_PENDING');
  return row;
}

/**
 * The requester withdraws a pending request.
 * @throws LIFT_NOT_FOUND / LIFT_NOT_PENDING / NOT_REQUESTER
 */
export async function cancelLift(
  incidentId: string,
  requestId: string,
  caller: IncidentCaller,
): Promise<BlockLiftRequest> {
  const request = await requirePending(incidentId, requestId);
  if (lower(caller.email) !== lower(request.requested_by)) throw new Error('NOT_REQUESTER');
  const won = await db('certificate_block_lift_requests')
    .where({ id: requestId, status: 'PENDING' })
    .update({ status: 'CANCELLED', decided_by: lower(caller.email), decided_at: new Date() });
  if (!won) throw new Error('LIFT_NOT_PENDING');
  const row = await loadIncidentRow(incidentId);
  if (row) {
    await auditIncident(row, caller, 'UPDATE', { action: 'incident_block_lift_cancel', requestId });
  }
  return toApi(await db('certificate_block_lift_requests').where({ id: requestId }).first());
}

export interface LiftResult {
  request: BlockLiftRequest;
  /** Thumbprints whose block was lifted. */
  lifted: number;
  /** New allow-list version; null when publishing failed (create one by hand). */
  versionNumber: number | null;
  published: boolean;
}

/** Restore the APPROVAL login entries of the site from its latest approved request. */
async function restoreLogins(row: IncidentRow): Promise<void> {
  const org = row.organization_id;
  if (!org) return;
  const instance = (await db('organizations as o')
    .join('instances as i', 'i.id', 'o.instance_id')
    .where('o.identifier', org)
    .first('i.id as instance_id', 'i.removed_at')) as
    | { instance_id: string; removed_at: Date | null }
    | undefined;
  // A removed site never logs in; another incident that still suspends it keeps its logins off.
  if (!instance || instance.removed_at) return;
  if ((await suspendedOrganizations()).has(org)) return;
  const approved = (await db('approval_requests')
    .where({ instance_id: instance.instance_id, status: 'APPROVED' })
    .orderBy([
      { column: 'created_at', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .first('id')) as { id: string } | undefined;
  if (approved) await syncLoginCertificatesAfterApproval(approved.id);
}

/**
 * Second admin confirms: every blocked thumbprint of the incident is lifted.
 * @throws INCIDENT_NOT_FOUND / NOT_FALSE_ALARM / STILL_SUSPENDED / LIFT_NOT_FOUND /
 *   LIFT_NOT_PENDING / SELF_CONFIRM / SAME_SITE / NOTHING_TO_LIFT
 */
export async function confirmLift(
  incidentId: string,
  requestId: string,
  caller: IncidentCaller,
): Promise<LiftResult> {
  const by = lower(caller.email);
  const request = await requirePending(incidentId, requestId);
  if (by === lower(request.requested_by)) throw new Error('SELF_CONFIRM');
  const requesterSite = siteOfEmail(lower(request.requested_by));
  const confirmerSite = siteOfEmail(by);
  if (!requesterSite || !confirmerSite || requesterSite === confirmerSite) {
    throw new Error('SAME_SITE');
  }
  const row = await requireLiftable(incidentId);

  const now = new Date();
  const lifted = await db.transaction(async (trx) => {
    // First decision wins: only a still-PENDING row can be flipped.
    const won = await trx('certificate_block_lift_requests')
      .where({ id: requestId, status: 'PENDING' })
      .update({ status: 'CONFIRMED', decided_by: by, decided_at: now });
    if (!won) throw new Error('LIFT_NOT_PENDING');
    const fingerprints: string[] = await trx('blocked_certificate_thumbprints as b')
      .where('b.incident_id', incidentId)
      .whereNotExists(
        trx('certificate_block_lifts as l')
          .whereRaw('l.fingerprint = b.fingerprint')
          .whereRaw('l.incident_id = b.incident_id'),
      )
      .pluck('b.fingerprint');
    if (fingerprints.length === 0) throw new Error('NOTHING_TO_LIFT');
    await trx('certificate_block_lifts').insert(
      fingerprints.map((fingerprint) => ({
        id: uuidv4(),
        fingerprint,
        incident_id: incidentId,
        request_id: requestId,
        requested_by: request.requested_by,
        requested_at: request.requested_at,
        confirmed_by: by,
        confirmed_at: now,
        reason: request.reason,
      })),
    );
    await appendEvent(trx, incidentId, caller.email, 'BLOCKS_LIFTED', {
      requestId,
      lifted: fingerprints.length,
      requestedBy: request.requested_by,
      reason: request.reason,
    });
    return fingerprints.length;
  });

  try {
    await restoreLogins(row);
  } catch (err) {
    logger.error({ err, incidentId }, '[BlockLift] restoring logins failed');
  }
  let versionNumber: number | null = null;
  try {
    const version = await createSnapshot({
      triggeredBy: 'MANUAL',
      triggeredByEmail: by,
      notes: `Incident: certificate blocks of ${row.organization_id ?? 'unknown site'} lifted`,
    });
    versionNumber = version.versionNumber;
  } catch (err) {
    logger.error({ err, incidentId }, '[BlockLift] publishing failed');
  }
  await auditIncident(row, caller, 'UPDATE', {
    action: 'incident_block_lift_confirm',
    requestId,
    requestedBy: request.requested_by,
    lifted,
    versionNumber,
  });
  const done: RequestRow = await db('certificate_block_lift_requests')
    .where({ id: requestId })
    .first();
  return { request: toApi(done), lifted, versionNumber, published: versionNumber !== null };
}
