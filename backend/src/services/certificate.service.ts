/**
 * certificate.service.ts – PEM parsing, private key check, CRUD
 * SECURITY CRITICAL: Private keys IMMEDIATELY rejected, PEM NEVER in logs
 */
import crypto from 'crypto';
import type { Knex } from 'knex';
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { isCaBlacklisted } from './ca-blacklist.service';
import {
  isIssuerWhitelisted,
  isWhitelistEnforced,
  whitelistedIssuers,
} from './ca-whitelist.service';
import { errMessage } from '../lib/errMessage';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import {
  linkUploadedCertificate,
  unlinkRenewedCertificate,
} from './login-certificate-sync.service';
import { v4 as uuidv4 } from 'uuid';

// Columns selected for the API-facing certificate row, before the
// pem-to-thumbprintSha512 projection in toApiCertificates() below. A
// concrete interface (rather than Knex's implicit `any`) keeps that
// projection's result properly typed instead of collapsing to `any`.
interface CertificateRow {
  id: string;
  organization_id: string;
  subject: string;
  thumbprint: string;
  valid_until: Date | string | null;
  created_at: Date | string;
  pem: string;
  uploaded_by_admin?: number | null;
}

// Match BEGIN/END markers for any private-key variant, case-insensitive.
// Substring checks against literal upper-case 'PRIVATE KEY' miss PEMs that
// were lower-cased by an editor, a copy-paste tool, or the OpenSSL output
// of a non-default locale. Pattern intentionally permissive on whitespace
// between PRIVATE and KEY because some tooling emits hyphens or extra spaces.
const PRIVATE_KEY_MARKER =
  /-----BEGIN\s+(?:ENCRYPTED\s+|RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE[\s_-]+KEY-----/i;

/**
 * Guard against a private key reaching storage or logs. SECURITY CRITICAL.
 * @throws PRIVATE_KEY_REJECTED if the PEM contains any private-key block.
 */
export function rejectPrivateKey(pem: string): void {
  if (PRIVATE_KEY_MARKER.test(pem)) {
    throw new Error('PRIVATE_KEY_REJECTED');
  }
}

/**
 * Parse an X.509 PEM into subject, SHA-256 thumbprint, expiry, and issuer DN.
 * Rejects private keys before parsing; never logs the PEM.
 * @throws PRIVATE_KEY_REJECTED if the PEM carries a private key.
 * @throws INVALID_PEM if the certificate cannot be parsed.
 */
export function parseCertificate(pem: string): {
  subject: string;
  thumbprint: string;
  validUntil: Date;
  issuerDn: string;
} {
  rejectPrivateKey(pem);
  try {
    // node:crypto rather than node-forge: forge reads RSA keys only and threw
    // on EC certificates, which GEANT/HARICA issue for DSF sites too.
    const cert = new crypto.X509Certificate(pem);
    const subjectRdns = cert.subject.split('\n');
    const subject =
      subjectRdns.find((rdn) => rdn.startsWith('CN='))?.slice(3) || subjectRdns.join(', ');
    const thumbprint = crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase();
    const validUntil = new Date(cert.validTo);
    // Issuer Subject DN in certificate order, used by the CA-blacklist gate
    // (normalizeDn compares RDNs order- and case-insensitively).
    const issuerDn = cert.issuer.split('\n').join(',');
    return { subject, thumbprint, validUntil, issuerDn };
  } catch (err: unknown) {
    if (errMessage(err) === 'PRIVATE_KEY_REJECTED') throw err;
    throw new Error('INVALID_PEM');
  }
}

/** DSF SHA-512 thumbprint of a stored PEM; empty for corrupted at-rest data. */
function thumbprintOf(pem: string): string {
  try {
    return sha512FingerprintFromPem(pem);
  } catch {
    return '';
  }
}

/** Issuer DN of a stored PEM; empty for corrupted at-rest data. */
function issuerOf(pem: string): string {
  try {
    return parseCertificate(pem).issuerDn;
  } catch {
    return '';
  }
}

/**
 * API shape of certificate rows: the DSF SHA-512 thumbprint (128 lower-case
 * hex) and the issuer DN, with whether that issuer is a CA DSF accepts in
 * production (CA whitelist), are derived from the stored PEM; the PEM itself
 * is stripped, the certificates API never returns raw PEM content.
 */
async function toApiCertificates<T extends { pem: string; uploaded_by_admin?: number | null }>(
  rows: T[],
): Promise<
  Array<
    Omit<T, 'pem' | 'uploaded_by_admin'> & {
      thumbprintSha512: string;
      issuerDn: string;
      issuerTrusted: boolean;
      uploadedByClinic: boolean;
    }
  >
> {
  const issuers = rows.map((r) => issuerOf(r.pem));
  const trusted = await whitelistedIssuers(issuers.filter(Boolean));
  return rows.map(({ pem, uploaded_by_admin, ...rest }, i) => ({
    ...rest,
    // Only a certificate the clinic itself uploaded may become a login
    // certificate; unknown (NULL) counts as not uploaded by the clinic.
    uploadedByClinic: uploaded_by_admin === 0,
    // One unreadable row must not take the whole list down; the allow-list
    // bundle still refuses it (CERTIFICATE_PEM_INVALID).
    thumbprintSha512: thumbprintOf(pem),
    issuerDn: issuers[i],
    issuerTrusted: trusted.has(issuers[i]),
  }));
}

/**
 * Refuse issuers outside the CA whitelist when CA_WHITELIST_ENFORCE=true.
 * @throws CA_NOT_WHITELISTED
 */
async function assertIssuerAllowed(issuerDn: string): Promise<void> {
  if (isWhitelistEnforced() && !(await isIssuerWhitelisted(issuerDn))) {
    throw new Error('CA_NOT_WHITELISTED');
  }
}

/**
 * Parse a PEM without storing it, for the upload preview: what the portal
 * would register (subject, expiry, both thumbprints) and how the upload
 * checks would decide (blacklisted issuer, issuer on the CA whitelist).
 * @throws PRIVATE_KEY_REJECTED / INVALID_PEM on a bad PEM.
 */
export async function previewCertificate(pem: string): Promise<{
  subject: string;
  validUntil: Date;
  thumbprint: string;
  thumbprintSha512: string;
  issuerDn: string;
  issuerTrusted: boolean;
  issuerBlacklisted: boolean;
  whitelistEnforced: boolean;
}> {
  const { subject, thumbprint, validUntil, issuerDn } = parseCertificate(pem);
  return {
    subject,
    validUntil,
    thumbprint,
    thumbprintSha512: sha512FingerprintFromPem(pem),
    issuerDn,
    issuerTrusted: await isIssuerWhitelisted(issuerDn),
    issuerBlacklisted: await isCaBlacklisted({ subjectDn: issuerDn }),
    whitelistEnforced: isWhitelistEnforced(),
  };
}

export async function getCertificates(instanceId: string) {
  const org = await db('organizations').where({ instance_id: instanceId }).first();
  if (!org) return [];
  const rows: CertificateRow[] = await db('certificates')
    .where({ organization_id: org.identifier })
    .select(
      'id',
      'organization_id',
      'subject',
      'thumbprint',
      'valid_until',
      'created_at',
      'pem',
      'uploaded_by_admin',
    )
    .orderBy('created_at', 'desc');
  return toApiCertificates(rows);
}

/**
 * A certificate belongs to one organization: refuse a PEM whose thumbprint
 * another organization registered or whose SHA-512 fingerprint logs in for one.
 * @throws CERT_REGISTERED_ELSEWHERE
 */
async function assertNotRegisteredElsewhere(
  conn: Knex | Knex.Transaction,
  organizationId: string,
  thumbprint: string,
  pem: string,
): Promise<void> {
  const cert = await conn('certificates')
    .where({ thumbprint })
    .whereNot({ organization_id: organizationId })
    .first('id');
  const login = await conn('org_login_certificates')
    .where({ fingerprint: sha512FingerprintFromPem(pem) })
    .whereNot({ organization_id: organizationId })
    .first('fingerprint');
  if (cert || login) throw new Error('CERT_REGISTERED_ELSEWHERE');
}

/**
 * Validate and store a certificate for the instance's organization.
 * `uploadedByAdmin` records whether an admin session uploaded it (default true = unknown,
 * not eligible as login certificate; the clinic itself passes false).
 * Side-effects: inserts a certificates row and writes a CREATE audit log.
 * @throws PRIVATE_KEY_REJECTED / INVALID_PEM on a bad PEM.
 * @throws ORGANIZATION_NOT_FOUND if the instance has no organization.
 * @throws CA_BLACKLISTED if the issuing CA is blacklisted.
 * @throws CA_NOT_WHITELISTED if the whitelist is enforced and the issuer is not on it.
 * @throws CERT_REGISTERED_ELSEWHERE if another organization holds the certificate.
 */
export async function createCertificate(
  instanceId: string,
  pem: string,
  userEmail: string,
  ipAddress: string,
  uploadedByAdmin = true,
) {
  rejectPrivateKey(pem);
  const org = await db('organizations').where({ instance_id: instanceId }).first();
  if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
  const { subject, thumbprint, validUntil, issuerDn } = parseCertificate(pem.trim());
  if (await isCaBlacklisted({ subjectDn: issuerDn })) {
    throw new Error('CA_BLACKLISTED');
  }
  await assertIssuerAllowed(issuerDn);
  await assertNotRegisteredElsewhere(db, org.identifier, thumbprint, pem.trim());
  const id = uuidv4();
  await db('certificates').insert({
    id,
    organization_id: org.identifier,
    pem: pem.trim(),
    subject,
    thumbprint,
    valid_until: validUntil,
    created_at: new Date(),
    uploaded_by: userEmail,
    uploaded_by_admin: uploadedByAdmin ? 1 : 0,
  });
  await linkUploadedCertificate(db, org.identifier, id, pem.trim(), validUntil);
  await writeAuditLog({
    userEmail,
    instanceId,
    resourceType: 'CERTIFICATE',
    resourceId: id,
    operation: 'CREATE',
    diffJson: { subject, thumbprint, validUntil },
    ipAddress,
  });
  const row: CertificateRow = await db('certificates')
    .where({ id })
    .select(
      'id',
      'organization_id',
      'subject',
      'thumbprint',
      'valid_until',
      'created_at',
      'pem',
      'uploaded_by_admin',
    )
    .first();
  return (await toApiCertificates([row]))[0];
}

export async function deleteCertificate(
  instanceId: string,
  certId: string,
  userEmail: string,
  ipAddress: string,
) {
  const org = await db('organizations').where({ instance_id: instanceId }).first();
  if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
  const cert = await db('certificates')
    .where({ id: certId, organization_id: org.identifier })
    .first();
  if (!cert) throw new Error('CERTIFICATE_NOT_FOUND');
  await db('certificates').where({ id: certId }).delete();
  await writeAuditLog({
    userEmail,
    instanceId,
    resourceType: 'CERTIFICATE',
    resourceId: certId,
    operation: 'DELETE',
    ipAddress,
  });
}

/**
 * Atomically replace a certificate: insert the new PEM and delete the old one.
 * Side-effects: runs in a transaction and writes audit logs for both actions.
 * @throws PRIVATE_KEY_REJECTED / INVALID_PEM on a bad PEM.
 * @throws ORGANIZATION_NOT_FOUND / CERTIFICATE_NOT_FOUND if the org or old cert is missing.
 * @throws CA_BLACKLISTED if the issuing CA is blacklisted.
 * @throws CA_NOT_WHITELISTED if the whitelist is enforced and the issuer is not on it.
 * @throws CERT_REGISTERED_ELSEWHERE if another organization holds the new certificate.
 */
export async function renewCertificate(
  instanceId: string,
  oldCertId: string,
  body: { pem: string },
  userEmail: string,
  ipAddress: string,
  uploadedByAdmin = true,
) {
  rejectPrivateKey(body.pem);
  const { subject, thumbprint, validUntil, issuerDn } = parseCertificate(body.pem.trim());
  if (await isCaBlacklisted({ subjectDn: issuerDn })) {
    throw new Error('CA_BLACKLISTED');
  }
  await assertIssuerAllowed(issuerDn);

  const renewed = await db.transaction(async (trx) => {
    // Lock old cert row and verify it belongs to this instance's org
    const org = await trx('organizations').where({ instance_id: instanceId }).first();
    if (!org) throw new Error('ORGANIZATION_NOT_FOUND');

    const oldCert = await trx('certificates')
      .where({ id: oldCertId, organization_id: org.identifier })
      .forUpdate()
      .first();
    if (!oldCert) throw new Error('CERTIFICATE_NOT_FOUND');
    await assertNotRegisteredElsewhere(trx, org.identifier, thumbprint, body.pem.trim());

    // Insert new cert
    const newId = uuidv4();
    await trx('certificates').insert({
      id: newId,
      organization_id: org.identifier,
      pem: body.pem.trim(),
      subject,
      thumbprint,
      valid_until: validUntil,
      created_at: new Date(),
      uploaded_by: userEmail,
      uploaded_by_admin: uploadedByAdmin ? 1 : 0,
    });

    // Delete old cert; its login entry stays until the old certificate expires
    await unlinkRenewedCertificate(trx, oldCertId);
    await trx('certificates').where({ id: oldCertId }).delete();
    await linkUploadedCertificate(trx, org.identifier, newId, body.pem.trim(), validUntil);

    // Audit both actions (outside transaction lock; failures must not block)
    await writeAuditLog({
      userEmail,
      instanceId,
      resourceType: 'CERTIFICATE',
      resourceId: newId,
      operation: 'CREATE',
      diffJson: { subject, thumbprint, validUntil, renewedFrom: oldCertId },
      ipAddress,
    });
    await writeAuditLog({
      userEmail,
      instanceId,
      resourceType: 'CERTIFICATE',
      resourceId: oldCertId,
      operation: 'DELETE',
      diffJson: { replacedBy: newId },
      ipAddress,
    });

    const row: CertificateRow = await trx('certificates')
      .where({ id: newId })
      .select(
        'id',
        'organization_id',
        'subject',
        'thumbprint',
        'valid_until',
        'created_at',
        'pem',
        'uploaded_by_admin',
      )
      .first();
    return row;
  });
  return (await toApiCertificates([renewed]))[0];
}
