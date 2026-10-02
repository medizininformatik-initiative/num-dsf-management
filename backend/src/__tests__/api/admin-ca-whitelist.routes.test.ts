/**
 * admin-ca-whitelist.routes.test.ts – Admin API for the CA whitelist:
 * listing the DSF defaults seeded at init, adding and removing entries with
 * the certificate step-up, refusing non-admins, and the blacklist refusing a
 * whitelisted CA (409 CA_WHITELISTED).
 * Dependencies: supertest, app, db/connection, helpers/hackathon, helpers/auth,
 *               helpers/allowListSites
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';
import { removeSites, seedSite, type Site } from '../helpers/allowListSites';
import {
  api,
  certLogin,
  hackathonManifest,
  removeParticipants,
  seedParticipants,
  type Participant,
} from '../helpers/hackathon';

const GEANT_TLS_RSA = 'C=GR,O=Hellenic Academic and Research Institutions CA,CN=GEANT TLS RSA 1';

describe('/api/v1/admin/ca-whitelist', () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const manifest = hackathonManifest(1, run);
  let admin: Participant;
  let siteUser: Site;

  beforeAll(async () => {
    [admin] = await seedParticipants(manifest);
    admin.token = await certLogin(admin.pem);
    siteUser = await seedSite({ label: 'caw-user', approval: null });
  });

  afterAll(async () => {
    await db('ca_whitelist').where({ added_by: admin.user.email }).del();
    await removeParticipants([admin.user.email], [admin.user.orgIdentifier]);
    await removeSites([siteUser]);
  });

  it('lists the DSF defaults seeded at init and whether uploads are enforced', async () => {
    const res = await api(admin).get('/api/v1/admin/ca-whitelist');
    expect(res.status).toBe(200);
    expect(res.body.data.enforced).toBe(false);
    const dns = (res.body.data.whitelist as Array<{ subject_dn: string; source: string }>)
      .filter((r) => r.source === 'dsf-2.1.1')
      .map((r) => r.subject_dn);
    expect(dns).toContain(GEANT_TLS_RSA);
  });

  it('adds and removes a manual entry with the certificate step-up', async () => {
    const subjectDn = `C=DE,O=Uniklinik CA ${run},CN=Uniklinik Issuing CA`;
    const added = await api(admin).post('/api/v1/admin/ca-whitelist', {
      subjectDn,
      kind: 'CLIENT',
      reason: 'site CA',
    });
    expect(added.status).toBe(201);
    const duplicate = await api(admin).post('/api/v1/admin/ca-whitelist', { subjectDn });
    expect(duplicate.status).toBe(409);
    const removed = await api(admin).del(`/api/v1/admin/ca-whitelist/${added.body.data.id}`);
    expect(removed.status).toBe(200);
    const again = await api(admin).del(`/api/v1/admin/ca-whitelist/${added.body.data.id}`);
    expect(again.status).toBe(404);
  });

  it('refuses non-admins', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ca-whitelist')
      .set('Authorization', `Bearer ${getTestToken(siteUser.email, siteUser.userId)}`);
    expect(res.status).toBe(403);
  });

  it('refuses to blacklist a CA that is on the whitelist', async () => {
    const res = await api(admin).post('/api/v1/admin/ca-blacklist', {
      subjectDn: GEANT_TLS_RSA,
      reason: 'test',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CA_WHITELISTED');
  });
});
