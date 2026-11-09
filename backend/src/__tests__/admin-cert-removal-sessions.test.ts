/**
 * admin-cert-removal-sessions.test.ts – Removing an admin login certificate
 * ends the sessions of that admin (refresh tokens in Redis), in every
 * AUTH_MODE, as locking and demoting do. Other users' sessions stay.
 * Dependencies: db, redis.service, admin-certificates.service, helpers/allowListSites
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { redis } from '../services/redis.service';
import { removeAdminCertificate } from '../services/admin-certificates.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { makeCertPem } from './helpers/allowListSites';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `acr-admin-${sfx}@imi-test.example.de`;
const otherEmail = `acr-other-${sfx}@imi-test.example.de`;
const adminId = uuidv4();
const otherId = uuidv4();
const adminKey = `refresh:acr-${sfx}-admin`;
const otherKey = `refresh:acr-${sfx}-other`;

beforeAll(async () => {
  await db('users').insert([
    { id: adminId, email: adminEmail, totp_enabled: false, created_at: new Date() },
    { id: otherId, email: otherEmail, totp_enabled: false, created_at: new Date() },
  ]);
});

afterAll(async () => {
  await redis.del(adminKey, otherKey);
  await db('audit_logs').where({ resource_id: adminEmail }).del();
  await db('admin_cert_fingerprints').where({ email: adminEmail }).del();
  await db('users').whereIn('id', [adminId, otherId]).del();
});

describe('removing an admin certificate', () => {
  it.each(['cert', 'otp'])(
    'revokes the refresh tokens of that admin (AUTH_MODE=%s)',
    async (mode) => {
      const previous = process.env.AUTH_MODE;
      process.env.AUTH_MODE = mode;
      try {
        const id = uuidv4();
        await db('admin_cert_fingerprints').insert({
          id,
          email: adminEmail,
          fingerprint: sha512FingerprintFromPem(makeCertPem(`acr-${mode}.${sfx}`)),
          created_at: new Date(),
          created_by: 'test',
        });
        await redis.set(adminKey, adminId, 'EX', 600);
        await redis.set(otherKey, otherId, 'EX', 600);

        await removeAdminCertificate({
          email: adminEmail,
          id,
          actor: otherEmail,
          ip: '127.0.0.1',
          self: false,
        });

        expect(await redis.get(adminKey)).toBeNull();
        expect(await redis.get(otherKey)).toBe(otherId);
      } finally {
        if (previous === undefined) delete process.env.AUTH_MODE;
        else process.env.AUTH_MODE = previous;
      }
    },
  );
});
