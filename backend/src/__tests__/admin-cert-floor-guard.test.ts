/**
 * admin-cert-floor-guard.test.ts – One admin may remove another admin's
 * certificate (step-up, effective at once), but never the last way back in:
 * the removal is refused with LAST_OTHER_ADMIN_CERT when afterwards no admin
 * other than the acting one would still hold a valid (unexpired) certificate
 * on an unlocked, whitelisted account. Removing one's own certificate and the
 * server CLI (the emergency path) are not restricted. Demoting an admin
 * removes their admin certificates under the same guard. Every removal mails
 * the affected admin and all other admins, naming the actor.
 * Dependencies: db, lib/adminGrants (listVerifiedAdminEmails spied to this
 *               suite's admins), admin-certificates.service, admin-users.service,
 *               notification.service (mocked)
 */
jest.mock('../services/notification.service', () => ({
  ...jest.requireActual('../services/notification.service'),
  sendAdminCertChangedEmail: jest.fn().mockResolvedValue(undefined),
}));

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import * as grants from '../lib/adminGrants';
import { signGrant } from '../lib/adminGrants';
import { removeAdminCertificate } from '../services/admin-certificates.service';
import { demoteAdmin } from '../services/admin-users.service';
import { sendAdminCertChangedEmail } from '../services/notification.service';

const mail = sendAdminCertChangedEmail as jest.Mock;
const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const actor = `floor-a-${sfx}@site-a-${sfx}.example.de`;
const target = `floor-b-${sfx}@site-b-${sfx}.example.de`;
const third = `floor-c-${sfx}@site-c-${sfx}.example.de`;
const admins = [actor, target, third];
const DAY = 24 * 3600 * 1000;

async function addCert(email: string, validUntil: Date | null = new Date(Date.now() + 30 * DAY)) {
  const id = uuidv4();
  await db('admin_cert_fingerprints').insert({
    id,
    email,
    fingerprint: crypto.createHash('sha512').update(id).digest('hex'),
    valid_until: validUntil,
    created_by: 'test',
    created_at: new Date(),
  });
  return id;
}

const certsOf = (email: string) => db('admin_cert_fingerprints').where({ email }).pluck('id');

async function reset(): Promise<void> {
  await db('admin_cert_fingerprints').whereIn('email', admins).del();
  await db('email_whitelist').whereIn('email', admins).update({ locked_at: null, locked_by: null });
  for (const email of admins) {
    if (!(await db('admin_grants').where({ email }).first())) {
      const at = new Date(Math.floor(Date.now() / 1000) * 1000);
      await db('admin_grants').insert({
        email,
        granted_at: at,
        granted_by_a: 'SYSTEM:test',
        granted_by_b: 'SYSTEM:test',
        signature_hex: signGrant(email, at, 'SYSTEM:test', 'SYSTEM:test'),
      });
    }
  }
  mail.mockClear();
}

beforeAll(async () => {
  for (const email of admins) {
    await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
  }
});

beforeEach(async () => {
  await reset();
  // Only this suite's admins count; the shared test DB holds others.
  jest.spyOn(grants, 'listVerifiedAdminEmails').mockResolvedValue([...admins]);
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await db('admin_cert_fingerprints').whereIn('email', admins).del();
  await db('admin_grants').whereIn('email', admins).del();
  await db('email_whitelist').whereIn('email', admins).del();
  await db('audit_logs').whereIn('user_email', admins).del();
});

const removeTargetCert = (id: string, by = actor) =>
  removeAdminCertificate({ email: target, id, actor: by, ip: '127.0.0.1', self: false });

describe('LAST_OTHER_ADMIN_CERT floor guard', () => {
  it("blocks removing another admin's certificate when no third admin holds a valid one", async () => {
    await addCert(actor);
    const id = await addCert(target);
    await addCert(third, new Date(Date.now() - DAY)); // expired: does not count
    await expect(removeTargetCert(id)).rejects.toMatchObject({ code: 'LAST_OTHER_ADMIN_CERT' });
    expect(await certsOf(target)).toEqual([id]);
  });

  it('does not count a locked admin', async () => {
    const id = await addCert(target);
    await addCert(third);
    await db('email_whitelist').where({ email: third }).update({ locked_at: new Date() });
    await expect(removeTargetCert(id)).rejects.toMatchObject({ code: 'LAST_OTHER_ADMIN_CERT' });
  });

  it('allows the removal when a third admin keeps a valid certificate', async () => {
    const id = await addCert(target);
    await addCert(third);
    await removeTargetCert(id);
    expect(await certsOf(target)).toEqual([]);
  });

  it("allows the target's other certificate to keep the floor", async () => {
    const id = await addCert(target);
    await addCert(target);
    await removeTargetCert(id);
    expect(await certsOf(target)).toHaveLength(1);
  });

  it('does not restrict removing one’s own certificate', async () => {
    const own = await addCert(actor);
    await addCert(actor);
    await removeAdminCertificate({ email: actor, id: own, actor, ip: '127.0.0.1', self: true });
    expect(await certsOf(actor)).toHaveLength(1);
  });

  it('does not restrict the server CLI', async () => {
    const id = await addCert(target);
    await removeTargetCert(id, 'server-cli');
    expect(await certsOf(target)).toEqual([]);
  });
});

describe('removal notices', () => {
  it('mail the affected admin and every other admin, naming the actor', async () => {
    const id = await addCert(target);
    await addCert(third);
    await removeTargetCert(id);

    const calls = mail.mock.calls as Array<[string, Record<string, unknown>]>;
    expect(calls.map((c) => c[0]).sort()).toEqual([...admins].sort());
    for (const [to, opts] of calls) {
      expect(opts).toMatchObject({ change: 'remove', byAdmin: actor });
      if (to === target) expect(opts.targetEmail).toBeUndefined();
      else expect(opts.targetEmail).toBe(target);
    }
  });
});

describe('demoteAdmin', () => {
  it('removes the demoted admin’s certificates', async () => {
    await addCert(target);
    await addCert(third);
    await demoteAdmin(target, actor, '127.0.0.1');
    expect(await certsOf(target)).toEqual([]);
    expect(mail.mock.calls.map((c) => c[0])).toContain(target);
  });

  it('is refused by the floor guard and then changes nothing', async () => {
    const id = await addCert(target);
    await expect(demoteAdmin(target, actor, '127.0.0.1')).rejects.toMatchObject({
      code: 'LAST_OTHER_ADMIN_CERT',
    });
    expect(await certsOf(target)).toEqual([id]);
    expect(await db('admin_grants').where({ email: target }).first()).toBeDefined();
  });
});
