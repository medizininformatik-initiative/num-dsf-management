/**
 * admin-certificates.service.ts – Lifecycle of admin login certificates
 * (table admin_cert_fingerprints, migrations 021 + 030).
 *
 * An admin may hand in a successor certificate while the current one is still
 * valid; a colleague admin or the server CLI can restore access when it expired.
 * Every certificate is validated like an organization upload (no private key,
 * parseable, currently valid, issuer not blacklisted, whitelisted when
 * CA_WHITELIST_ENFORCE=true) and must not already serve as admin or
 * organization login certificate. Admin RIGHTS stay in admin_grants; this
 * service never grants them, it only requires them for a target.
 * The PEM is never stored and never logged, only fingerprint + metadata.
 *
 * Dependencies: db/connection, audit.service, auth.service (revokeAllSessions),
 *               certificate.service (PEM checks),
 * ca-whitelist/blacklist, lib/adminGrants, lib/certFingerprint
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { revokeAllSessions } from './auth.service';
import { rejectPrivateKey, parseCertificate } from './certificate.service';
import { isCaBlacklisted } from './ca-blacklist.service';
import { isIssuerWhitelisted, isWhitelistEnforced } from './ca-whitelist.service';
import { isVerifiedAdminEmail } from '../lib/adminGrants';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';

export class AdminCertError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface AdminCertificate {
  id: string;
  email: string;
  label: string | null;
  subject: string | null;
  fingerprint: string;
  validUntil: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface ParsedAdminCert {
  fingerprint: string;
  subject: string;
  validFrom: Date;
  validUntil: Date;
  issuerDn: string;
}

interface Row {
  id: string;
  email: string;
  label: string | null;
  subject: string | null;
  fingerprint: string;
  valid_until: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  created_by: string | null;
}

const lower = (e: string): string => e.toLowerCase().trim();

function toApi(r: Row): AdminCertificate {
  return {
    id: r.id,
    email: r.email,
    label: r.label,
    subject: r.subject,
    fingerprint: r.fingerprint,
    validUntil: r.valid_until,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

/**
 * Parse a PEM into the metadata stored for an admin certificate. Does not
 * check validity or uniqueness (see assertAcceptable).
 * @throws AdminCertError PRIVATE_KEY_REJECTED / INVALID_PEM
 */
export function parseAdminCert(pem: string): ParsedAdminCert {
  try {
    rejectPrivateKey(pem);
    const { subject, validUntil, issuerDn } = parseCertificate(pem.trim());
    const x509 = new crypto.X509Certificate(pem.trim());
    return {
      fingerprint: sha512FingerprintFromPem(pem.trim()),
      subject,
      validFrom: new Date(x509.validFrom),
      validUntil,
      issuerDn,
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'PRIVATE_KEY_REJECTED') {
      throw new AdminCertError('PRIVATE_KEY_REJECTED');
    }
    throw new AdminCertError('INVALID_PEM');
  }
}

/**
 * Everything a new admin certificate must satisfy.
 * @throws AdminCertError CERTIFICATE_EXPIRED / CERTIFICATE_NOT_YET_VALID /
 *   CA_BLACKLISTED / CA_NOT_WHITELISTED / ADMIN_CERTIFICATE_IN_USE /
 *   ORG_LOGIN_CERTIFICATE_IN_USE
 */
