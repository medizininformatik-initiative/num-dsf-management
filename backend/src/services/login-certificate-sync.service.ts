/**
 * login-certificate-sync.service.ts – Login certificates follow the approved
 * allow list (table org_login_certificates, migration 033).
 *
 * At a site the DSF certificate usually is the login certificate. Once a
 * request is APPROVED (four-eyes or silent consent), every SHA-512 thumbprint
 * of its allow-list snapshot may log in as the organization (source APPROVAL);
 * an APPROVAL entry whose thumbprint a later approved snapshot no longer lists
 * is removed. Entries from onboarding, the migration or an admin are never
 * removed here. Admin certificates and thumbprints that already log in for
 * another organization are skipped, and so are thumbprints an incident
 * blocked (migration 035). A certificate an admin uploaded (e.g. one
 * a site sent by mail), one deleted after submit and one of unknown origin
 * (uploaded_by_admin NULL) log in only after real four-eyes approval: two
 * APPROVE signatures from distinct sites; one approval plus silent consent is
 * not enough.
 *
 * Uploading a certificate links it to an existing entry with the same
 * thumbprint (e.g. a fingerprint-only entry of the legacy import); renewing a
 * certificate unlinks its entry instead of deleting it, so the site keeps its
 * login until the new certificate is approved and the old one expires.
 *
 * Dependencies: db/connection, org-login-certificates.service, incident-blocks.service,
 *               lib/certFingerprint, lib/logger
 */
import type { Knex } from 'knex';
import { db } from '../db/connection';
import { recordSystemLoginChange } from './org-login-certificates.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { logger } from '../lib/logger';
import { siteOfEmail } from '../lib/approvalState';
import { blockedFingerprints } from './incident-blocks.service';

export const APPROVAL_ACTOR = 'SYSTEM:allow-list-approval';

interface SnapshotAllowList {
  active?: boolean;
  member?: { identifier?: string; thumbprints?: unknown };
}

interface CertRow {
  id: string;
  pem: string;
  valid_until: Date | string | null;
  uploaded_by_admin: number | boolean | null;
}

function allowListOf(snapshotJson: unknown): SnapshotAllowList | null {
  try {
    const snap = typeof snapshotJson === 'string' ? JSON.parse(snapshotJson) : snapshotJson;
    const section = (snap as { allowList?: SnapshotAllowList } | null)?.allowList;
    return section && typeof section === 'object' ? section : null;
  } catch {
    return null;
  }
}

function fingerprintsOf(certs: CertRow[]): Map<string, CertRow> {
  const map = new Map<string, CertRow>();
  for (const c of certs) {
    try {
      map.set(sha512FingerprintFromPem(c.pem), c);
    } catch {
      logger.warn({ certificateId: c.id }, '[LoginSync] stored certificate PEM does not parse');
    }
  }
  return map;
}

/**
 * Bring the APPROVAL login entries of the request's organization in line with
 * its approved snapshot. Call after the request turned APPROVED.
 * @returns the thumbprints that were added and removed.
 */
