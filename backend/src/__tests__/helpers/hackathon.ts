// Purpose: Hackathon scenario helpers for the replay tests. Builds manifest
// users with real certificates, seeds them through the production seed
// routine (seed-hackathon.seedUser) and performs the calls participants and
// their DSF instances make behind the mTLS proxy: certificate login,
// four-eyes approval with certificate step-up, allow-list edits and the DSF
// bundle read of dsf-process-allow-list (GET /fhir/Bundle/{id}).
// Dependencies: supertest, app, db/connection, db/seed-hackathon,
//               db/hackathon/manifestSchema, lib/certFingerprint, helpers/allowListSites

import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { seedUser } from '../../db/seed-hackathon';
import { hackathonManifestSchema, type HackathonUser } from '../../db/hackathon/manifestSchema';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { makeCertPem, mtlsHeaders, sha256Thumbprint } from './allowListSites';

export interface Participant {
  user: HackathonUser;
  /** Login certificate; the seed also registers it as the site's DSF certificate. */
  pem: string;
  instanceId: string;
  /** The DSF FHIR endpoint the site's allow-list process downloads for. */
  fhirEndpoint: string;
  token: string;
}

export interface BundleEntry {
  fullUrl?: string;
  resource?: Record<string, unknown> & {
    resourceType: string;
    identifier?: Array<{ system: string; value: string }>;
  };
  request: { method: string; url: string };
}

export interface Bundle {
  resourceType: string;
  type: string;
  entry?: BundleEntry[];
}

/** Unique, fictional hackathon run: n IMI admins on distinct .example.de sites. */
export function hackathonManifest(count: number, run: string) {
  const users = Array.from({ length: count }, (_, i) => {
    const org = `klinik-${i + 1}-${run}.example.de`;
    const pem = makeCertPem(`hack${i + 1}@${org}`);
    return {
      email: `hack${i + 1}@${org}`,
      name: `Hackathon ${i + 1}`,
      orgIdentifier: org,
      orgName: `Klinik ${i + 1}`,
      city: 'Muenster',
      countryCode: 'DE',
      fingerprintSha512: sha512FingerprintFromPem(pem),
      thumbprintSha256: sha256Thumbprint(pem),
      certPem: pem,
      admin: true,
    };
  });
  return hackathonManifestSchema.parse({
    parentOrganization: `hackathon-hub-${run}.example.de`,
    users,
  });
}

/** Seed every manifest user exactly like scripts/hackathon-prepare.sh does. */
export async function seedParticipants(
  manifest: ReturnType<typeof hackathonManifest>,
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (const user of manifest.users) {
    await seedUser(user, manifest.parentOrganization);
    const org = await db('organizations').where({ identifier: user.orgIdentifier }).first();
    participants.push({
      user,
      pem: user.certPem,
      instanceId: org.instance_id,
      fhirEndpoint: `fhir.${user.orgIdentifier}`,
      token: '',
    });
  }
  return participants;
}

/** POST /auth/client-cert-login, as the browser does behind the proxy. */
export async function certLogin(pem: string): Promise<string> {
  const res = await request(app).post('/auth/client-cert-login').set(mtlsHeaders(pem));
  if (res.status !== 200) {
    throw new Error(`cert login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken as string;
}

/** Authenticated API call that also carries the client certificate (cert step-up). */
export function api(p: Pick<Participant, 'token' | 'pem'>) {
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${p.token}`).set(mtlsHeaders(p.pem));
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    put: (url: string, body: object) => auth(request(app).put(url)).send(body),
    del: (url: string) => auth(request(app).delete(url)),
  };
}

export async function pendingRequestId(instanceId: string): Promise<string> {
  const row = await db('approval_requests')
    .where({ instance_id: instanceId, status: 'PENDING' })
    .first();
  if (!row) throw new Error(`no pending request for ${instanceId}`);
  return row.id as string;
}

/** Four-eyes: two admins of distinct sites approve; returns the final status. */
export async function approveByTwo(
  requestId: string,
  first: Participant,
  second: Participant,
): Promise<string> {
  const a = await api(first).post(`/api/v1/admin/approval/${requestId}/approve`);
  if (a.status !== 200) throw new Error(`first approval: ${a.status} ${JSON.stringify(a.body)}`);
  const b = await api(second).post(`/api/v1/admin/approval/${requestId}/approve`);
  if (b.status !== 200) throw new Error(`second approval: ${b.status} ${JSON.stringify(b.body)}`);
  const row = await db('approval_requests').where({ id: requestId }).first();
  return row.status as string;
}

/** The read DownloadAllowList performs: GET {base}/Bundle/{id}, JSON, client certificate. */
export function dsfDownload(pem: string, endpointId: string) {
  return request(app)
    .get(`/fhir/Bundle/${endpointId}`)
    .set('Accept', 'application/fhir+json')
    .set(mtlsHeaders(pem));
}

export function entriesOf(bundle: Bundle): BundleEntry[] {
  return bundle.entry ?? [];
}

/** Identifier values of the Organizations embedded in a bundle. */
export function organizationsIn(bundle: Bundle): string[] {
  return entriesOf(bundle)
    .filter((e) => e.resource?.resourceType === 'Organization')
    .map((e) => e.resource!.identifier?.[0]?.value ?? '');
}

/** The affiliation entry for (parent, member, endpoint), PUT or DELETE. */
export function affiliation(
  bundle: Bundle,
  method: 'PUT' | 'DELETE',
  parent: string,
  member: string,
  endpoint: string,
): BundleEntry | undefined {
  const url =
    `OrganizationAffiliation?primary-organization:identifier=http://dsf.dev/sid/organization-identifier|${parent}` +
    `&participating-organization:identifier=http://dsf.dev/sid/organization-identifier|${member}` +
    `&endpoint:identifier=http://dsf.dev/sid/endpoint-identifier|${endpoint}`;
  return entriesOf(bundle).find((e) => e.request.method === method && e.request.url === url);
}

/** Remove everything a replay created; cert login re-creates users, so clean last. */
export async function removeParticipants(emails: string[], orgIds: string[]): Promise<void> {
  const users = await db('users').whereIn('email', emails).select('id');
  const userIds = users.map((u: { id: string }) => u.id);
  const orgs = await db('organizations').whereIn('identifier', orgIds).select('instance_id');
  const instanceIds = orgs.map((o: { instance_id: string }) => o.instance_id);
  await db('instances').whereIn('id', instanceIds).del();
  if (userIds.length) await db('instances').whereIn('user_id', userIds).del();
  await db('organizations').whereIn('identifier', orgIds).del();
  if (userIds.length) {
    await db('refresh_tokens').whereIn('user_id', userIds).del();
    await db('users').whereIn('id', userIds).del();
  }
  await db('admin_cert_fingerprints').whereIn('email', emails).del();
  await db('admin_grants').whereIn('email', emails).del();
  await db('email_whitelist').whereIn('email', emails).del();
}
