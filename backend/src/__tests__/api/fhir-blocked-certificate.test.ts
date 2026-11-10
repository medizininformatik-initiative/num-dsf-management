/**
 * fhir-blocked-certificate.test.ts – A client certificate blocked by an
 * incident never fetches the allow list, whichever lookup would match it
 * (registered certificate list or the legacy SHA-256 client_cert_thumbprint).
 * Dependencies: supertest, app, db, uuid, incident-blocks.service,
 *               lib/certFingerprint, helpers/allowListSites
 */
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { blockFingerprints } from '../../services/incident-blocks.service';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { mtlsHeaders, removeSites, seedSite, type Site } from '../helpers/allowListSites';

const sites: Site[] = [];
const incidentIds: string[] = [];

async function block(site: Site, pem: string): Promise<void> {
  const id = uuidv4();
  const now = new Date();
  await db('incidents').insert({
    id,
    organization_id: site.orgId,
    title: 'test',
    description: 'test',
    status: 'CONFIRMED',
    reported_by: 'test@imi-test.example.de',
    reported_at: now,
    detected_at: now,
  });
  incidentIds.push(id);
  await blockFingerprints(db, [sha512FingerprintFromPem(pem)], id, 'test');
}

afterAll(async () => {
  await db('blocked_certificate_thumbprints').whereIn('incident_id', incidentIds).del();
  await db('incidents').whereIn('id', incidentIds).del();
  for (const s of sites) await db('audit_logs').where({ instance_id: s.instanceId }).del();
  await removeSites(sites);
});

describe('/fhir with a blocked client certificate', () => {
  it('refuses a blocked certificate from the certificate list', async () => {
    const site = await seedSite({ label: 'fhir-blocked' });
    sites.push(site);
    const fetch = () =>
      request(app).get(`/fhir/Bundle/${site.endpointIds[0]}`).set(mtlsHeaders(site.certPem!));
    expect((await fetch()).status).toBe(200);
    await block(site, site.certPem!);
    expect((await fetch()).status).toBe(403);
  });

  it('refuses a blocked certificate matched by the legacy SHA-256 thumbprint', async () => {
    const site = await seedSite({ label: 'fhir-blocked-legacy', loginCert: true });
    sites.push(site);
    // Only the legacy client_cert_thumbprint still names the login certificate.
    await db('org_login_certificates').where({ organization_id: site.orgId }).del();
    const fetch = () =>
      request(app).get(`/fhir/Bundle/${site.endpointIds[0]}`).set(mtlsHeaders(site.loginCertPem!));
    expect((await fetch()).status).toBe(200);
    await block(site, site.loginCertPem!);
    expect((await fetch()).status).toBe(403);
  });
});
