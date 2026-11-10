/**
 * admin-cert-requests.service.ts – Four-eyes recovery of a COLLEAGUE's admin
 * login certificate (table admin_cert_requests, migration 031).
 *
 * Admin A requests a certificate for admin B. It becomes active only when a
 * third admin C approves: C is neither A nor B and belongs to a different site
 * than A (site = e-mail domain, lib/approvalState.siteOfEmail). The first
 * decision wins (conditional UPDATE on status = PENDING). The certificate is
 * validated again at approval, so a request that went stale (expired, CA
 * blacklisted, fingerprint taken meanwhile) cannot be activated. Pending
 * requests expire after 7 days. The PEM is a public certificate, kept only to
 * re-validate; it is never logged and never returned.
 *
 * Dependencies: db/connection, admin-certificates.service, audit.service,
 *               notification.service, lib/adminGrants, lib/approvalState
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { isVerifiedAdminEmail } from '../lib/adminGrants';
import { siteOfEmail } from '../lib/approvalState';
import { logger } from '../lib/logger';
import { canonicalCertificatePem } from '../lib/certFingerprint';
import { AdminCertError, assertAcceptable, parseAdminCert } from './admin-certificates.service';
import { writeAuditLog } from './audit.service';
import { sendAdminCertRequestEmail, type AdminCertRequestEvent } from './notification.service';

export type CertRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export const REQUEST_TTL_DAYS = 7;
const RECENT_DAYS = 14;

export class CertRequestError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface CertRequest {
  id: string;
  targetEmail: string;
  fingerprint: string;
  subject: string | null;
  validUntil: Date | null;
  label: string | null;
  requestedBy: string;
  status: CertRequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment: string | null;
  createdAt: Date;
}

interface Row {
  id: string;
  target_email: string;
  fingerprint: string;
  subject: string | null;
  valid_until: Date | null;
  label: string | null;
  pem: string;
  requested_by: string;
  status: CertRequestStatus;
  decided_by: string | null;
  decided_at: Date | null;
  comment: string | null;
  created_at: Date;
}

const lower = (e: string): string => e.toLowerCase().trim();

function toApi(r: Row): CertRequest {
  return {
    id: r.id,
    targetEmail: r.target_email,
    fingerprint: r.fingerprint,
    subject: r.subject,
    validUntil: r.valid_until,
    label: r.label,
    requestedBy: r.requested_by,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    comment: r.comment,
    createdAt: r.created_at,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

function audit(
  actor: string,
  operation: 'CREATE' | 'APPROVE' | 'REJECT' | 'DELETE',
  row: Pick<Row, 'id' | 'target_email' | 'fingerprint' | 'requested_by'>,
  decision: string,
  ip: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  return writeAuditLog({
    userEmail: actor,
    resourceType: 'AUTH',
    resourceId: row.id,
    operation,
    diffJson: {
      action: 'admin_certificate_request',
      decision,
      targetEmail: row.target_email,
      requestedBy: row.requested_by,
      fingerprintPrefix: row.fingerprint.slice(0, 16),
      ...extra,
    },
    ipAddress: ip,
  }).catch(() => {});
}

/** Mail requester + target (or just the target); a failing mail never undoes the decision. */
function mail(
  event: AdminCertRequestEvent,
  row: Row,
  to: string[],
  decidedBy: string | null,
  comment: string | null,
): void {
  sendAdminCertRequestEmail([...new Set(to.map(lower))], {
    event,
    targetEmail: row.target_email,
    requestedBy: row.requested_by,
    decidedBy,
    fingerprintPrefix: row.fingerprint.slice(0, 16),
    comment,
  }).catch((err) => logger.error({ err }, '[AdminCertRequests] notification mail failed'));
}

export interface CreateOptions {
  targetEmail: string;
  pem: string;
  label?: string | null;
  requestedBy: string;
  ip: string;
  now?: Date;
}

/**
 * Open a request for a certificate of ANOTHER admin. Validates exactly like a
 * direct upload (private key, parse, validity, CA rules, duplicates).
 * @throws AdminCertError NOT_AN_ADMIN / USE_SELF_SERVICE plus every parse/accept code
 * @throws CertRequestError REQUEST_ALREADY_PENDING for a fingerprint that is already requested
 */
