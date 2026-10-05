/**
 * network.service.ts – Cross-instance "allow list" view for the map
 * Admins receive full details. Non-admins receive only active/inactive +
 * endpoint names + aggregate cert status — no PII, no IPs, no exact expiry dates.
 * Dependencies: db, approved-snapshot.service
 */
import { db } from '../db/connection';
import { parseJsonStringArray as safeJsonArray } from '../lib/jsonColumn';
import {
  approvedActive,
  loadLatestApprovedSites,
  snapshotCertificateIds,
  snapshotEndpoints,
  snapshotMemberships,
  snapshotOrgField,
} from './approved-snapshot.service';
import type {
  OrganizationRow,
  EndpointRow,
  EndpointIpRow,
  CertRow,
  ContactRow,
  MembershipRow,
} from '../types/rows';

type CertStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NONE';

function certStatus(validUntils: (Date | string | null)[]): {
  status: CertStatus;
  next: string | null;
  daysUntil: number | null;
} {
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const valid = validUntils
    .filter((v): v is Date | string => v != null)
    .map((v) => new Date(v).getTime())
    .filter((t) => !isNaN(t));
  if (valid.length === 0) return { status: 'NONE', next: null, daysUntil: null };
  // Reduce instead of Math.max(...valid): spreading every expiry as an arg
  // risks a RangeError once a cert count exceeds the engine's arg limit.
  const furthest = valid.reduce((a, b) => (b > a ? b : a), valid[0]);
  const days = Math.ceil((furthest - now) / (24 * 60 * 60 * 1000));
  if (furthest < now)
    return { status: 'EXPIRED', next: new Date(furthest).toISOString(), daysUntil: days };
  if (furthest - now < THIRTY_DAYS)
    return { status: 'EXPIRING', next: new Date(furthest).toISOString(), daysUntil: days };
  return { status: 'VALID', next: new Date(furthest).toISOString(), daysUntil: days };
}

export async function getNetworkMap(opts: { isAdmin: boolean }) {
  // The federation set MUST match fhir.service.generateFullBundle (the single
  // source of truth): a site is on the map when its LATEST APPROVED request
  // says it is active. A newer pending/rejected/withdrawn request does not hide
  // an approved site. Endpoints, IPs, memberships, certificates and the
  // organization master data come from that approved snapshot (what the
  // allow list publishes); contacts and the admin e-mail are live. A site
  // whose approved request has no usable snapshot is shown from live data.
  const sites = (await loadLatestApprovedSites()).filter(approvedActive);
  const approvedOrgIds: string[] = sites.map((s) => s.orgIdentifier);
  if (approvedOrgIds.length === 0) return { organizations: [] };
  const siteByOrg = new Map(sites.map((s) => [s.orgIdentifier, s]));

  const orgs: OrganizationRow[] = await db('organizations').whereIn('identifier', approvedOrgIds);
  const endpoints: EndpointRow[] = await db('endpoints').whereIn('organization_id', approvedOrgIds);
  const endpointIds = endpoints.map((e) => e.identifier);
  const endpointIps: EndpointIpRow[] =
    endpointIds.length > 0 ? await db('endpoint_ips').whereIn('endpoint_id', endpointIds) : [];
  const contacts: ContactRow[] = await db('contacts').whereIn('organization_id', approvedOrgIds);
  const certs: CertRow[] = await db('certificates').whereIn('organization_id', approvedOrgIds);
  // Exclude soft-deleted (admin-removed) affiliations, matching fhir.service
  // and the approval snapshot — they are no longer live relationships.
  const memberships: MembershipRow[] = await db('memberships')
    .whereIn('organization_id', approvedOrgIds)
    .whereNull('deleted_at');

  const organizations = orgs.map((org) => {
    const snapshot = siteByOrg.get(org.identifier)?.snapshot ?? null;
    const approvedCertIds = snapshotCertificateIds(snapshot);
    const orgCerts = certs.filter(
      (c) =>
        c.organization_id === org.identifier &&
        (!approvedCertIds || approvedCertIds.includes(c.id)),
    );
    const { status, next, daysUntil } = certStatus(orgCerts.map((c) => c.valid_until));

    const approvedEndpoints = snapshotEndpoints(snapshot);
    const orgEndpointsRaw: Array<{
      identifier: string;
      name: string | null;
      address: string;
      ips: Array<{ ip: string; is_fhir: boolean; is_bpe: boolean }>;
    }> =
      approvedEndpoints ??
      endpoints
        .filter((e) => e.organization_id === org.identifier)
        .map((e) => ({
          identifier: e.identifier,
          name: e.name,
          address: e.address,
          ips: endpointIps
            .filter((ip) => ip.endpoint_id === e.identifier)
            .map((ip) => ({ ip: ip.ip, is_fhir: !!ip.is_fhir, is_bpe: !!ip.is_bpe })),
        }));
    const orgMembershipsRaw: Array<{
      parent_organization: string;
      endpoint_id: string;
      roles: unknown;
    }> =
      snapshotMemberships(snapshot) ??
      memberships.filter((m) => m.organization_id === org.identifier);

    const base = {
      identifier: org.identifier,
      name: snapshotOrgField(snapshot, 'name') ?? org.name,
      active: true,
      city: snapshotOrgField(snapshot, 'city') ?? org.city ?? null,
      country_code: snapshotOrgField(snapshot, 'country_code') ?? org.country_code ?? null,
      cert_status: status,
    };

    // Non-admins get the redacted endpoint/membership view. The admin branch
    // below supplies its own detailed arrays, so the public ones are built
    // only here to avoid a discarded computation on the admin path.
    if (!opts.isAdmin) {
      return {
        ...base,
        endpoints: orgEndpointsRaw.map((ep) => ({
          identifier: ep.identifier,
          name: ep.name,
        })),
        memberships: orgMembershipsRaw.map((m) => ({
          parent_organization: m.parent_organization,
          roles: safeJsonArray(m.roles),
        })),
      };
    }

    const adminEndpoints = orgEndpointsRaw.map((ep) => ({
      identifier: ep.identifier,
      name: ep.name,
      address: ep.address,
      ips: ep.ips,
    }));
    const adminContacts = contacts
      .filter((c) => c.organization_id === org.identifier)
      .map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        types: safeJsonArray(c.types),
      }));
    const adminMemberships = orgMembershipsRaw.map((m) => ({
      parent_organization: m.parent_organization,
      endpoint_id: m.endpoint_id,
      roles: safeJsonArray(m.roles),
    }));

    return {
      ...base,
      email: org.email,
      next_cert_expiry: next,
      cert_days_until: daysUntil,
      endpoints: adminEndpoints,
      contacts: adminContacts,
      memberships: adminMemberships,
      certificates_count: orgCerts.length,
    };
  });

  return { organizations };
}
