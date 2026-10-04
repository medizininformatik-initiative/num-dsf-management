/**
 * hackathon-replay-changes.test.ts – Second half of the hackathon replay:
 * what happens to the allow list when participants change it. Starts from
 * three approved hackathon sites (production seed + four-eyes approval) and
 * replays, through the API behind the mTLS proxy:
 *  1. a site adds an endpoint and a DMS membership, resubmits, gets approved
 *     again, and the other sites' DSF downloads carry the change;
 *  2. a site leaves the hub: its memberships are deleted, resubmitted and
 *     approved, and every allow list carries the DELETE for that affiliation;
 *  3. the IMI operator onboards a fourth site from CSV; it signs in by
 *     certificate, registers its DSF certificate, endpoint and membership,
 *     gets approved and from then on appears in everyone's allow list while
 *     its own DSF download lists the three original sites.
 * Every downloaded bundle must pass the DSF acceptance rules.
 * Dependencies: supertest, app, db/connection, helpers/hackathon,
 *               helpers/allowListSites, helpers/dsfAllowListChecks
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { makeCertPem, mtlsHeaders } from '../helpers/allowListSites';
import { dsfAllowListViolations } from '../helpers/dsfAllowListChecks';
import {
  affiliation,
  api,
  approveByTwo,
  certLogin,
  dsfDownload,
  hackathonManifest,
  organizationsIn,
  pendingRequestId,
  removeParticipants,
  seedParticipants,
  type Bundle,
  type Participant,
} from '../helpers/hackathon';

describe('Hackathon replay: participants change the allow list', () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const manifest = hackathonManifest(3, run);
  const hub = manifest.parentOrganization;
  const newcomerOrg = `klinik-4-${run}.example.de`;
  const newcomerEmail = `dsf-admin@${newcomerOrg}`;
  let sites: Participant[] = [];

  const org = (s: Pick<Participant, 'user'>) => s.user.orgIdentifier;

  /** DSF read for a site's FHIR endpoint, checked against the DSF acceptance rules. */
  async function allowListOf(
    s: Pick<Participant, 'pem' | 'fhirEndpoint' | 'user'>,
  ): Promise<Bundle> {
    const res = await dsfDownload(s.pem, s.fhirEndpoint);
    expect(res.status).toBe(200);
    expect(
      dsfAllowListViolations(res.body, {
        receiverOrganization: org(s),
        receiverEndpoint: s.fhirEndpoint,
      }),
    ).toEqual([]);
    return res.body as Bundle;
  }

  async function submit(s: Pick<Participant, 'token' | 'pem' | 'instanceId'>): Promise<string> {
    const res = await api(s).post(`/api/v1/instances/${s.instanceId}/approval/submit`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING');
    return res.body.data.id as string;
  }

  beforeAll(async () => {
    sites = await seedParticipants(manifest);
    for (const s of sites) s.token = await certLogin(s.pem);
    for (let i = 0; i < sites.length; i++) {
      const requestId = await pendingRequestId(sites[i].instanceId);
      await approveByTwo(requestId, sites[(i + 1) % 3], sites[(i + 2) % 3]);
    }
  });

  afterAll(async () => {
    await removeParticipants(
      [...manifest.users.map((u) => u.email), newcomerEmail],
      [...manifest.users.map((u) => u.orgIdentifier), newcomerOrg],
    );
  });

  it('1. an added endpoint and DMS membership reach the other sites after re-approval', async () => {
    const [changer, a, b] = sites;
    const endpoint = `dsf2.${org(changer)}`;
    const created = await api(changer).post(`/api/v1/instances/${changer.instanceId}/endpoints`, {
      identifier: endpoint,
      name: 'DSF DMS',
      address: `https://${endpoint}/fhir`,
      ipAddresses: [{ ip: '192.0.2.44', isFhir: true }],
    });
    expect(created.status).toBe(201);
    const ms = await api(changer).post(`/api/v1/instances/${changer.instanceId}/memberships`, {
      parentOrganization: hub,
      endpointId: endpoint,
      roles: ['DMS'],
    });
    expect(ms.status).toBe(201);

    const requestId = await submit(changer);
    expect(await approveByTwo(requestId, a, b)).toBe('APPROVED');

    for (const viewer of [a, b]) {
      const bundle = await allowListOf(viewer);
      const oa = affiliation(bundle, 'PUT', hub, org(changer), endpoint);
      expect(oa?.resource?.code).toEqual([
        { coding: [{ system: 'http://dsf.dev/fhir/CodeSystem/organization-role', code: 'DMS' }] },
      ]);
      const addresses = (bundle.entry ?? [])
        .filter((e) => e.resource?.resourceType === 'Endpoint')
        .map((e) => e.resource!.address);
      expect(addresses).toContain(`https://${endpoint}/fhir`);
    }
    // The changer's own download now holds only its own affiliations for the
    // endpoint it asks for: the DMS one belongs to the other endpoint.
    const own = await allowListOf(changer);
    expect(affiliation(own, 'PUT', hub, org(changer), endpoint)).toBeUndefined();
    expect(affiliation(own, 'PUT', hub, org(changer), changer.fhirEndpoint)).toBeDefined();
  });

  it('2. leaving the hub publishes a DELETE for the affiliation everywhere', async () => {
    const [a, b, leaver] = sites;
    const list = await api(leaver).get(`/api/v1/instances/${leaver.instanceId}/memberships`);
    const atHub = (list.body.data as Array<{ id: string; parent_organization: string }>).filter(
      (m) => m.parent_organization === hub,
    );
    expect(atHub.length).toBeGreaterThan(0);
    for (const m of atHub) {
      const del = await api(leaver).del(
        `/api/v1/instances/${leaver.instanceId}/memberships/${m.id}`,
      );
      expect(del.status).toBeLessThan(300);
    }
    const requestId = await submit(leaver);
    expect(await approveByTwo(requestId, a, b)).toBe('APPROVED');

    for (const viewer of [a, b]) {
      const bundle = await allowListOf(viewer);
      expect(affiliation(bundle, 'DELETE', hub, org(leaver), leaver.fhirEndpoint)).toBeDefined();
      expect(affiliation(bundle, 'PUT', hub, org(leaver), leaver.fhirEndpoint)).toBeUndefined();
      // Still an active, approved organization: it stays published.
      expect(organizationsIn(bundle)).toContain(org(leaver));
    }
    const own = await allowListOf(leaver);
    expect(affiliation(own, 'DELETE', hub, org(leaver), leaver.fhirEndpoint)).toBeDefined();
  });

  it('3. a site onboarded from CSV joins the allow list after its approval', async () => {
    const [operator, second] = sites;
    const loginPem = makeCertPem(`login.${newcomerOrg}`);
    const csv =
      'organizationIdentifier,organizationName,contactEmail,clientCertFingerprint,city,countryCode\n' +
      `${newcomerOrg},Klinik 4,${newcomerEmail},${sha512FingerprintFromPem(loginPem)},Leipzig,DE\n`;
    const imported = await request(app)
      .post('/api/v1/admin/onboarding/import')
      .set('Authorization', `Bearer ${operator.token}`)
      .set(mtlsHeaders(operator.pem))
      .set('Content-Type', 'text/csv')
      .send(csv);
    expect(imported.status).toBe(200);
    expect(imported.body.data.summary.created).toBe(1);

    const newcomer = {
      user: { orgIdentifier: newcomerOrg },
      pem: loginPem,
      token: await certLogin(loginPem),
      instanceId: (await db('organizations').where({ identifier: newcomerOrg }).first())
        .instance_id,
      fhirEndpoint: `dsf.${newcomerOrg}`,
    };
    // Not yet part of anyone's allow list: no certificate, no approval.
    expect(organizationsIn(await allowListOf(operator))).not.toContain(newcomerOrg);

    const dsfPem = makeCertPem(`dsf-client.${newcomerOrg}`);
    const base = `/api/v1/instances/${newcomer.instanceId}`;
    expect((await api(newcomer).post(`${base}/certificates`, { pem: dsfPem })).status).toBe(201);
    const endpoint = await api(newcomer).post(`${base}/endpoints`, {
      identifier: newcomer.fhirEndpoint,
      address: `https://${newcomer.fhirEndpoint}/fhir`,
    });
    expect(endpoint.status).toBe(201);
    const membership = await api(newcomer).post(`${base}/memberships`, {
      parentOrganization: hub,
      endpointId: newcomer.fhirEndpoint,
      roles: ['DIC'],
    });
    expect(membership.status).toBe(201);
    const requestId = await submit(newcomer);
    expect(await approveByTwo(requestId, operator, second)).toBe('APPROVED');

    for (const viewer of sites) {
      const bundle = await allowListOf(viewer);
      expect(organizationsIn(bundle)).toContain(newcomerOrg);
      expect(affiliation(bundle, 'PUT', hub, newcomerOrg, newcomer.fhirEndpoint)).toBeDefined();
    }
    // The newcomer's DSF instance reads its list with the DSF certificate.
    const res = await request(app)
      .get(`/fhir/Bundle/${newcomer.fhirEndpoint}`)
      .set('Accept', 'application/fhir+json')
      .set(mtlsHeaders(dsfPem));
    expect(res.status).toBe(200);
    expect(organizationsIn(res.body as Bundle)).toEqual(expect.arrayContaining(sites.map(org)));
    expect(organizationsIn(res.body as Bundle)).not.toContain(newcomerOrg);
  });

  it('4. a site withdrawn from the allow list is deleted at every other site', async () => {
    const [a, b, leaver] = sites;
    const deactivated = await api(leaver).put(
      `/api/v1/instances/${leaver.instanceId}/organization`,
      {
        identifier: org(leaver),
        name: leaver.user.orgName,
        email: leaver.user.email,
        active: false,
        clientCertThumbprint: leaver.user.thumbprintSha256,
      },
    );
    expect(deactivated.status).toBe(200);
    // Until the deactivation is approved the published version is unchanged:
    // the organization and its endpoints are not deleted.
    const pendingId = await submit(leaver);
    const before = (await allowListOf(a)).entry ?? [];
    expect(
      before.filter(
        (e) =>
          e.request.method === 'DELETE' &&
          e.request.url.includes(org(leaver)) &&
          !e.request.url.startsWith('OrganizationAffiliation'),
      ),
    ).toEqual([]);

    expect(await approveByTwo(pendingId, a, b)).toBe('APPROVED');
    for (const viewer of [a, b]) {
      const deletes = ((await allowListOf(viewer)).entry ?? [])
        .filter((e) => e.request.method === 'DELETE')
        .map((e) => e.request.url);
      expect(deletes).toEqual(
        expect.arrayContaining([
          `Organization?identifier=http://dsf.dev/sid/organization-identifier|${org(leaver)}`,
          `Endpoint?identifier=http://dsf.dev/sid/endpoint-identifier|${leaver.fhirEndpoint}`,
          `Endpoint?identifier=http://dsf.dev/sid/endpoint-identifier|bpe.${org(leaver)}`,
        ]),
      );
      expect(
        affiliation(await allowListOf(viewer), 'DELETE', hub, org(leaver), leaver.fhirEndpoint),
      ).toBeDefined();
    }
    // Its own DSF server never receives a DELETE for itself.
    const own = (await allowListOf(leaver)).entry ?? [];
    expect(
      own.filter((e) => e.request.url.endsWith(`|${org(leaver)}`) && e.request.method === 'DELETE'),
    ).toEqual([]);
  });
});
