/**
 * health-ready-loopback.test.ts – /health/ready (DB/Redis component status)
 * answers only loopback callers (the container healthcheck); everyone else
 * gets 404. /health stays public.
 * Dependencies: supertest, app, lib/loopback
 */
import request from 'supertest';
import type { Request, Response } from 'express';
import { app } from '../app';
import { isLoopbackAddress } from '../lib/loopback';

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts %s', (a) => {
    expect(isLoopbackAddress(a)).toBe(true);
  });
  it.each([undefined, '', '172.28.71.1', '::ffff:10.0.0.1', '127.0.0.2'])('rejects %s', (a) => {
    expect(isLoopbackAddress(a)).toBe(false);
  });
});

describe('GET /health/ready', () => {
  it('answers a loopback caller with component details', async () => {
    const res = await request(app).get('/health/ready');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('db');
    expect(res.body).toHaveProperty('redis');
  });

  it('answers a non-loopback caller with 404 and no details', async () => {
    const handler = (app as unknown as { handle: (q: Request, s: Response, n: () => void) => void })
      .handle;
    const body = await new Promise<{ status: number; json: unknown }>((resolve) => {
      const req = {
        method: 'GET',
        url: '/health/ready',
        originalUrl: '/health/ready',
        headers: {},
        socket: { remoteAddress: '172.28.71.5' },
        connection: { remoteAddress: '172.28.71.5' },
      } as unknown as Request;
      let status = 200;
      const res = {
        statusCode: 200,
        setHeader: () => res,
        getHeader: () => undefined,
        removeHeader: () => undefined,
        status(c: number) {
          status = c;
          return res;
        },
        json(j: unknown) {
          resolve({ status, json: j });
          return res;
        },
        end() {
          resolve({ status: status || res.statusCode, json: null });
        },
      } as unknown as Response;
      handler.call(app, req, res, () => resolve({ status: 0, json: null }));
    });
    expect(body.status).toBe(404);
    expect(JSON.stringify(body.json)).not.toMatch(/redis|db/);
  });

  it('keeps /health public', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
