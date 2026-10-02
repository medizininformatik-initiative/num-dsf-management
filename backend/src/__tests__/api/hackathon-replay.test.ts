/**
 * hackathon-replay.test.ts – Replays the hackathon end to end against the
 * real app and database, the way three participants and their DSF instances
 * use the portal behind the mTLS proxy:
 *  1. three sites are seeded with the production hackathon seed (seedUser):
 *     IMI admins on distinct .example.de domains, each with a login
 *     certificate that is also registered as the site's DSF certificate,
 *     two endpoints, DIC + HRP memberships at the hub and a PENDING request;
 *  2. every participant signs in by client certificate (no TOTP);
 *  3. before any approval, a site's DSF download contains none of the others;
 *  4. four-eyes: each request is approved by the two other sites;
 *  5. each site's allow-list process reads GET /fhir/Bundle/<fhir endpoint>
 *     and receives exactly the two other sites with SHA-512 thumbprints, one
 *     merged DIC + HRP affiliation each, its own affiliation referenced
 *     conditionally, in a bundle that passes the DSF acceptance rules;
 *  6. the GUI download of the same endpoint is the same allow list;
 *  7. a site's DSF BPE presents a separate DSF client certificate;
 *  8. the failure modes participants hit answer with FHIR OperationOutcomes.
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
  entriesOf,
  hackathonManifest,
  organizationsIn,
  pendingRequestId,
  removeParticipants,
  seedParticipants,
  type Bundle,
  type Participant,
} from '../helpers/hackathon';

const THUMBPRINT_URL = 'http://dsf.dev/fhir/StructureDefinition/extension-certificate-thumbprint';
const ROLE_SYSTEM = 'http://dsf.dev/fhir/CodeSystem/organization-role';

describe('Hackathon replay: three sites, four-eyes approval, DSF allow-list download', () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const manifest = hackathonManifest(3, run);
  const hub = manifest.parentOrganization;
  let sites: Participant[] = [];

  beforeAll(async () => {
    sites = await seedParticipants(manifest);
  });

  afterAll(async () => {
    await removeParticipants(
      manifest.users.map((u) => u.email),
      manifest.users.map((u) => u.orgIdentifier),
    );
  });

  const org = (s: Participant) => s.user.orgIdentifier;
  const download = async (s: Participant, pem = s.pem) => {
    const res = await dsfDownload(pem, s.fhirEndpoint);
    expect(res.status).toBe(200);
    return res.body as Bundle;
  };

  it('1. every participant signs in with the client certificate, without TOTP', async () => {
    for (const s of sites) {
      s.token = await certLogin(s.pem);
      const me = await api(s).get('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.data).toEqual({ email: s.user.email, isAdmin: true });
    }
  });

  it('2. each participant sees its seeded organization and both endpoints', async () => {
    for (const s of sites) {
      const own = await api(s).get(`/api/v1/instances/${s.instanceId}/organization`);
      expect(own.status).toBe(200);
      expect(own.body.data.identifier).toBe(org(s));
      const eps = await api(s).get(`/api/v1/instances/${s.instanceId}/endpoints`);
      expect(eps.body.data.map((e: { identifier: string }) => e.identifier).sort()).toEqual(
        [`bpe.${org(s)}`, s.fhirEndpoint].sort(),
      );
    }
  });

  it('3. before any approval the DSF download publishes none of the three sites', async () => {
    const bundle = await download(sites[0]);
    const orgs = organizationsIn(bundle);
    for (const s of sites) expect(orgs).not.toContain(org(s));
    expect(affiliation(bundle, 'PUT', hub, org(sites[0]), sites[0].fhirEndpoint)).toBeUndefined();
    expect(
      dsfAllowListViolations(bundle, {
        receiverOrganization: org(sites[0]),
        receiverEndpoint: sites[0].fhirEndpoint,
      }),
    ).toEqual([]);
  });

  it('4. four-eyes: every request is approved by the two other sites', async () => {
    for (let i = 0; i < sites.length; i++) {
      const requestId = await pendingRequestId(sites[i].instanceId);
      const status = await approveByTwo(requestId, sites[(i + 1) % 3], sites[(i + 2) % 3]);
      expect(status).toBe('APPROVED');
      // A further signature on a finalized request is refused.
      const late = await api(sites[i]).post(`/api/v1/admin/approval/${requestId}/approve`);
      expect(late.status).toBe(409);
    }
  });

  it('5. every site downloads exactly the two other sites in DSF shape', async () => {
    for (const s of sites) {
      const res = await dsfDownload(s.pem, s.fhirEndpoint);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/fhir\+json/);
      const bundle = res.body as Bundle;
      expect(
        dsfAllowListViolations(bundle, {
          receiverOrganization: org(s),
          receiverEndpoint: s.fhirEndpoint,
        }),
      ).toEqual([]);

      const orgs = organizationsIn(bundle);
      expect(orgs).not.toContain(org(s));
      expect(orgs.filter((id) => id === hub)).toHaveLength(1);
      for (const peer of sites.filter((o) => o !== s)) {
        const entry = entriesOf(bundle).find(
          (e) =>
            e.resource?.resourceType === 'Organization' &&
            e.resource.identifier?.[0]?.value === org(peer),
        );
        expect(entry?.resource?.extension).toEqual([
          { url: THUMBPRINT_URL, valueString: peer.user.fingerprintSha512 },
        ]);
        expect((entry?.resource?.endpoint as unknown[]).length).toBe(2);
        // The seed stores DIC and HRP as two memberships of the same triple.
        const oa = affiliation(bundle, 'PUT', hub, org(peer), peer.fhirEndpoint);
        expect(oa?.resource?.code).toEqual([
          { coding: [{ system: ROLE_SYSTEM, code: 'DIC' }] },
          { coding: [{ system: ROLE_SYSTEM, code: 'HRP' }] },
        ]);
      }

      const own = affiliation(bundle, 'PUT', hub, org(s), s.fhirEndpoint);
      expect(own?.resource?.participatingOrganization).toEqual({
        reference: `Organization?identifier=http://dsf.dev/sid/organization-identifier|${org(s)}`,
        type: 'Organization',
      });
      expect(own?.resource?.endpoint).toEqual([
        {
          reference: `Endpoint?identifier=http://dsf.dev/sid/endpoint-identifier|${s.fhirEndpoint}`,
          type: 'Endpoint',
        },
      ]);
    }
  });

  it('6. the GUI download of the endpoint is the same allow list as the DSF read', async () => {
    const s = sites[0];
    const gui = await api(s)
      .get(`/api/v1/instances/${s.instanceId}/download/bundle`)
      .query({ endpointId: s.fhirEndpoint });
    expect(gui.status).toBe(200);
    // Only this run's entries: parallel suites may publish other sites meanwhile.
    const ours = (b: Bundle) =>
      entriesOf(b)
        .map((e) => e.request.url)
        .filter((url) => url.includes(run));
    const fromGui = ours(JSON.parse(gui.text) as Bundle);
    const fromDsf = ours(await download(s));
    expect(fromGui.length).toBeGreaterThan(0);
    expect(fromGui).toEqual(fromDsf);
  });

  it('7. the DSF BPE may present a separate DSF certificate from the certificate list', async () => {
    const s = sites[1];
    const bpePem = makeCertPem(`dsf-bpe.${org(s)}`);
    const upload = await api(s).post(`/api/v1/instances/${s.instanceId}/certificates`, {
      pem: bpePem,
    });
    expect(upload.status).toBe(201);

    const bundle = await download(s, bpePem);
    expect(organizationsIn(bundle)).toEqual(expect.arrayContaining([org(sites[0]), org(sites[2])]));

    // The other sites now trust both certificates of that site.
    const seen = entriesOf(await download(sites[0])).find(
      (e) =>
        e.resource?.resourceType === 'Organization' && e.resource.identifier?.[0]?.value === org(s),
    );
    expect(
      (seen?.resource?.extension as Array<{ valueString: string }>)
        .map((x) => x.valueString)
        .sort(),
    ).toEqual([s.user.fingerprintSha512, sha512FingerprintFromPem(bpePem)].sort());
  });

  it('8. failure modes answer with FHIR OperationOutcomes the DSF client can read', async () => {
    const stranger = makeCertPem('dsf-client.not-registered.example.de');
    const unknown = await dsfDownload(stranger, sites[0].fhirEndpoint);
    expect(unknown.status).toBe(403);
    expect(unknown.headers['content-type']).toMatch(/^application\/fhir\+json/);
    expect(unknown.body.issue[0].code).toBe('forbidden');

    const noCert = await request(app).get(`/fhir/Bundle/${sites[0].fhirEndpoint}`);
    expect(noCert.status).toBe(401);
    expect(noCert.body.resourceType).toBe('OperationOutcome');

    // A site cannot read the allow list addressed to another site's endpoint.
    const foreign = await dsfDownload(sites[0].pem, sites[1].fhirEndpoint);
    expect(foreign.status).toBe(404);
    expect(foreign.body.issue[0].code).toBe('not-found');

    // A stolen access token without the certificate cannot approve.
    const requestId = (
      await db('approval_requests').where({ instance_id: sites[2].instanceId }).first()
    ).id as string;
    const stolen = await request(app)
      .post(`/api/v1/admin/approval/${requestId}/approve`)
      .set('Authorization', `Bearer ${sites[0].token}`)
      .set(mtlsHeaders(stranger))
      .send({});
    expect(stolen.status).toBe(401);
    expect(stolen.body.error.code).toBe('CERT_STEP_UP_FAILED');
  });
});
