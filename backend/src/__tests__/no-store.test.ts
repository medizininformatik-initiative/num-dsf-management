/**
 * no-store.test.ts – API, auth, FHIR and download responses must carry
 * no-store headers so browsers and proxies never serve stale incident or
 * approval data, and Express must not add automatic ETags.
 * The middleware runs before authentication, so the headers are asserted on
 * the 401 answers of protected routes as well.
 * Dependencies: supertest, express, app, middleware/noStore.middleware
 */
import express from 'express';
import request from 'supertest';
import { app } from '../app';
import { noStore } from '../middleware/noStore.middleware';

function expectNoStore(res: request.Response) {
  expect(res.headers['cache-control']).toBe('no-store, max-age=0');
  expect(res.headers['pragma']).toBe('no-cache');
  expect(res.headers['expires']).toBe('0');
  expect(res.headers['vary']).toMatch(/Authorization/);
  expect(res.headers['vary']).toMatch(/Cookie/);
  expect(res.headers['etag']).toBeUndefined();
}

describe('no-store headers', () => {
  it('on an /api GET route', async () => {
    const res = await request(app).get('/api/v1/incidents');
    expect(res.status).toBe(401);
    expectNoStore(res);
  });

  it('on an /auth route', async () => {
    const res = await request(app).get('/auth/me');
    expectNoStore(res);
  });

  it('on a download route', async () => {
    const res = await request(app).get('/api/v1/download/ip-address-list');
    expect(res.status).toBe(401);
    expectNoStore(res);
  });

  it('on a /fhir route', async () => {
    const res = await request(app).get('/fhir/Bundle/does-not-exist');
    expectNoStore(res);
  });

  it('on an unknown /api route (404)', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expectNoStore(res);
  });
});

describe('noStore middleware', () => {
  const mini = express();
  mini.set('etag', false);
  mini.use(noStore);
  mini.get('/file', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="x.xlsx"');
    res.send(Buffer.from('data'));
  });
  mini.get('/own', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({});
  });

  it('keeps Content-Disposition of a download and adds no ETag', async () => {
    const res = await request(mini).get('/file');
    expect(res.headers['content-disposition']).toBe('attachment; filename="x.xlsx"');
    expectNoStore(res);
  });

  it('lets a route override Cache-Control', async () => {
    const res = await request(mini).get('/own');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
