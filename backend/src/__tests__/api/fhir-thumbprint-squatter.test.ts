/**
 * fhir-thumbprint-squatter.test.ts – organizations.client_cert_thumbprint is
 * tenant-editable. A site that claims the SHA-256 of another site's registered
 * DSF certificate must neither receive that site's /fhir requests nor lock it
 * out: the legacy thumbprint match only counts when no other organization
 * registered the certificate, and an ambiguous legacy match falls through to
 * the certificate list. Uploading a certificate another organization claims
 * as its client_cert_thumbprint is refused like any certificate held elsewhere.
 * Dependencies: supertest, app, db, certificate.service, helpers/allowListSites
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { createCertificate } from '../../services/certificate.service';
import {
  makeCertPem,
  mtlsHeaders,
  removeSites,
  seedSite,
  sha256Thumbprint,
  type Site,
} from '../helpers/allowListSites';

describe('/fhir legacy thumbprint claim of another site’s certificate', () => {
  const sites: Site[] = [];
  let victim: Site;
  let squatter: Site;

  beforeAll(async () => {
    victim = await seedSite({ label: 'sq-victim' });
    squatter = await seedSite({ label: 'sq-squat', certificate: false });
    sites.push(victim, squatter);
    await db('organizations')
      .where({ identifier: squatter.orgId })
      .update({ client_cert_thumbprint: sha256Thumbprint(victim.certPem!) });
  });

  afterAll(async () => {
    for (const s of sites) await db('audit_logs').where({ instance_id: s.instanceId }).del();
    await removeSites(sites);
  });

  const fetchVictimBundle = () =>
    request(app).get(`/fhir/Bundle/${victim.endpointIds[0]}`).set(mtlsHeaders(victim.certPem!));

  it('resolves the certificate to the site that registered it, not the claimant', async () => {
    expect((await fetchVictimBundle()).status).toBe(200);
  });

  it('falls through to the certificate list when the legacy claim is ambiguous', async () => {
    await db('organizations')
      .where({ identifier: victim.orgId })
      .update({ client_cert_thumbprint: sha256Thumbprint(victim.certPem!) });
    expect((await fetchVictimBundle()).status).toBe(200);
  });
});

describe('certificate upload vs. client_cert_thumbprint of another site', () => {
  const sites: Site[] = [];

  afterAll(async () => {
    for (const s of sites) await db('audit_logs').where({ instance_id: s.instanceId }).del();
    await removeSites(sites);
  });

  it('refuses a certificate another organization claims as client_cert_thumbprint', async () => {
    const owner = await seedSite({ label: 'sq-claim', certificate: false });
    const uploader = await seedSite({ label: 'sq-upload', certificate: false });
    sites.push(owner, uploader);
    const pem = makeCertPem(`dsf-client.${owner.orgId}`);
    await db('organizations')
      .where({ identifier: owner.orgId })
      .update({ client_cert_thumbprint: sha256Thumbprint(pem).toUpperCase() });

    await expect(
      createCertificate(uploader.instanceId, pem, uploader.email, '127.0.0.1', false),
    ).rejects.toThrow('CERT_REGISTERED_ELSEWHERE');
  });
});
