/**
 * bundle-restore.service.ts – four-eyes restore of an old allow-list version.
 * An admin requests the restore of a version; a second admin from a DIFFERENT
 * site approves (which publishes the new RESTORE version) or rejects it. No
 * self-approval, one pending request at a time, the first decision is final.
 * Dependencies: db/connection, uuid, lib/approvalState, audit.service,
 *               bundle-versions.service
 */
import { db } from '../db/connection';
import { v4 as uuidv4 } from 'uuid';
import { siteOfEmail } from '../lib/approvalState';
import { writeAuditLog } from './audit.service';
import { restoreVersion } from './bundle-versions.service';

export class RestoreRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RestoreStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface RestoreRequestView {
  id: string;
  sourceVersionId: string;
  sourceVersionNumber: number | null;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  status: RestoreStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  resultingVersionId: string | null;
  resultingVersionNumber: number | null;
}

const lower = (s: string): string => s.toLowerCase().trim();

async function loadSource(id: string): Promise<{ version_number: number }> {
  const source = await db('bundle_versions')
    .select('version_number', db.raw('(input_json IS NOT NULL) AS has_input'))
    .where({ id })
    .first();
  if (!source) throw new RestoreRequestError('NOT_FOUND', 'Bundle version not found.');
  if (!source.has_input) {
    throw new RestoreRequestError(
      'VERSION_NOT_RESTORABLE',
      'This version was created before restore support and cannot be restored.',
    );
  }
  return source;
}

async function loadRequest(rid: string) {
  const req = await db('bundle_restore_requests').where({ id: rid }).first();
  if (!req) throw new RestoreRequestError('NOT_FOUND', 'Restore request not found.');
  return req;
}

function audit(
  userEmail: string,
  rid: string,
  operation: 'CREATE' | 'APPROVE' | 'REJECT' | 'DELETE',
  detail: Record<string, unknown>,
  ipAddress?: string,
): Promise<void> {
  return writeAuditLog({
    userEmail,
    resourceType: 'APPROVAL',
    resourceId: rid,
    operation,
    diffJson: { action: 'bundle_restore', ...detail },
    ipAddress,
  }).catch(() => {});
}

export async function createRestoreRequest(
  sourceVersionId: string,
  reason: string,
  requestedBy: string,
  ipAddress?: string,
): Promise<{ id: string; sourceVersionNumber: number }> {
  const source = await loadSource(sourceVersionId);
  const pending = await db('bundle_restore_requests').where({ status: 'PENDING' }).first();
  if (pending) {
    throw new RestoreRequestError('ALREADY_PENDING', 'A restore request is already pending.');
  }
  const id = uuidv4();
  try {
    await db('bundle_restore_requests').insert({
      id,
      source_version_id: sourceVersionId,
      reason,
      requested_by: lower(requestedBy),
      requested_at: new Date(),
      status: 'PENDING',
    });
  } catch (err: unknown) {
    // The unique pending_slot key closes the race between the check and the insert.
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new RestoreRequestError('ALREADY_PENDING', 'A restore request is already pending.');
    }
    throw err;
  }
  await audit(
    requestedBy,
    id,
    'CREATE',
    { step: 'REQUEST', sourceVersion: source.version_number, reason },
    ipAddress,
  );
  return { id, sourceVersionNumber: source.version_number };
}

export async function listRestoreRequests(limit = 50): Promise<RestoreRequestView[]> {
  const rows = await db('bundle_restore_requests as r')
    .leftJoin('bundle_versions as s', 's.id', 'r.source_version_id')
    .leftJoin('bundle_versions as n', 'n.id', 'r.resulting_version_id')
    .select(
      'r.*',
      's.version_number as source_version_number',
      'n.version_number as resulting_version_number',
    )
    .orderBy('r.requested_at', 'desc')
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    sourceVersionId: r.source_version_id,
    sourceVersionNumber: r.source_version_number ?? null,
    reason: r.reason,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionComment: r.decision_comment,
    resultingVersionId: r.resulting_version_id,
    resultingVersionNumber: r.resulting_version_number ?? null,
  }));
}

