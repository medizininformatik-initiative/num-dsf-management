/**
 * fhir-removed-site.test.ts – A site that was removed (instances.removed_at) no longer
 * authenticates on /fhir, whichever certificate lookup would match: the login list (SHA-512),
 * the legacy SHA-256 client_cert_thumbprint or the certificate list. The answer is the same
 * 403 as for an unknown certificate, for the bundle, /mine, _history, the network bundle and purge.
 * Dependencies: supertest, app, db, helpers/allowListSites
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { mtlsHeaders, removeSites, seedSite, type Site } from '../helpers/allowListSites';

const sites: Site[] = [];

afterAll(async () => {
  for (const s of sites) await db('audit_logs').where({ instance_id: s.instanceId }).del();
  await removeSites(sites);
});

async function paths(site: Site): Promise<string[]> {
  const ep = site.endpointIds[0];
  return [
    `/fhir/Bundle/${ep}`,
    '/fhir/Bundle/mine',
    `/fhir/Bundle/${ep}/_history`,
    `/fhir/Bundle/${ep}/purge`,
    '/fhir/Bundle',
  ];
}

describe('/fhir for a removed site', () => {
  it('refuses the certificate list match, the login-list match and the SHA-256 match', async () => {
    const site = await seedSite({ label: 'fhir-removed', loginCert: true });
    sites.push(site);
    const urls = await paths(site);
    // Alive: the certificate list match, the login-list match and the bundle all work.
    expect((await request(app).get(urls[0]).set(mtlsHeaders(site.certPem!))).status).toBe(200);
    expect((await request(app).get(urls[0]).set(mtlsHeaders(site.loginCertPem!))).status).toBe(200);

    await db('instances')
      .where({ id: site.instanceId })
      .update({ removed_at: new Date(), removed_by: 'admin@imi-test.example.de' });

    for (const url of urls) {
      for (const pem of [site.certPem!, site.loginCertPem!]) {
        const res = await request(app).get(url).set(mtlsHeaders(pem));
        expect([url, res.status]).toEqual([url, 403]);
      }
    }
    // Only the legacy client_cert_thumbprint names the login certificate.
    await db('org_login_certificates').where({ organization_id: site.orgId }).del();
    const legacy = await request(app).get(urls[0]).set(mtlsHeaders(site.loginCertPem!));
    expect(legacy.status).toBe(403);
  });
});
