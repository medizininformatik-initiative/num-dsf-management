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
 * Dependencies: db/connection, audit.service, lib/certFingerprint
 */
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';

export interface LoginCertificate {
  fingerprint: string;
  certificateId: string | null;
  source: 'ONBOARDING' | 'ADMIN' | 'MIGRATED';
  createdBy: string | null;
  createdAt: Date;
}

function toApi(r: {
  fingerprint: string;
  certificate_id: string | null;
  source: LoginCertificate['source'];
  created_by: string | null;
  created_at: Date;
}): LoginCertificate {
  return {
    fingerprint: r.fingerprint,
    certificateId: r.certificate_id,
    source: r.source,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

async function requireOrg(identifier: string) {
  const org = await db('organizations').where({ identifier }).first();
  if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
  return org as { identifier: string; instance_id: string };
}

/** Login certificates of an organization, oldest first. */
export async function listForOrganization(identifier: string): Promise<LoginCertificate[]> {
  await requireOrg(identifier);
  const rows = await db('org_login_certificates')
    .where({ organization_id: identifier })
    .orderBy('created_at', 'asc');
  return rows.map(toApi);
}

/** Login certificates of the organization that belongs to an instance (read-only view). */
export async function listForInstance(instanceId: string): Promise<LoginCertificate[]> {
  const org = await db('organizations').where({ instance_id: instanceId }).first();
  if (!org) return [];
  const rows = await db('org_login_certificates')
    .where({ organization_id: org.identifier })
    .orderBy('created_at', 'asc');
  return rows.map(toApi);
}

/**
 * Enable an uploaded certificate of the organization as a login certificate.
 * The SHA-512 fingerprint is computed server-side from the stored PEM.
 * Idempotent for the same organization (links the certificate to a
 * fingerprint-only entry).
 * @throws ORGANIZATION_NOT_FOUND / CERTIFICATE_NOT_FOUND / INVALID_CERTIFICATE
 * @throws ADMIN_CERTIFICATE if the fingerprint is an admin certificate.
 * @throws FINGERPRINT_IN_USE if another organization already uses it.
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
  let fingerprint: string;
  try {
    fingerprint = sha512FingerprintFromPem(String(cert.pem));
  } catch {
    throw new Error('INVALID_CERTIFICATE');
  }
  if (await db('admin_cert_fingerprints').where({ fingerprint }).first()) {
    throw new Error('ADMIN_CERTIFICATE');
  }
  const existing = await db('org_login_certificates').where({ fingerprint }).first();
  if (existing && existing.organization_id !== identifier) throw new Error('FINGERPRINT_IN_USE');
  if (existing) {
    await db('org_login_certificates')
      .where({ fingerprint })
      .update({ certificate_id: certificateId });
  } else {
    await db('org_login_certificates').insert({
      fingerprint,
      organization_id: identifier,
      certificate_id: certificateId,
      source: 'ADMIN',
      created_by: actorEmail,
      created_at: new Date(),
    });
  }
  await audit(org, actorEmail, ip, {
    action: 'login_certificate',
    change: 'enable',
    fingerprintPrefix: fingerprint.slice(0, 16),
    certificateId,
  });
  return toApi(await db('org_login_certificates').where({ fingerprint }).first());
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
}

async function audit(
  org: { identifier: string; instance_id: string },
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
