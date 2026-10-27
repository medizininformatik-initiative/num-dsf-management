/**
 * cert-cleanup.service.ts – Daily removal of expired certificates.
 *
 * 30 days after valid_until an organization certificate is deleted from the
 * portal (its linked login entry goes with it through the FK cascade), and a
 * login entry whose own valid_until passed 30 days ago is deleted too (entries
 * a renewal unlinked from their certificate). The allow list drops the
 * thumbprint with the site's next approved request; an expired certificate
 * cannot complete a TLS handshake anyway. Fingerprint-only entries without a
 * known expiry are kept. Every deletion is audited; removed logins are mailed
 * to the organization.
 *
 * Dependencies: db/connection, audit.service, org-login-certificates.service, lib/logger
 */
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { recordSystemLoginChange } from './org-login-certificates.service';
import { logger } from '../lib/logger';

export const CERT_CLEANUP_GRACE_DAYS = 30;
export const CLEANUP_ACTOR = 'SYSTEM:cert-cleanup';

/** Keep the deprecated, unique mirror column consistent with a removed login entry. */
async function clearMirror(organizationId: string, fingerprint: string): Promise<void> {
  await db('organizations')
    .where({ identifier: organizationId, client_cert_fingerprint: fingerprint })
    .update({ client_cert_fingerprint: null });
}

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/** @returns the number of deleted certificates and login entries. */
export async function runExpiredCertificateCleanup(
  now: Date = new Date(),
): Promise<{ certificates: number; logins: number }> {
  const cutoff = new Date(now);
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - CERT_CLEANUP_GRACE_DAYS);

  const certs: Array<{
    id: string;
    subject: string | null;
    valid_until: Date | string;
    organization_id: string;
    instance_id: string;
  }> = await db('certificates as c')
    .join('organizations as o', 'o.identifier', 'c.organization_id')
    .where('c.valid_until', '<', cutoff)
    .select('c.id', 'c.subject', 'c.valid_until', 'c.organization_id', 'o.instance_id');

  let certificates = 0;
  let logins = 0;
  for (const cert of certs) {
    try {
      const loginFps: string[] = await db('org_login_certificates')
        .where({ certificate_id: cert.id })
        .pluck('fingerprint');
      const deleted = await db('certificates').where({ id: cert.id }).delete();
      if (!deleted) continue;
      certificates++;
      await writeAuditLog({
        userEmail: CLEANUP_ACTOR,
        instanceId: cert.instance_id,
        resourceType: 'CERTIFICATE',
        resourceId: cert.id,
        operation: 'DELETE',
        diffJson: {
          event: 'EXPIRED_CLEANUP',
          subject: cert.subject,
          validUntil: isoDate(cert.valid_until),
          graceDays: CERT_CLEANUP_GRACE_DAYS,
        },
        ipAddress: 'system',
      });
      for (const fp of loginFps) {
        logins++;
        await clearMirror(cert.organization_id, fp);
        await recordSystemLoginChange(
          cert.organization_id,
          'disable',
          CLEANUP_ACTOR,
          fp,
          'expired',
        );
      }
    } catch (err) {
      logger.error({ err, certificateId: cert.id }, '[CertCleanup] failed to remove certificate');
    }
  }

  const entries: Array<{ fingerprint: string; organization_id: string }> = await db(
    'org_login_certificates',
  )
    .whereNull('certificate_id')
    .where('valid_until', '<', cutoff)
    .select('fingerprint', 'organization_id');
  for (const e of entries) {
    try {
      const deleted = await db('org_login_certificates')
        .where({ fingerprint: e.fingerprint })
        .whereNull('certificate_id')
        .del();
      if (!deleted) continue;
      logins++;
      await clearMirror(e.organization_id, e.fingerprint);
      await recordSystemLoginChange(
        e.organization_id,
        'disable',
        CLEANUP_ACTOR,
        e.fingerprint,
        'expired',
      );
    } catch (err) {
      logger.error({ err }, '[CertCleanup] failed to remove login entry');
    }
  }

  if (certificates || logins) {
    logger.info(`[CertCleanup] removed ${certificates} certificate(s), ${logins} login entr(ies)`);
  }
  return { certificates, logins };
}
