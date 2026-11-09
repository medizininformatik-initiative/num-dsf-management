/**
 * fhir-thumbprint-ambiguity.test.ts – /fhir identifies a site by
 * organizations.client_cert_thumbprint only when exactly one organization
 * claims it; a second organization claiming the same SHA-256 makes the match
 * ambiguous and the request is refused (403), like the certificate fallback.
 * The organization schema accepts only 64 hex characters for the thumbprint.
 * Dependencies: supertest, app, db, helpers/allowListSites, organization.schema
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { upsertOrganizationSchema } from '../../schemas/organization.schema';
import {
  makeCertPem,
  mtlsHeaders,
  removeSites,
  seedSite,
  sha256Thumbprint,
  type Site,
} from '../helpers/allowListSites';

describe('/fhir client_cert_thumbprint match', () => {
  const sites: Site[] = [];
  let victim: Site;
  let squatter: Site;
  const pem = makeCertPem(`thumb-victim-${Date.now().toString(36)}.example.de`);

  beforeAll(async () => {
    victim = await seedSite({ label: 'thumb-victim', certificate: false });
    squatter = await seedSite({ label: 'thumb-squat', certificate: false });
    sites.push(victim, squatter);
    await db('organizations')
      .where({ identifier: victim.orgId })
      .update({ client_cert_thumbprint: sha256Thumbprint(pem) });
  });

  afterAll(async () => {
    for (const s of sites) await db('audit_logs').where({ instance_id: s.instanceId }).del();
    await removeSites(sites);
  });

  const mine = () => request(app).get('/fhir/Bundle/mine').set(mtlsHeaders(pem));

  it('resolves a thumbprint exactly one organization claims', async () => {
    expect((await mine()).status).toBe(200);
  });

  it('refuses a thumbprint that two organizations claim', async () => {
    await db('organizations')
      .where({ identifier: squatter.orgId })
      .update({ client_cert_thumbprint: sha256Thumbprint(pem) });

    expect((await mine()).status).toBe(403);
  });
});

describe('upsertOrganizationSchema clientCertThumbprint', () => {
  const base = { identifier: 'ukm.example.de', name: 'UKM', email: 'admin@ukm.example.de' };
  const parse = (clientCertThumbprint: unknown) =>
    upsertOrganizationSchema.safeParse({ ...base, clientCertThumbprint }).success;

  it('accepts 64 hex characters, empty and null', () => {
    expect(parse('ab'.repeat(32))).toBe(true);
    expect(parse('AB'.repeat(32))).toBe(true);
    expect(parse('')).toBe(true);
    expect(parse(null)).toBe(true);
  });

  it('rejects other values', () => {
    expect(parse('a'.repeat(63))).toBe(false);
    expect(parse('g'.repeat(64))).toBe(false);
    expect(parse('a'.repeat(128))).toBe(false);
    expect(parse('not a thumbprint')).toBe(false);
  });
});