/** Claim a PENDING request for a decision; the first decision wins. */
async function claim(
  rid: string,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  by: string,
  comment: string | null,
): Promise<void> {
  const changed = await db('bundle_restore_requests')
    .where({ id: rid, status: 'PENDING' })
    .update({ status, decided_by: lower(by), decided_at: new Date(), decision_comment: comment });
  if (changed === 0) {
    throw new RestoreRequestError('NOT_PENDING', 'Request is no longer pending.');
  }
}

export async function approveRestoreRequest(
  rid: string,
  approverEmail: string,
  ipAddress?: string,
): Promise<{ id: string; versionNumber: number; restoredFromVersion: number }> {
  const req = await loadRequest(rid);
  if (req.status !== 'PENDING') {
    throw new RestoreRequestError('NOT_PENDING', `Request is ${req.status}`);
  }
  if (lower(req.requested_by) === lower(approverEmail)) {
    throw new RestoreRequestError('SELF_APPROVE', 'You cannot approve your own request');
  }
  const requesterSite = siteOfEmail(req.requested_by);
  const approverSite = siteOfEmail(approverEmail);
  if (!requesterSite || !approverSite || requesterSite === approverSite) {
    throw new RestoreRequestError(
      'SAME_SITE',
      'Approver must be from a different site than the requester',
    );
  }
  // The source may have lost its input or vanished since the request.
  await loadSource(req.source_version_id);

  await claim(rid, 'APPROVED', approverEmail, null);
  try {
    const result = await restoreVersion(req.source_version_id, req.reason, approverEmail);
    await db('bundle_restore_requests')
      .where({ id: rid })
      .update({ resulting_version_id: result.id });
    await audit(
      approverEmail,
      rid,
      'APPROVE',
      {
        step: 'APPROVE',
        sourceVersion: result.restoredFromVersion,
        resultingVersion: result.versionNumber,
        requestedBy: req.requested_by,
      },
      ipAddress,
    );
    return {
      id: result.id,
      versionNumber: result.versionNumber,
      restoredFromVersion: result.restoredFromVersion,
    };
  } catch (err) {
    // Nothing was published: hand the request back so it can be decided again.
    await db('bundle_restore_requests').where({ id: rid }).update({
      status: 'PENDING',
      decided_by: null,
      decided_at: null,
      decision_comment: null,
    });
    throw err;
  }
}

export async function rejectRestoreRequest(
  rid: string,
  rejectorEmail: string,
  comment: string,
  ipAddress?: string,
): Promise<void> {
  const req = await loadRequest(rid);
  if (req.status !== 'PENDING') {
    throw new RestoreRequestError('NOT_PENDING', `Request is ${req.status}`);
  }
  const clean = (comment || '').trim();
  if (!clean) throw new RestoreRequestError('REASON_REQUIRED', 'Rejection comment required');
  await claim(rid, 'REJECTED', rejectorEmail, clean);
  await audit(rejectorEmail, rid, 'REJECT', { step: 'REJECT', comment: clean }, ipAddress);
}

export async function cancelRestoreRequest(
  rid: string,
  requesterEmail: string,
  ipAddress?: string,
): Promise<void> {
  const req = await loadRequest(rid);
  if (req.status !== 'PENDING') {
    throw new RestoreRequestError('NOT_PENDING', `Request is ${req.status}`);
  }
  if (lower(req.requested_by) !== lower(requesterEmail)) {
    throw new RestoreRequestError('NOT_REQUESTER', 'Only the original requester can cancel');
  }
  await claim(rid, 'CANCELLED', requesterEmail, null);
  await audit(requesterEmail, rid, 'DELETE', { step: 'CANCEL' }, ipAddress);
}