export async function createRequest(opts: CreateOptions): Promise<CertRequest> {
  const target = lower(opts.targetEmail);
  const requester = lower(opts.requestedBy);
  if (target === requester) throw new AdminCertError('USE_SELF_SERVICE');
  if (!(await isVerifiedAdminEmail(target))) throw new AdminCertError('NOT_AN_ADMIN');
  const parsed = parseAdminCert(opts.pem);
  await assertAcceptable(parsed, opts.now ?? new Date());
  const id = uuidv4();
  // parseAdminCert accepted exactly one block; keep only its canonical form.
  const pem = canonicalCertificatePem(opts.pem);
  try {
    await db('admin_cert_requests').insert({
      id,
      target_email: target,
      fingerprint: parsed.fingerprint,
      subject: parsed.subject.slice(0, 255),
      valid_until: parsed.validUntil,
      label: opts.label?.trim() ? opts.label.trim().slice(0, 100) : null,
      pem,
      requested_by: requester,
      status: 'PENDING',
      created_at: new Date(),
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new CertRequestError('REQUEST_ALREADY_PENDING');
    throw err;
  }
  const row: Row = await db('admin_cert_requests').where({ id }).first();
  await audit(requester, 'CREATE', row, 'request', opts.ip, { validUntil: parsed.validUntil });
  mail('requested', row, [target], null, null);
  return toApi(row);
}

/** Every pending request plus the ones decided in the last two weeks, newest first. */
export async function listRequests(now: Date = new Date()): Promise<CertRequest[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const rows: Row[] = await db('admin_cert_requests')
    .where('status', 'PENDING')
    .orWhere('created_at', '>=', since)
    .orderBy('created_at', 'desc');
  return rows.map(toApi);
}

async function requirePending(id: string): Promise<Row> {
  const row: Row | undefined = await db('admin_cert_requests').where({ id }).first();
  if (!row) throw new CertRequestError('NOT_FOUND');
  if (row.status !== 'PENDING') throw new CertRequestError('NOT_PENDING');
  return row;
}

/**
 * Approve: the certificate becomes an active admin certificate of the target.
 * @throws CertRequestError NOT_FOUND / NOT_PENDING / SELF_APPROVE / TARGET_APPROVE / SAME_SITE / NOT_ADMIN
 * @throws AdminCertError when the certificate no longer passes validation
 */
export async function approveRequest(id: string, approver: string, ip: string): Promise<void> {
  const by = lower(approver);
  if (!(await isVerifiedAdminEmail(by))) throw new CertRequestError('NOT_ADMIN');
  const row = await requirePending(id);
  if (by === lower(row.requested_by)) throw new CertRequestError('SELF_APPROVE');
  if (by === lower(row.target_email)) throw new CertRequestError('TARGET_APPROVE');
  const requesterSite = siteOfEmail(lower(row.requested_by));
  const approverSite = siteOfEmail(by);
  if (!requesterSite || !approverSite || requesterSite === approverSite) {
    throw new CertRequestError('SAME_SITE');
  }
  if (!(await isVerifiedAdminEmail(row.target_email))) throw new AdminCertError('NOT_AN_ADMIN');
  const parsed = parseAdminCert(row.pem);
  await assertAcceptable(parsed, new Date());

  const now = new Date();
  try {
    await db.transaction(async (trx) => {
      // First decision wins: only a still-PENDING row can be flipped.
      const won = await trx('admin_cert_requests')
        .where({ id, status: 'PENDING' })
        .update({ status: 'APPROVED', decided_by: by, decided_at: now });
      if (!won) throw new CertRequestError('NOT_PENDING');
      await trx('admin_cert_fingerprints').insert({
        id: uuidv4(),
        email: row.target_email,
        fingerprint: parsed.fingerprint,
        subject: parsed.subject.slice(0, 255),
        valid_until: parsed.validUntil,
        label: row.label,
        created_by: `request:${id}`,
        created_at: now,
      });
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new AdminCertError('ADMIN_CERTIFICATE_IN_USE');
    throw err;
  }
  await audit(by, 'APPROVE', row, 'approve', ip, { validUntil: parsed.validUntil });
  mail('approved', row, [row.requested_by, row.target_email], by, null);
}

/**
 * Reject a pending request (any admin except its requester, who cancels instead).
 * @throws CertRequestError NOT_FOUND / NOT_PENDING / COMMENT_REQUIRED / USE_CANCEL / NOT_ADMIN
 */
export async function rejectRequest(
  id: string,
  rejector: string,
  comment: string,
  ip: string,
): Promise<void> {
  const by = lower(rejector);
  if (!(await isVerifiedAdminEmail(by))) throw new CertRequestError('NOT_ADMIN');
  const clean = (comment || '').trim().slice(0, 1000);
  if (!clean) throw new CertRequestError('COMMENT_REQUIRED');
  const row = await requirePending(id);
  if (by === lower(row.requested_by)) throw new CertRequestError('USE_CANCEL');
  const won = await db('admin_cert_requests')
    .where({ id, status: 'PENDING' })
    .update({ status: 'REJECTED', decided_by: by, decided_at: new Date(), comment: clean });
  if (!won) throw new CertRequestError('NOT_PENDING');
  await audit(by, 'REJECT', row, 'reject', ip, { comment: clean });
  mail('rejected', row, [row.requested_by, row.target_email], by, clean);
}

/**
 * The requester withdraws a pending request.
 * @throws CertRequestError NOT_FOUND / NOT_PENDING / NOT_REQUESTER
 */
export async function cancelRequest(id: string, requester: string, ip: string): Promise<void> {
  const by = lower(requester);
  const row = await requirePending(id);
  if (by !== lower(row.requested_by)) throw new CertRequestError('NOT_REQUESTER');
  const won = await db('admin_cert_requests')
    .where({ id, status: 'PENDING' })
    .update({ status: 'CANCELLED', decided_by: by, decided_at: new Date(), comment: 'cancelled' });
  if (!won) throw new CertRequestError('NOT_PENDING');
  await audit(by, 'DELETE', row, 'cancel', ip);
  mail('cancelled', row, [row.target_email], by, null);
}

/**
 * Cancel requests that waited longer than REQUEST_TTL_DAYS (daily scheduler step).
 * @returns number of requests expired
 */
export async function expireStaleRequests(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REQUEST_TTL_DAYS * 86_400_000);
  const stale: Row[] = await db('admin_cert_requests')
    .where('status', 'PENDING')
    .andWhere('created_at', '<', cutoff);
  let expired = 0;
  for (const row of stale) {
    const won = await db('admin_cert_requests')
      .where({ id: row.id, status: 'PENDING' })
      .update({ status: 'CANCELLED', decided_at: now, comment: 'expired' });
    if (!won) continue;
    expired += 1;
    await audit('system@scheduler', 'DELETE', row, 'expire', 'system');
    mail('cancelled', row, [row.requested_by, row.target_email], null, null);
  }
  return expired;
}