export async function syncLoginCertificatesFromApproval(
  requestId: string,
): Promise<{ added: string[]; removed: string[] }> {
  const request = await db('approval_requests')
    .where({ id: requestId, status: 'APPROVED' })
    .first('snapshot_json');
  const section = request ? allowListOf(request.snapshot_json) : null;
  const identifier = section?.member?.identifier;
  // Snapshots before the allowList section, and withdrawals, leave logins alone.
  if (!section || !section.active || !identifier || !Array.isArray(section.member?.thumbprints)) {
    return { added: [], removed: [] };
  }
  const blocked = await blockedFingerprints();
  const approved = [
    ...new Set(
      (section.member.thumbprints as unknown[])
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.toLowerCase())
        .filter((t) => !blocked.has(t)),
    ),
  ];

  const result = await db.transaction(async (trx) => {
    const org = await trx('organizations').where({ identifier }).first('identifier');
    if (!org) return { added: [], removed: [] };
    const certs = fingerprintsOf(
      await trx('certificates')
        .where({ organization_id: identifier })
        .select('id', 'pem', 'valid_until', 'uploaded_by_admin'),
    );
    const approverSites = new Set(
      (
        await trx('approval_signatures')
          .where({ approval_request_id: requestId, decision: 'APPROVE' })
          .pluck('admin_email')
      )
        .map((e: string) => siteOfEmail(e))
        .filter((site: string) => site !== ''),
    );
    const fourEyes = approverSites.size >= 2;
    const adminFps = new Set(
      approved.length
        ? await trx('admin_cert_fingerprints').whereIn('fingerprint', approved).pluck('fingerprint')
        : [],
    );
    const existing = new Map<string, { organization_id: string; certificate_id: string | null }>(
      (approved.length
        ? await trx('org_login_certificates')
            .whereIn('fingerprint', approved)
            .select('fingerprint', 'organization_id', 'certificate_id')
        : []
      ).map(
        (r: { fingerprint: string; organization_id: string; certificate_id: string | null }) => [
          r.fingerprint,
          r,
        ],
      ),
    );

    const added: string[] = [];
    for (const fp of approved) {
      if (adminFps.has(fp)) {
        logger.warn(
          { identifier },
          '[LoginSync] approved thumbprint is an admin certificate, skipped',
        );
        continue;
      }
      const cert = certs.get(fp);
      const row = existing.get(fp);
      // Only a present, clinic-uploaded certificate passes with one approval. A
      // missing (deleted after submit) or unknown-origin one needs four eyes,
      // unless it already logs in for this organization (renewal keeps it).
      const clinicUploaded = cert
        ? cert.uploaded_by_admin !== null && Number(cert.uploaded_by_admin) === 0
        : row?.organization_id === identifier;
      if (!clinicUploaded && !fourEyes) {
        logger.warn(
          { identifier },
          '[LoginSync] certificate not clinic-uploaded lacks two approvals from distinct sites, skipped',
        );
        continue;
      }
      if (row && row.organization_id !== identifier) {
        logger.warn(
          { identifier },
          '[LoginSync] approved thumbprint logs in for another organization, skipped',
        );
        continue;
      }
      if (row) {
        if (!row.certificate_id && cert) {
          await trx('org_login_certificates')
            .where({ fingerprint: fp })
            .update({ certificate_id: cert.id, valid_until: cert.valid_until });
        }
        continue;
      }
      await trx('org_login_certificates').insert({
        fingerprint: fp,
        organization_id: identifier,
        certificate_id: cert?.id ?? null,
        source: 'APPROVAL',
        created_by: APPROVAL_ACTOR,
        created_at: new Date(),
        valid_until: cert?.valid_until ?? null,
      });
      added.push(fp);
    }

    const staleQuery = trx('org_login_certificates').where({
      organization_id: identifier,
      source: 'APPROVAL',
    });
    if (approved.length) staleQuery.whereNotIn('fingerprint', approved);
    const removed: string[] = await staleQuery.clone().pluck('fingerprint');
    if (removed.length) {
      await trx('org_login_certificates').whereIn('fingerprint', removed).del();
    }
    return { added, removed };
  });

  for (const fp of result.added) {
    await recordSystemLoginChange(identifier, 'enable', APPROVAL_ACTOR, fp, 'approval');
  }
  for (const fp of result.removed) {
    await recordSystemLoginChange(identifier, 'disable', APPROVAL_ACTOR, fp, 'approval');
  }
  return result;
}

/** Post-commit hook for an approval: a failure is logged, never thrown. */
export async function syncLoginCertificatesAfterApproval(requestId: string): Promise<void> {
  try {
    await syncLoginCertificatesFromApproval(requestId);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : 'unknown', requestId },
      'login certificate sync after approval failed',
    );
  }
}

/**
 * Link a freshly uploaded certificate to the organization's login entry with
 * the same thumbprint, if that entry has no certificate yet.
 */
export async function linkUploadedCertificate(
  conn: Knex | Knex.Transaction,
  organizationId: string,
  certificateId: string,
  pem: string,
  validUntil: Date | string | null,
): Promise<void> {
  let fingerprint: string;
  try {
    fingerprint = sha512FingerprintFromPem(pem);
  } catch {
    return;
  }
  await conn('org_login_certificates')
    .where({ fingerprint, organization_id: organizationId })
    .whereNull('certificate_id')
    .update({ certificate_id: certificateId, valid_until: validUntil });
}

/**
 * Before a renewal deletes the old certificate: keep its login entry as a
 * fingerprint-only entry (valid_until stays), instead of the FK cascade.
 */
export async function unlinkRenewedCertificate(
  trx: Knex.Transaction,
  certificateId: string,
): Promise<void> {
  await trx('org_login_certificates')
    .where({ certificate_id: certificateId })
    .update({ certificate_id: null });
}
