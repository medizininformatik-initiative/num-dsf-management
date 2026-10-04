/**
 * bundle-history.routes.test.ts – The published allow list is versioned:
 * - GET /fhir/Bundle/:endpoint serves the receiver view of the latest version
 *   (meta.versionId, ETag, Last-Modified), _history lists all versions newest
 *   first and _history/:vid reads an old one, all with the site's client
 *   certificate and only for its own endpoints;
 * - site users list the versions and download one (X-Bundle-Version);
 * - an admin restores an old version as a new, current one (step-up, 409 for
 *   versions without stored input).
 * Versions are global, so assertions name this run's organizations and the
 * explicit version numbers instead of "the latest overall".
 * Dependencies: supertest, app, db/connection, bundle-versions.service,
 *               helpers/allowListSites, helpers/hackathon, helpers/auth
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { createSnapshot } from '../../services/bundle-versions.service';
import { getTestToken } from '../helpers/auth';
import { mtlsHeaders, removeSites, seedSite, type Site } from '../helpers/allowListSites';
import {
  api,
  certLogin,
  hackathonManifest,
  removeParticipants,
  seedParticipants,
  type Participant,
} from '../helpers/hackathon';

interface Entry {
  fullUrl?: string;
  resource?: unknown;
  request: { method: string; url: string };
  response?: { status: string; etag: string; lastModified: string };
}
interface FhirBundle {
  resourceType: string;
  type: string;
  meta?: { versionId?: string; lastUpdated?: string };
  entry?: Entry[];
}

const FHIR = 'application/fhir+json';

describe('versioned allow list: /fhir history, GUI history, restore', () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  let a: Site;
  let b: Site;
  let admin: Participant;
  let v1 = 0;
  let v2 = 0;
  const versionIds: string[] = [];

  const read = (site: Site, path: string, as: Site = site) =>
    request(app)
      .get(`/fhir/Bundle/${site.endpointIds[0]}${path}`)
      .set('Accept', FHIR)
      .set(mtlsHeaders(as.certPem!));
  const orgsOf = (bundle: FhirBundle) =>
    (bundle.entry ?? [])
      .filter((e) => e.request.method === 'PUT' && e.request.url.startsWith('Organization?'))
      .map((e) => e.request.url.split('|')[1]);
  const snapshot = async () => {
    const s = await createSnapshot({ triggeredBy: 'MANUAL', triggeredByEmail: 'hist@example.de' });
    versionIds.push(s.id);
    return s;
  };

  beforeAll(async () => {
    a = await seedSite({
      label: 'hist-a',
      memberships: [{ parent: `hub-${run}.example.de`, roles: ['DIC'] }],
    });
    [admin] = await seedParticipants(hackathonManifest(1, run));
    admin.token = await certLogin(admin.pem);
    // v1: only A (and whatever other suites seeded); v2: B joined.
    v1 = (await snapshot()).versionNumber;
    b = await seedSite({ label: 'hist-b' });
    v2 = (await snapshot()).versionNumber;
  });

  afterAll(async () => {
    await db('bundle_versions').whereIn('id', versionIds).del();
    await db('bundle_versions').where('notes', 'like', `%${run}%`).del();
    await removeParticipants([admin.user.email], [admin.user.orgIdentifier]);
    await removeSites([a, b]);
  });

  describe('GET /fhir/Bundle/:endpointId (current version)', () => {
    it('carries versionId, lastUpdated, ETag and Last-Modified of the latest version', async () => {
      const res = await read(a, '');
      expect(res.status).toBe(200);
      const bundle = res.body as FhirBundle;
      const versionId = Number(bundle.meta?.versionId);
      expect(versionId).toBeGreaterThanOrEqual(v2);
      expect(res.headers.etag).toBe(`W/"${versionId}"`);
      expect(res.headers['last-modified']).toBeTruthy();
      expect(Number.isNaN(Date.parse(bundle.meta!.lastUpdated!))).toBe(false);
      expect(orgsOf(bundle)).toContain(b.orgId);
    });

    it('answers a conditional read with a matching ETag with 304', async () => {
      const first = await read(a, '');
      const again = await read(a, '').set('If-None-Match', first.headers.etag);
      expect(again.status).toBe(304);
    });
  });

  describe('GET /fhir/Bundle/:endpointId/_history', () => {
    it('lists the versions newest first as a history Bundle without resources', async () => {
      const res = await read(a, '/_history');
      expect(res.status).toBe(200);
      const bundle = res.body as FhirBundle;
      expect(bundle.resourceType).toBe('Bundle');
      expect(bundle.type).toBe('history');
      const numbers = (bundle.entry ?? []).map((e) => Number(e.request.url.split('/').pop()));
      expect(numbers).toEqual([...numbers].sort((x, y) => y - x));
      expect(numbers).toEqual(expect.arrayContaining([v1, v2]));
      const entry = bundle.entry!.find((e) => e.request.url.endsWith(`/_history/${v2}`))!;
      expect(entry.resource).toBeUndefined();
      expect(entry.request).toEqual({
        method: 'GET',
        url: `Bundle/${a.endpointIds[0]}/_history/${v2}`,
      });
      expect(entry.fullUrl).toMatch(
        new RegExp(`^https?://[^/]+/fhir/Bundle/${a.endpointIds[0]}/_history/${v2}$`),
      );
      expect(entry.response?.status).toBe('200');
      expect(entry.response?.etag).toBe(`W/"${v2}"`);
      expect(Number.isNaN(Date.parse(entry.response!.lastModified))).toBe(false);
    });

    it('honours _count', async () => {
      const res = await read(a, '/_history?_count=1');
      expect((res.body as FhirBundle).entry).toHaveLength(1);
    });
  });

  describe('GET /fhir/Bundle/:endpointId/_history/:vid', () => {
    it('returns the state of that version: B is absent in v1 and present in v2', async () => {
      const old = await read(a, `/_history/${v1}`);
      expect(old.status).toBe(200);
      expect((old.body as FhirBundle).meta?.versionId).toBe(String(v1));
      expect(old.headers.etag).toBe(`W/"${v1}"`);
      expect(orgsOf(old.body as FhirBundle)).not.toContain(b.orgId);

      const next = await read(a, `/_history/${v2}`);
      expect((next.body as FhirBundle).meta?.versionId).toBe(String(v2));
      expect(orgsOf(next.body as FhirBundle)).toContain(b.orgId);
    });

    it('is 404 for unknown versions and for versions without a stored input', async () => {
      const unknown = await read(a, '/_history/999999999');
      expect(unknown.status).toBe(404);
      expect(unknown.body.resourceType).toBe('OperationOutcome');
      expect((await read(a, '/_history/abc')).status).toBe(404);

      const legacy = await snapshot();
      await db('bundle_versions').where({ id: legacy.id }).update({ input_json: null });
      expect((await read(a, `/_history/${legacy.versionNumber}`)).status).toBe(404);
      const list = (await read(a, '/_history')).body as FhirBundle;
      expect(list.entry!.map((e) => e.request.url)).not.toContain(
        `Bundle/${a.endpointIds[0]}/_history/${legacy.versionNumber}`,
      );
      // A latest version without input would shadow the later tests (live fallback).
      await db('bundle_versions').where({ id: legacy.id }).del();
    });
  });

  describe('endpoint ownership', () => {
    it("refuses a certificate of org A on org B's endpoint (current, history, version)", async () => {
      for (const path of ['', '/_history', `/_history/${v2}`]) {
        const res = await read(b, path, a);
        expect(res.status).toBe(404);
        expect(res.body.resourceType).toBe('OperationOutcome');
      }
    });

    it('is 401 without a certificate', async () => {
      const res = await request(app).get(`/fhir/Bundle/${a.endpointIds[0]}/_history`);
      expect(res.status).toBe(401);
    });
  });

  describe('GUI: bundle-history and versioned download', () => {
    const token = () => getTestToken(a.email, a.userId);

    it('lists the readable versions with the current one flagged', async () => {
      const res = await request(app)
        .get(`/api/v1/instances/${a.instanceId}/bundle-history`)
        .query({ endpointId: a.endpointIds[0] })
        .set('Authorization', `Bearer ${token()}`);
      expect(res.status).toBe(200);
      const rows = res.body.data as Array<{
        versionNumber: number;
        createdAt: string;
        triggeredBy: string;
        notes: string | null;
        isCurrent: boolean;
      }>;
      expect(rows.map((r) => r.versionNumber)).toEqual(expect.arrayContaining([v1, v2]));
      expect(rows.find((r) => r.versionNumber === v1)?.triggeredBy).toBe('MANUAL');
      expect(rows.filter((r) => r.isCurrent).length).toBeLessThanOrEqual(1);
      expect(rows.find((r) => r.versionNumber === v1)?.isCurrent).toBe(false);
    });

    it("refuses another user's instance and unknown endpoints", async () => {
      const other = await request(app)
        .get(`/api/v1/instances/${a.instanceId}/bundle-history`)
        .query({ endpointId: a.endpointIds[0] })
        .set('Authorization', `Bearer ${getTestToken(b.email, b.userId)}`);
      expect(other.status).toBe(403);
      const unknown = await request(app)
        .get(`/api/v1/instances/${a.instanceId}/bundle-history`)
        .query({ endpointId: b.endpointIds[0] })
        .set('Authorization', `Bearer ${token()}`);
      expect(unknown.status).toBe(404);
      const missing = await request(app)
        .get(`/api/v1/instances/${a.instanceId}/bundle-history`)
        .set('Authorization', `Bearer ${token()}`);
      expect(missing.status).toBe(400);
    });

    it('downloads the current version by default and an old one with ?version=', async () => {
      const download = (version?: number) =>
        request(app)
          .get(`/api/v1/instances/${a.instanceId}/download/bundle`)
          .query({ endpointId: a.endpointIds[0], ...(version ? { version } : {}) })
          .set('Authorization', `Bearer ${token()}`);
      const current = await download();
      expect(current.status).toBe(200);
      expect(Number(current.headers['x-bundle-version'])).toBeGreaterThanOrEqual(v2);
      expect(current.headers['x-bundle-signature']).toBeTruthy();

      const old = await download(v1);
      expect(old.status).toBe(200);
      expect(old.headers['x-bundle-version']).toBe(String(v1));
      const body = JSON.parse(old.text) as FhirBundle;
      expect(body.meta?.versionId).toBe(String(v1));
      expect(orgsOf(body)).not.toContain(b.orgId);

      expect((await download(999999999)).status).toBe(404);
      const bad = await request(app)
        .get(`/api/v1/instances/${a.instanceId}/download/bundle`)
        .query({ endpointId: a.endpointIds[0], version: 'x' })
        .set('Authorization', `Bearer ${token()}`);
      expect(bad.status).toBe(400);
    });
  });

  describe('POST /api/v1/admin/bundle-versions/:id/restore', () => {
    const idOf = async (n: number) =>
      (await db('bundle_versions').where({ version_number: n }).first()).id as string;
    const restoreUrl = (id: string) => `/api/v1/admin/bundle-versions/${id}/restore`;

    it('refuses non-admins and a missing certificate step-up', async () => {
      const id = await idOf(v1);
      const nonAdmin = await request(app)
        .post(restoreUrl(id))
        .set('Authorization', `Bearer ${getTestToken(a.email, a.userId)}`)
        .send({ reason: 'not allowed' });
      expect(nonAdmin.status).toBe(403);
      // Admin token without the re-presented client certificate.
      const noStepUp = await request(app)
        .post(restoreUrl(id))
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ reason: 'no step up' });
      expect(noStepUp.status).toBe(401);
    });

    it('validates the reason and answers 404 / 409 for unknown or legacy versions', async () => {
      const id = await idOf(v1);
      expect((await api(admin).post(restoreUrl(id), { reason: 'x' })).status).toBe(400);
      expect(
        (
          await api(admin).post(restoreUrl('00000000-0000-4000-8000-000000000000'), {
            reason: 'abc',
          })
        ).status,
      ).toBe(404);

      const legacy = await snapshot();
      await db('bundle_versions').where({ id: legacy.id }).update({ input_json: null });
      const res = await api(admin).post(restoreUrl(legacy.id), { reason: 'old row' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_NOT_RESTORABLE');
      await db('bundle_versions').where({ id: legacy.id }).del();
    });

    it('creates a new current version from the old input and the FHIR read serves it', async () => {
      const res = await api(admin).post(restoreUrl(await idOf(v1)), {
        reason: `back to v1 ${run}`,
      });
      expect(res.status).toBe(201);
      const restored = Number(res.body.data.versionNumber);
      expect(restored).toBeGreaterThan(v2);
      versionIds.push(res.body.data.id);

      const row = await db('bundle_versions').where({ version_number: restored }).first();
      expect(row.triggered_by).toBe('RESTORE');
      expect(row.notes).toBe(`Restored from v${v1}: back to v1 ${run}`);
      expect(row.input_json).toBeTruthy();

      // Served by version number, independent of snapshots other suites create.
      const served = await read(a, `/_history/${restored}`);
      expect(served.status).toBe(200);
      expect(orgsOf(served.body as FhirBundle)).not.toContain(b.orgId);
      // The original versions stay readable.
      const stillThere = await read(a, `/_history/${v2}`);
      expect(orgsOf(stillThere.body as FhirBundle)).toContain(b.orgId);

      const list = await api(admin).get('/api/v1/admin/bundle-versions?limit=200');
      const found = (
        list.body.data as Array<{ version_number: number; restorable: boolean; isCurrent: boolean }>
      ).find((r) => r.version_number === restored);
      expect(found?.restorable).toBe(true);
      expect(typeof found?.isCurrent).toBe('boolean');
    });
  });
});
