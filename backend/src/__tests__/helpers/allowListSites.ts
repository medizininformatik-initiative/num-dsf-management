// Purpose: Seed complete, uniquely named DSF sites (user, instance,
// organization, endpoints, certificate, memberships, approval) for the
// allow-list bundle tests, plus the mTLS request headers the reverse proxy
// would forward. Identifiers are unique per call (.example.de), so parallel
// jest workers never collide. Certificates are real forge-generated
// self-signed CERTIFICATE blocks; no private key ever leaves this module.
// Dependencies: db/connection, uuid, node-forge, crypto,
//               services/certificate.service (parseCertificate), lib/certFingerprint

import crypto from 'crypto';
import forge from 'node-forge';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection';
import { parseCertificate } from '../../services/certificate.service';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';

export function makeCertPem(cn: string): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2024-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2035-01-01T00:00:00Z');
  const attrs = [{ shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

/** SHA-256 over the raw DER, exactly as lib/clientCert computes it. */
export function sha256Thumbprint(pem: string): string {
  const der = Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, ''), 'base64');
  return crypto.createHash('sha256').update(der).digest('hex');
}

/** Headers the proxy sets after a successful mTLS handshake. */
export function mtlsHeaders(pem: string): Record<string, string> {
  return { 'X-Client-Cert': encodeURIComponent(pem), 'X-Client-Verify': 'SUCCESS' };
}

export interface SiteSpec {
  label: string;
  /** Status of the single approval request; null seeds none. Default APPROVED. */
  approval?: 'APPROVED' | 'PENDING' | 'REJECTED' | null;
  active?: boolean;
  /** Register a DSF client certificate in the certificate list. Default true. */
  certificate?: boolean;
  /** Also register a separate login certificate on the organization. Default false. */
  loginCert?: boolean;
  /** Endpoint names; one unnamed endpoint by default. */
  endpoints?: Array<string | null>;
  memberships?: Array<{ parent: string; roles: string[]; endpoint?: number; deleted?: boolean }>;
}

export interface Site {
  userId: string;
  email: string;
  instanceId: string;
  orgId: string;
  name: string;
  endpointIds: string[];
  certPem: string | null;
  loginCertPem: string | null;
}

export async function seedSite(spec: SiteSpec): Promise<Site> {
  const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const orgId = `${spec.label}-${sfx}.example.de`;
  const email = `dsf-admin@${orgId}`;
  const userId = uuidv4();
  const instanceId = uuidv4();
  const now = new Date();
  const endpointNames = spec.endpoints ?? [null];
  const endpointIds = endpointNames.map((_, i) => `${i === 0 ? 'dsf' : `dsf${i + 1}`}.${orgId}`);
  const certPem = spec.certificate === false ? null : makeCertPem(`dsf-client.${orgId}`);
  const loginCertPem = spec.loginCert ? makeCertPem(`login.${orgId}`) : null;

  await db('email_whitelist').insert({ id: uuidv4(), email, created_by: 'test', created_at: now });
  await db('users').insert({ id: userId, email, totp_enabled: false, created_at: now });
  await db('instances').insert({ id: instanceId, user_id: userId, label: orgId, created_at: now });
  await db('organizations').insert({
    identifier: orgId,
    instance_id: instanceId,
    name: `Site ${spec.label}`,
    active: spec.active ?? true,
    email,
    city: 'Muenster',
    country_code: 'DE',
    client_cert_thumbprint: loginCertPem ? sha256Thumbprint(loginCertPem) : null,
    created_at: now,
    updated_at: now,
  });
  if (loginCertPem) {
    await db('org_login_certificates').insert({
      fingerprint: sha512FingerprintFromPem(loginCertPem),
      organization_id: orgId,
      certificate_id: null,
      source: 'ADMIN',
      created_by: 'test',
      created_at: now,
    });
  }
  await db('endpoints').insert(
    endpointIds.map((identifier, i) => ({
      identifier,
      organization_id: orgId,
      name: endpointNames[i],
      address: `https://${identifier}/fhir`,
      created_at: now,
      updated_at: now,
    })),
  );
  if (certPem) {
    const { subject, thumbprint, validUntil } = parseCertificate(certPem);
    await db('certificates').insert({
      id: uuidv4(),
      organization_id: orgId,
      pem: certPem,
      subject,
      thumbprint,
      valid_until: validUntil,
      created_at: now,
    });
  }
  for (const m of spec.memberships ?? []) {
    await db('memberships').insert({
      id: uuidv4(),
      organization_id: orgId,
      parent_organization: m.parent,
      endpoint_id: endpointIds[m.endpoint ?? 0],
      roles: JSON.stringify(m.roles),
      deleted_at: m.deleted ? now : null,
      created_at: now,
      updated_at: now,
    });
  }
  const approval = spec.approval === undefined ? 'APPROVED' : spec.approval;
  if (approval) {
    await db('approval_requests').insert({
      id: uuidv4(),
      instance_id: instanceId,
      status: approval,
      created_at: now,
      submitted_at: now,
      resolved_at: approval === 'PENDING' ? null : now,
      snapshot_json: JSON.stringify({}),
    });
  }
  return {
    userId,
    email,
    instanceId,
    orgId,
    name: `Site ${spec.label}`,
    endpointIds,
    certPem,
    loginCertPem,
  };
}

/** Delete the sites again; instance and organization rows cascade to their children. */
export async function removeSites(sites: Site[]): Promise<void> {
  for (const site of sites) {
    await db('instances').where({ id: site.instanceId }).del();
    await db('organizations').where({ identifier: site.orgId }).del();
    await db('users').where({ id: site.userId }).del();
    await db('email_whitelist').where({ email: site.email }).del();
  }
}
