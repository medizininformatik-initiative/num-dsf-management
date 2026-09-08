/**
 * buildSiteRows.ts – Pure row-building helpers for the hackathon seed.
 *
 * Given one validated manifest user (see ./manifestSchema), returns plain
 * insert-ready row objects for the organization, its 2 contacts, its 2
 * endpoints (+ endpoint_ips), and its 2 memberships — everything a
 * "complete dummy site" needs except the rows that require a live DB id
 * (users/instances) or the current time of insertion (admin_grants), which
 * seed-hackathon.ts builds itself around this helper's output.
 *
 * No DB access happens here: buildCertificateRow calls certificate.service's
 * parseCertificate, which is a synchronous, pure PEM parser (it never queries
 * the database), so this module is safe to unit-test without one.
 *
 * Dependencies: uuid, services/certificate.service (parseCertificate),
 * ./manifestSchema (HackathonUser).
 */
import { v4 as uuidv4 } from 'uuid';
import { parseCertificate } from '../../services/certificate.service';
import type { HackathonUser } from './manifestSchema';

// RFC 5737 documentation ranges only (TEST-NET-1/2/3) — never routable, never real.
const IP_BASES = ['192.0.2', '198.51.100', '203.0.113'] as const;

function charSum(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return sum;
}

/** Deterministic-but-distinct RFC 5737 address for (seed, salt) — no shared counter needed. */
function rfc5737Ip(seed: string, salt: number): string {
  const n = charSum(seed) + salt;
  const base = IP_BASES[n % IP_BASES.length];
  const lastOctet = (n % 253) + 1; // 1..253
  return `${base}.${lastOctet}`;
}

export interface OrganizationInsert {
  identifier: string;
  name: string;
  active: boolean;
  email: string;
  city: string;
  country_code: string;
  client_cert_fingerprint: string;
  client_cert_thumbprint: string;
  created_at: Date;
  updated_at: Date;
}

export interface ContactInsert {
  id: string;
  organization_id: string;
  types: string;
  name: string;
  email: string;
  email_validated: boolean;
  phone: string;
  city: string;
  country_code: string;
  created_at: Date;
  updated_at: Date;
}

export interface EndpointInsert {
  identifier: string;
  organization_id: string;
  name: string;
  address: string;
  created_at: Date;
  updated_at: Date;
}

export interface EndpointIpInsert {
  id: string;
  endpoint_id: string;
  ip: string;
  is_fhir: boolean;
  is_bpe: boolean;
}

export interface MembershipInsert {
  id: string;
  organization_id: string;
  parent_organization: string;
  endpoint_id: string;
  roles: string;
  created_at: Date;
  updated_at: Date;
}

export interface CertificateInsert {
  id: string;
  organization_id: string;
  pem: string;
  subject: string;
  thumbprint: string;
  valid_until: Date;
  created_at: Date;
}

export interface HackathonSiteRows {
  organization: OrganizationInsert;
  contacts: [ContactInsert, ContactInsert];
  endpoints: [EndpointInsert, EndpointInsert];
  endpointIps: [EndpointIpInsert, EndpointIpInsert];
  memberships: [MembershipInsert, MembershipInsert];
}

/**
 * Build the organization/contacts/endpoints/endpoint_ips/memberships rows for
 * one hackathon user's site. `parentOrganization` comes from the manifest
 * (shared by every user, e.g. "hackathon-hub.example.de").
 */
export function buildSiteRows(
  user: HackathonUser,
  parentOrganization: string,
  now: Date = new Date(),
): HackathonSiteRows {
  const org = user.orgIdentifier;

  const fhirEndpoint: EndpointInsert = {
    identifier: `fhir.${org}`,
    organization_id: org,
    name: `DSF FHIR ${user.orgName}`,
    address: `https://fhir.${org}/fhir`,
    created_at: now,
    updated_at: now,
  };
  const bpeEndpoint: EndpointInsert = {
    identifier: `bpe.${org}`,
    organization_id: org,
    name: `DSF BPE ${user.orgName}`,
    address: `https://bpe.${org}/fhir`,
    created_at: now,
    updated_at: now,
  };

  return {
    organization: {
      identifier: org,
      name: user.orgName,
      active: true,
      email: user.email,
      city: user.city,
      country_code: user.countryCode,
      client_cert_fingerprint: user.fingerprintSha512,
      client_cert_thumbprint: user.thumbprintSha256,
      created_at: now,
      updated_at: now,
    },
    contacts: [
      {
        id: uuidv4(),
        organization_id: org,
        types: JSON.stringify(['DSF_ADMIN']),
        name: 'Hackathon DSF-Admin',
        email: `dsf-admin@${org}`,
        email_validated: true,
        phone: '+49301234567',
        city: user.city,
        country_code: user.countryCode,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv4(),
        organization_id: org,
        types: JSON.stringify(['MEDIC']),
        name: 'Hackathon Medizinkontakt',
        email: `medic@${org}`,
        email_validated: true,
        phone: '+49301234568',
        city: user.city,
        country_code: user.countryCode,
        created_at: now,
        updated_at: now,
      },
    ],
    endpoints: [fhirEndpoint, bpeEndpoint],
    endpointIps: [
      {
        id: uuidv4(),
        endpoint_id: fhirEndpoint.identifier,
        ip: rfc5737Ip(org, 0),
        is_fhir: true,
        is_bpe: false,
      },
      {
        id: uuidv4(),
        endpoint_id: bpeEndpoint.identifier,
        ip: rfc5737Ip(org, 1),
        is_fhir: false,
        is_bpe: true,
      },
    ],
    memberships: [
      {
        id: uuidv4(),
        organization_id: org,
        parent_organization: parentOrganization,
        endpoint_id: fhirEndpoint.identifier,
        roles: JSON.stringify(['DIC']),
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv4(),
        organization_id: org,
        parent_organization: parentOrganization,
        endpoint_id: fhirEndpoint.identifier,
        roles: JSON.stringify(['HRP']),
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

/**
 * Parse `certPem` (via certificate.service's parseCertificate, the same
 * parser the certificate upload API uses) into an insert-ready certificates
 * row for `organizationIdentifier`.
 * @throws PRIVATE_KEY_REJECTED / INVALID_PEM on a bad PEM.
 */
export function buildCertificateRow(
  organizationIdentifier: string,
  certPem: string,
): CertificateInsert {
  const { subject, thumbprint, validUntil } = parseCertificate(certPem.trim());
  return {
    id: uuidv4(),
    organization_id: organizationIdentifier,
    pem: certPem.trim(),
    subject,
    thumbprint,
    valid_until: validUntil,
    created_at: new Date(),
  };
}
