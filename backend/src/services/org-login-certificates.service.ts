/**
 * org-login-certificates.service.ts – Admin-managed login certificates of an
 * organization (table org_login_certificates, migration 029).
 *
 * A certificate listed here may log in as the organization (session scoped to
 * its instance, see auth.service.resolveCertLogin). Entries come from the
 * onboarding import, the migration backfill, or an admin enabling a certificate
 * of the organization. Only admins change them; every change is audited as
 * ORGANIZATION/UPDATE with diff_json.action = 'login_certificate'.
 *
 * An admin may only enable a certificate the clinic itself uploaded
 * (certificates.uploaded_by_admin = 0, migration 031); otherwise an admin could
 * upload a certificate whose key he holds and sign in as that clinic. The
 * organization's DSF_ADMIN contacts (fallback: the organization e-mail) get a
 * mail whenever a login certificate is enabled or removed.
 *
 * A thumbprint blocked by an incident is never enabled; removeAllForOrganization
 * is the incident suspension's bulk removal.
 * Dependencies: db/connection, audit.service, notification.service,
 *               incident-blocks.service, lib/certFingerprint, lib/jsonColumn, lib/logger
 */
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { sendOrgLoginCertificateChangedEmail } from './notification.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { parseJsonStringArray } from '../lib/jsonColumn';
import { logger } from '../lib/logger';
import { isFingerprintBlocked } from './incident-blocks.service';

export interface LoginCertificate {
  fingerprint: string;
  certificateId: string | null;
  source: 'ONBOARDING' | 'ADMIN' | 'MIGRATED' | 'APPROVAL';
  createdBy: string | null;
  createdAt: Date;
  /** The linked certificate was uploaded by the clinic itself (false for fingerprint-only entries). */
  uploadedByClinic: boolean;
}

interface LoginRow {
  fingerprint: string;
  certificate_id: string | null;
  source: LoginCertificate['source'];
  created_by: string | null;
  created_at: Date;
  uploaded_by_admin?: number | null;
}

interface OrgRow {
  identifier: string;
  instance_id: string;
  name: string;
  email: string | null;
}

function toApi(r: LoginRow): LoginCertificate {
  return {
    fingerprint: r.fingerprint,
    certificateId: r.certificate_id,
    source: r.source,
    createdBy: r.created_by,
    createdAt: r.created_at,
    uploadedByClinic: r.certificate_id !== null && r.uploaded_by_admin === 0,
  };
}

/** Login entries of an organization joined with the uploader flag of the linked certificate. */
function entriesOf(identifier: string): Promise<LoginRow[]> {
  return db('org_login_certificates as l')
    .leftJoin('certificates as c', 'c.id', 'l.certificate_id')
    .where('l.organization_id', identifier)
    .orderBy('l.created_at', 'asc')
    .select('l.*', 'c.uploaded_by_admin');
}

async function requireOrg(identifier: string): Promise<OrgRow> {
  const org = await db('organizations').where({ identifier }).first();
  if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
  return org as OrgRow;
}

/** Login certificates of an organization, oldest first. */
export async function listForOrganization(identifier: string): Promise<LoginCertificate[]> {
  await requireOrg(identifier);
  return (await entriesOf(identifier)).map(toApi);
}

/** Login certificates of the organization that belongs to an instance (read-only view). */
export async function listForInstance(instanceId: string): Promise<LoginCertificate[]> {
  const org = await db('organizations').where({ instance_id: instanceId }).first();
  if (!org) return [];
  return (await entriesOf(org.identifier)).map(toApi);
}

/** DSF_ADMIN contacts of the organization; falls back to the organization e-mail. */
async function noticeRecipients(org: OrgRow): Promise<string[]> {
  const contacts: Array<{ email: string; types: unknown }> = await db('contacts')
    .where({ organization_id: org.identifier })
    .select('email', 'types');
  const admins = contacts
    .filter((c) => c.email && parseJsonStringArray(c.types).includes('DSF_ADMIN'))
    .map((c) => c.email.toLowerCase().trim());
  const list = admins.length > 0 ? admins : org.email ? [org.email.toLowerCase().trim()] : [];
  return [...new Set(list)];
}

/**
 * Who is told about a login change of the organization right now. A caller
 * that is about to change the organization's addresses (onboarding re-import)
 * captures this first and passes it to recordSystemLoginChange.
 */
export async function loginNoticeRecipients(identifier: string): Promise<string[]> {
  const org = await db('organizations').where({ identifier }).first();
  return org ? noticeRecipients(org as OrgRow) : [];
}

/** Tell the clinic about the change; a failing mail never undoes it. */
async function notifyOrganization(
  org: OrgRow,
  change: 'enable' | 'disable',
  byAdmin: string,
  fingerprint: string,
  extraRecipients: string[] = [],
): Promise<void> {
  try {
    const to = [...new Set([...extraRecipients, ...(await noticeRecipients(org))])];
    await sendOrgLoginCertificateChangedEmail(to, {
      change,
      orgName: org.name || org.identifier,
      byAdmin,
      fingerprintPrefix: fingerprint.slice(0, 16),
    });
  } catch (err) {
    logger.error({ err }, '[OrgLoginCertificates] notification mail failed');
  }
}

/**
 * Audit and mail a login-certificate change made by the system (approval sync,
 * expiry cleanup) or by an onboarding re-import of an existing organization.
 * `priorRecipients` (addresses captured before the change) are mailed as well,
 * so a change cannot be hidden by also replacing the addresses.
 * Never throws: the change is already committed.
 */