export async function assertAcceptable(parsed: ParsedAdminCert, now: Date): Promise<void> {
  if (parsed.validUntil.getTime() <= now.getTime()) throw new AdminCertError('CERTIFICATE_EXPIRED');
  if (parsed.validFrom.getTime() > now.getTime()) {
    throw new AdminCertError('CERTIFICATE_NOT_YET_VALID');
  }
  if (await isCaBlacklisted({ subjectDn: parsed.issuerDn })) {
    throw new AdminCertError('CA_BLACKLISTED');
  }
  if (isWhitelistEnforced() && !(await isIssuerWhitelisted(parsed.issuerDn))) {
    throw new AdminCertError('CA_NOT_WHITELISTED');
  }
  if (await db('admin_cert_fingerprints').where({ fingerprint: parsed.fingerprint }).first()) {
    throw new AdminCertError('ADMIN_CERTIFICATE_IN_USE');
  }
  if (await db('org_login_certificates').where({ fingerprint: parsed.fingerprint }).first()) {
    throw new AdminCertError('ORG_LOGIN_CERTIFICATE_IN_USE');
  }
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

export interface AddOptions {
  email: string;
  pem: string;
  label?: string | null;
  /** Who acts: an admin e-mail, or 'server-cli'. Stored as created_by. */
  actor: string;
  ip: string;
  /** Audit flag: true when an admin hands in a certificate for their own account. */
  self: boolean;
  now?: Date;
}

/**
 * Register a certificate for an EXISTING admin. Writes an audit entry
 * (AUTH/CREATE, diff_json.action = 'admin_certificate').
 * @throws AdminCertError NOT_AN_ADMIN plus every code of parseAdminCert / assertAcceptable.
 */
export async function addAdminCertificate(opts: AddOptions): Promise<AdminCertificate> {
  const email = lower(opts.email);
  if (!(await isVerifiedAdminEmail(email))) throw new AdminCertError('NOT_AN_ADMIN');
  const parsed = parseAdminCert(opts.pem);
  await assertAcceptable(parsed, opts.now ?? new Date());
  const id = uuidv4();
  try {
    await db('admin_cert_fingerprints').insert({
      id,
      email,
      fingerprint: parsed.fingerprint,
      subject: parsed.subject.slice(0, 255),
      valid_until: parsed.validUntil,
      label: opts.label?.trim() ? opts.label.trim().slice(0, 100) : null,
      created_by: opts.actor,
      created_at: new Date(),
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new AdminCertError('ADMIN_CERTIFICATE_IN_USE');
    throw err;
  }
  await writeAuditLog({
    userEmail: opts.actor,
    resourceType: 'AUTH',
    resourceId: email,
    operation: 'CREATE',
    diffJson: {
      action: 'admin_certificate',
      change: 'add',
      targetEmail: email,
      self: opts.self,
      fingerprintPrefix: parsed.fingerprint.slice(0, 16),
      validUntil: parsed.validUntil,
    },
    ipAddress: opts.ip,
  });
  return toApi(await db('admin_cert_fingerprints').where({ id }).first());
}

export interface RemoveOptions {
  email: string;
  id: string;
  actor: string;
  ip: string;
  self: boolean;
  /** Fingerprint of the certificate presented by the acting session (self-removal guard). */
  currentFingerprint?: string | null;
}

/**
 * Remove one admin certificate of `email` and end all sessions of `email`
 * (refresh tokens; access tokens run out within their 15 minutes).
 * @throws AdminCertError CERTIFICATE_NOT_FOUND / CURRENT_CERTIFICATE (a session
 *   may not remove the certificate it is using, so nobody locks themselves out).
 */
export async function removeAdminCertificate(opts: RemoveOptions): Promise<AdminCertificate> {
  const email = lower(opts.email);
  const row: Row | undefined = await db('admin_cert_fingerprints')
    .where({ id: opts.id, email })
    .first();
  if (!row) throw new AdminCertError('CERTIFICATE_NOT_FOUND');
  if (opts.self && opts.currentFingerprint && row.fingerprint === opts.currentFingerprint) {
    throw new AdminCertError('CURRENT_CERTIFICATE');
  }
  await db('admin_cert_fingerprints').where({ id: opts.id }).del();
  // End the admin's sessions, as lock and demote do: outside cert mode a
  // session created with this certificate would otherwise keep refreshing.
  await revokeAllSessions(email).catch(() => {});
  await writeAuditLog({
    userEmail: opts.actor,
    resourceType: 'AUTH',
    resourceId: email,
    operation: 'DELETE',
    diffJson: {
      action: 'admin_certificate',
      change: 'remove',
      targetEmail: email,
      self: opts.self,
      fingerprintPrefix: row.fingerprint.slice(0, 16),
    },
    ipAddress: opts.ip,
  });
  return toApi(row);
}

function sortByExpiry(list: AdminCertificate[]): AdminCertificate[] {
  const key = (c: AdminCertificate): number =>
    c.validUntil ? new Date(c.validUntil).getTime() : Number.POSITIVE_INFINITY;
  return list.sort((a, b) => key(a) - key(b));
}

/** Admin certificates of one e-mail, soonest expiry first (unknown expiry last). */
export async function listForEmail(email: string): Promise<AdminCertificate[]> {
  const rows: Row[] = await db('admin_cert_fingerprints').where({ email: lower(email) });
  return sortByExpiry(rows.map(toApi));
}

/** Every admin certificate (admin overview on the users page). */
export async function listAll(): Promise<AdminCertificate[]> {
  const rows: Row[] = await db('admin_cert_fingerprints');
  return sortByExpiry(rows.map(toApi));
}

/** Change the label of one of the admin's own certificates. */
export async function setLabel(
  email: string,
  id: string,
  label: string | null,
): Promise<AdminCertificate> {
  const clean = label?.trim() ? label.trim().slice(0, 100) : null;
  const n = await db('admin_cert_fingerprints')
    .where({ id, email: lower(email) })
    .update({ label: clean });
  if (!n) throw new AdminCertError('CERTIFICATE_NOT_FOUND');
  return toApi(await db('admin_cert_fingerprints').where({ id }).first());
}

const lastTouch = new Map<string, number>();
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Record expiry, subject and last use of an admin certificate that was just
 * presented. Always writes when `force` (a login), otherwise at most once per
 * day per fingerprint and process. Never throws: bookkeeping must not break
 * a login or a request. No-op for fingerprints that are not admin certificates.
 */
export async function recordAdminCertUse(
  fingerprint: string,
  pem: string,
  force = false,
): Promise<void> {
  try {
    const nowMs = Date.now();
    const prev = lastTouch.get(fingerprint);
    if (!force && prev !== undefined && nowMs - prev < TOUCH_INTERVAL_MS) return;
    lastTouch.set(fingerprint, nowMs);
    const { subject, validUntil } = parseCertificate(pem.trim());
    await db('admin_cert_fingerprints')
      .where({ fingerprint })
      .update({
        subject: subject.slice(0, 255),
        valid_until: validUntil,
        last_used_at: new Date(nowMs),
      });
  } catch {
    /* bookkeeping only */
  }
}
