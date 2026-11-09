/**
 * organization-thumbprint-unique.test.ts – A site may not claim a
 * client_cert_thumbprint that another organization already uses, either as its
 * own client_cert_thumbprint or as the SHA-256 of a registered certificate
 * (409 THUMBPRINT_IN_USE, compared case-insensitively). Prevents a squatter
 * from locking a clinic out of /fhir or capturing its identity.
 * Dependencies: express, supertest, db, organization.routes (auth and TOTP mocked)
 */
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';

jest.mock('../middleware/auth.middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../services/totp.service', () => ({
  verifyTotpCode: jest.fn().mockResolvedValue(true),
  isDevTotpBypassActive: jest.fn().mockReturnValue(false),
}));

import { organizationRouter } from '../routes/organization.routes';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const hex = (c: string) =>
  `${c}${sfx}`
    .replace(/[^0-9a-f]/g, '0')
    .padEnd(64, c)
    .slice(0, 64);

interface Site {
  userId: string;
  email: string;
  instanceId: string;
  org: string;
}

async function makeSite(label: string, thumbprint: string | null): Promise<Site> {
  const site = {
    userId: uuidv4(),
    email: `tpu-${label}-${sfx}@example.de`,
    instanceId: uuidv4(),
    org: `tpu-${label}-${sfx}.example.de`,
  };
  await db('users').insert({
    id: site.userId,
    email: site.email,
    totp_enabled: true,
    totp_secret: 'placeholder',
    created_at: new Date(),
  });
  await db('instances').insert({
    id: site.instanceId,
    user_id: site.userId,
    label: site.org,
    created_at: new Date(),
  });
  await db('organizations').insert({
    identifier: site.org,
    instance_id: site.instanceId,
    name: site.org,
    email: site.email,
    active: true,
    client_cert_thumbprint: thumbprint,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return site;
}

function put(site: Site, clientCertThumbprint: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { id: site.userId, email: site.email };
    next();
  });
  app.use('/api/v1/instances/:id/organization', organizationRouter);
  return request(app).put(`/api/v1/instances/${site.instanceId}/organization`).send({
    identifier: site.org,
    name: site.org,
    active: true,
    email: site.email,
    clientCertThumbprint,
    totpCode: '123456',
  });
}

describe('PUT /organization – client_cert_thumbprint must be unused by other organizations', () => {
  const sites: Site[] = [];
  const claimed = hex('a');
  const registered = hex('b');
  let victim: Site;
  let squatter: Site;

  beforeAll(async () => {
    victim = await makeSite('victim', claimed);
    squatter = await makeSite('squatter', null);
    sites.push(victim, squatter);
    await db('certificates').insert({
      id: uuidv4(),
      organization_id: victim.org,
      pem: 'not-parsed-in-this-test',
      subject: 'CN=victim',
      thumbprint: registered.toUpperCase(),
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    for (const s of sites) {
      await db('audit_logs').where({ instance_id: s.instanceId }).del();
      await db('instances').where({ id: s.instanceId }).del();
      await db('organizations').where({ identifier: s.org }).del();
      await db('users').where({ id: s.userId }).del();
    }
  });

  it("refuses another organization's client_cert_thumbprint, in any case", async () => {
    for (const value of [claimed, claimed.toUpperCase()]) {
      const res = await put(squatter, value);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('THUMBPRINT_IN_USE');
    }
    const row = await db('organizations').where({ identifier: squatter.org }).first();
    expect(row.client_cert_thumbprint).toBeNull();
  });

  it("refuses the SHA-256 of another organization's registered certificate", async () => {
    const res = await put(squatter, registered);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('THUMBPRINT_IN_USE');
  });

  it('accepts an unused thumbprint and an unchanged re-save', async () => {
    expect((await put(squatter, hex('c'))).status).toBe(200);
    expect((await put(victim, claimed)).status).toBe(200);
  });
});
