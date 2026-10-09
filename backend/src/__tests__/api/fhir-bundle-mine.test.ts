/**
 * fhir-bundle-mine.test.ts – GET /fhir/Bundle/mine: one allow-list URL for every
 * site. The endpoint is derived from the certificate's organization (only
 * endpoint; else the only "fhir." one; else 409 AMBIGUOUS_ENDPOINT), the body is
 * identical to /fhir/Bundle/<endpoint>. Unknown certificate 401/403, no
 * endpoint 404. Both the DSF client certificate (certificates table) and an
 * org login certificate identify the organization.
 * Dependencies: supertest, app, db, helpers/allowListSites, bundle-versions.service
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { createSnapshot } from '../../services/bundle-versions.service';
import {
  makeCertPem,
  mtlsHeaders,
  removeSites,
  seedSite,
  type Site,
} from '../helpers/allowListSites';

describe('GET /fhir/Bundle/mine', () => {
  const sites: Site[] = [];
  const snapshots: string[] = [];
  let single: Site;
  let preferFhir: Site;
  let ambiguous: Site;
  let none: Site;

  beforeAll(async () => {
    single = await seedSite({ label: 'mine-single', loginCert: true });
    preferFhir = await seedSite({ label: 'mine-pref', endpoints: [null, null] });
    ambiguous = await seedSite({ label: 'mine-amb', endpoints: [null, null] });
    none = await seedSite({ label: 'mine-none' });
    sites.push(single, preferFhir, ambiguous, none);
    // Endpoint identifiers: dsf.<org> and dsf2.<org>. Replace the second by "fhir.<org>".
    await db('endpoints').where({ identifier: preferFhir.endpointIds[1] }).del();
    await db('endpoints').insert({
      identifier: `fhir.${preferFhir.orgId}`,
      organization_id: preferFhir.orgId,
      address: `https://fhir.${preferFhir.orgId}/fhir`,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('endpoints').where({ organization_id: none.orgId }).del();
    snapshots.push(
      (await createSnapshot({ triggeredBy: 'MANUAL', triggeredByEmail: single.email })).id,
    );
  });

  afterAll(async () => {
    await db('bundle_versions').whereIn('id', snapshots).del();
    for (const s of sites) await db('audit_logs').where({ instance_id: s.instanceId }).del();
    await removeSites(sites);
  });

  // The bundle's urn:uuid placeholders are generated per response.
  const norm = (body: string) => body.replace(/urn:uuid:[0-9a-f-]+/g, 'urn:uuid:X');
  const mine = (pem: string) => request(app).get('/fhir/Bundle/mine').set(mtlsHeaders(pem));

  it('serves the same body as the per-endpoint route for a single-endpoint site', async () => {
    const a = await mine(single.certPem!);
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toMatch(/^application\/fhir\+json/);
    const b = await request(app)
      .get(`/fhir/Bundle/${single.endpointIds[0]}`)
      .set(mtlsHeaders(single.certPem!));
    expect(b.status).toBe(200);
    expect(norm(a.text)).toBe(norm(b.text));
    expect(a.headers.etag).toBe(b.headers.etag);
  });

  it('also identifies the site by its login certificate and answers 304 to a matching ETag', async () => {
    const a = await mine(single.loginCertPem!);
    expect(a.status).toBe(200);
    const cond = await request(app)
      .get('/fhir/Bundle/mine')
      .set(mtlsHeaders(single.loginCertPem!))
      .set('If-None-Match', a.headers.etag);
    expect(cond.status).toBe(304);
  });

  it('prefers the single endpoint whose identifier starts with fhir.', async () => {
    const res = await mine(preferFhir.certPem!);
    expect(res.status).toBe(200);
    const direct = await request(app)
      .get(`/fhir/Bundle/fhir.${preferFhir.orgId}`)
      .set(mtlsHeaders(preferFhir.certPem!));
    expect(norm(res.text)).toBe(norm(direct.text));
  });

  it('answers 409 AMBIGUOUS_ENDPOINT listing the endpoints when several remain', async () => {
    const res = await mine(ambiguous.certPem!);
    expect(res.status).toBe(409);
    expect(res.body.resourceType).toBe('OperationOutcome');
    const text = res.body.issue[0].diagnostics as string;
    expect(text).toContain('AMBIGUOUS_ENDPOINT');
    for (const id of ambiguous.endpointIds) expect(text).toContain(id);
  });

  it('answers 404 when the organization has no endpoint', async () => {
    const res = await mine(none.certPem!);
    expect(res.status).toBe(404);
    expect(res.body.resourceType).toBe('OperationOutcome');
  });

  it('refuses an unknown certificate and a missing one', async () => {
    expect((await mine(makeCertPem('unknown-mine.example.de'))).status).toBe(403);
    expect((await request(app).get('/fhir/Bundle/mine')).status).toBe(401);
  });

  it('writes an audit entry naming the derived endpoint', async () => {
    await mine(single.certPem!);
    const rows = await db('audit_logs').where({
      instance_id: single.instanceId,
      resource_id: single.endpointIds[0],
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});