export async function recordSystemLoginChange(
  identifier: string,
  change: 'enable' | 'disable',
  actor: string,
  fingerprint: string,
  reason: 'approval' | 'expired' | 'onboarding' | 'certificate_deleted',
  priorRecipients: string[] = [],
): Promise<void> {
  try {
    const org = await db('organizations').where({ identifier }).first();
    if (!org) return;
    await audit(org as OrgRow, actor, 'system', {
      action: 'login_certificate',
      change,
      reason,
      fingerprintPrefix: fingerprint.slice(0, 16),
    });
    await notifyOrganization(org as OrgRow, change, actor, fingerprint, priorRecipients);
  } catch (err) {
    logger.error({ err }, '[OrgLoginCertificates] recording a system change failed');
  }
}

/**
 * Enable an uploaded certificate of the organization as a login certificate.
 * The SHA-512 fingerprint is computed server-side from the stored PEM.
 * Idempotent for the same organization (links the certificate to a
 * fingerprint-only entry).
 * @throws ORGANIZATION_NOT_FOUND / CERTIFICATE_NOT_FOUND / INVALID_CERTIFICATE
 * @throws NOT_CLINIC_UPLOADED unless the clinic itself uploaded the certificate
 *   (an admin upload, or an upload of unknown origin, never qualifies).
 * @throws ADMIN_CERTIFICATE if the fingerprint is an admin certificate.
 * @throws FINGERPRINT_IN_USE if another organization already uses it.
 * @throws CERT_BLOCKED if an incident blocked the certificate.
 */
export async function enable(
  identifier: string,
  certificateId: string,
  actorEmail: string,
  ip: string,
): Promise<LoginCertificate> {
  const org = await requireOrg(identifier);
  const cert = await db('certificates')
    .where({ id: certificateId, organization_id: identifier })
    .first();
  if (!cert) throw new Error('CERTIFICATE_NOT_FOUND');
  if (cert.uploaded_by_admin !== 0) throw new Error('NOT_CLINIC_UPLOADED');
  let fingerprint: string;
  try {
    fingerprint = sha512FingerprintFromPem(String(cert.pem));
  } catch {
    throw new Error('INVALID_CERTIFICATE');
  }
  if (await db('admin_cert_fingerprints').where({ fingerprint }).first()) {
    throw new Error('ADMIN_CERTIFICATE');
  }
  if (await isFingerprintBlocked(fingerprint)) throw new Error('CERT_BLOCKED');
  const existing = await db('org_login_certificates').where({ fingerprint }).first();
  if (existing && existing.organization_id !== identifier) throw new Error('FINGERPRINT_IN_USE');
  if (existing) {
    await db('org_login_certificates')
      .where({ fingerprint })
      .update({ certificate_id: certificateId, valid_until: cert.valid_until ?? null });
  } else {
    await db('org_login_certificates').insert({
      fingerprint,
      organization_id: identifier,
      certificate_id: certificateId,
      source: 'ADMIN',
      created_by: actorEmail,
      created_at: new Date(),
      valid_until: cert.valid_until ?? null,
    });
  }
  await audit(org, actorEmail, ip, {
    action: 'login_certificate',
    change: 'enable',
    fingerprintPrefix: fingerprint.slice(0, 16),
    certificateId,
  });
  await notifyOrganization(org, 'enable', actorEmail, fingerprint);
  const row: LoginRow = await db('org_login_certificates as l')
    .leftJoin('certificates as c', 'c.id', 'l.certificate_id')
    .where('l.fingerprint', fingerprint)
    .select('l.*', 'c.uploaded_by_admin')
    .first();
  return toApi(row);
}

/**
 * Remove a login certificate entry (also fingerprint-only entries).
 * @throws ORGANIZATION_NOT_FOUND / LOGIN_CERTIFICATE_NOT_FOUND
 */
export async function remove(
  identifier: string,
  fingerprint: string,
  actorEmail: string,
  ip: string,
): Promise<void> {
  const org = await requireOrg(identifier);
  const deleted = await db('org_login_certificates')
    .where({ fingerprint, organization_id: identifier })
    .del();
  if (!deleted) throw new Error('LOGIN_CERTIFICATE_NOT_FOUND');
  // Keep the deprecated mirror column consistent (it is unique).
  await db('organizations')
    .where({ identifier, client_cert_fingerprint: fingerprint })
    .update({ client_cert_fingerprint: null });
  await audit(org, actorEmail, ip, {
    action: 'login_certificate',
    change: 'disable',
    fingerprintPrefix: fingerprint.slice(0, 16),
  });
  await notifyOrganization(org, 'disable', actorEmail, fingerprint);
}

/**
 * Remove every login certificate of the organization at once (incident
 * suspension). Audited as one change; the incident mail informs the site.
 * @returns the removed fingerprints.
 */
export async function removeAllForOrganization(
  identifier: string,
  actorEmail: string,
  ip: string,
): Promise<string[]> {
  const org = await requireOrg(identifier);
  const fingerprints: string[] = await db('org_login_certificates')
    .where({ organization_id: identifier })
    .pluck('fingerprint');
  if (fingerprints.length === 0) return [];
  await db('org_login_certificates').where({ organization_id: identifier }).del();
  await db('organizations')
    .where({ identifier })
    .whereNotNull('client_cert_fingerprint')
    .update({ client_cert_fingerprint: null });
  await audit(org, actorEmail, ip, {
    action: 'login_certificate',
    change: 'disable',
    reason: 'incident',
    count: fingerprints.length,
  });
  return fingerprints;
}

async function audit(
  org: OrgRow,
  actorEmail: string,
  ip: string,
  diffJson: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userEmail: actorEmail,
    instanceId: org.instance_id,
    resourceType: 'ORGANIZATION',
    resourceId: org.identifier,
    operation: 'UPDATE',
    diffJson,
    ipAddress: ip,
  });
}
