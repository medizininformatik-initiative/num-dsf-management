/**
 * onboarding-existing-login.test.ts – A re-import must not let one admin
 * silently give an EXISTING organization a login certificate whose key he may
 * hold. Like enabling a login certificate in the portal, a new login
 * fingerprint for an existing organization is only accepted when it belongs
 * to a certificate the clinic itself uploaded; otherwise the row fails with
 * NOT_CLINIC_UPLOADED and nothing changes. The notice about an accepted change
 * also reaches the addresses the organization had BEFORE the import.
 * Dependencies: db, onboarding.service, notification.service (mocked),
 *               lib/certFingerprint, helpers/allowListSites (makeCertPem)
 */
jest.mock('../services/notification.service', () => ({
  ...jest.requireActual('../services/notification.service'),
  sendOrgLoginCertificateChangedEmail: jest.fn().mockResolvedValue(undefined),
}));

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { importSites, onboardingRowSchema } from '../services/onboarding.service';
import { sendOrgLoginCertificateChangedEmail } from '../services/notification.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { makeCertPem } from './helpers/allowListSites';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ACTOR = `importer-el-${sfx}@imi-test.example.de`;
const IP = '127.0.0.1';
const mail = sendOrgLoginCertificateChangedEmail as jest.Mock;

const randomFp = () => (uuidv4() + uuidv4() + uuidv4() + uuidv4()).replace(/-/g, '');

function row(identifier: string, contactEmail: string, fingerprint: string) {
  return onboardingRowSchema.parse({
    organizationIdentifier: identifier,
    organizationName: 'Existing Login Org',
    contactEmail,
    clientCertFingerprint: fingerprint,
  });
}

/** Store a certificate for the organization and return its SHA-512 fingerprint. */
async function uploadCert(identifier: string, byAdmin: boolean): Promise<string> {
  const pem = makeCertPem(`login-${uuidv4().slice(0, 8)}.${identifier}`);
  await db('certificates').insert({
    id: uuidv4(),
    organization_id: identifier,
    pem,
    subject: 'test',
    thumbprint: uuidv4().replace(/-/g, '').padEnd(64, '0'),
    valid_until: new Date('2035-01-01'),
    created_at: new Date(),
    uploaded_by: 'test',
    uploaded_by_admin: byAdmin ? 1 : 0,
  });
  return sha512FingerprintFromPem(pem);
}

const emails: string[] = [];
const ids: string[] = [];

async function existingOrg(label: string) {
  const id = `el-${label}-${sfx}.example.de`;
  const email = `el-${label}-${sfx}@example.de`;
  emails.push(email);
  ids.push(id);
  const firstFp = randomFp();
  await importSites([row(id, email, firstFp)], ACTOR, IP);
  return { id, email, firstFp };
}

const logins = (id: string) =>
  db('org_login_certificates').where({ organization_id: id }).pluck('fingerprint');

afterAll(async () => {
  for (const id of ids) {
    const org = await db('organizations').where({ identifier: id }).first();
    await db('org_login_certificates').where({ organization_id: id }).del();
    await db('certificates').where({ organization_id: id }).del();
    await db('organizations').where({ identifier: id }).del();
    if (org) await db('instances').where({ id: org.instance_id }).del();
  }
  await db('users').whereIn('email', emails).del();
  await db('email_whitelist').whereIn('email', emails).del();
});

describe('re-import of an existing organization', () => {
  it('refuses a new login fingerprint that is no clinic-uploaded certificate', async () => {
    const { id, email, firstFp } = await existingOrg('foreign');
    const res = await importSites([row(id, email, randomFp())], ACTOR, IP);
    expect(res.rows[0]).toMatchObject({ ok: false, issue: 'NOT_CLINIC_UPLOADED' });
    expect(await logins(id)).toEqual([firstFp]);
  });

  it('refuses the fingerprint of a certificate an admin uploaded', async () => {
    const { id, email, firstFp } = await existingOrg('adminup');
    const fp = await uploadCert(id, true);
    const res = await importSites([row(id, email, fp)], ACTOR, IP);
    expect(res.rows[0]).toMatchObject({ ok: false, issue: 'NOT_CLINIC_UPLOADED' });
    expect(await logins(id)).toEqual([firstFp]);
  });

  it('does not change the organization e-mail when the row is refused', async () => {
    const { id, email } = await existingOrg('mailkeep');
    const other = `el-mailkeep-new-${sfx}@example.de`;
    emails.push(other);
    await importSites([row(id, other, randomFp())], ACTOR, IP);
    expect((await db('organizations').where({ identifier: id }).first()).email).toBe(email);
  });

  it('accepts the fingerprint of a certificate the clinic uploaded', async () => {
    const { id, email } = await existingOrg('clinic');
    const fp = await uploadCert(id, false);
    const res = await importSites([row(id, email, fp)], ACTOR, IP);
    expect(res.rows[0]).toMatchObject({ ok: true, action: 'updated' });
    expect(await logins(id)).toEqual([fp]);
  });

  it('keeps accepting an unchanged re-import', async () => {
    const { id, email, firstFp } = await existingOrg('same');
    const res = await importSites([row(id, email, firstFp)], ACTOR, IP);
    expect(res.rows[0]).toMatchObject({ ok: true, action: 'updated' });
  });

  it('notifies the addresses from before the import as well as the new one', async () => {
    const { id, email } = await existingOrg('notify');
    const fp = await uploadCert(id, false);
    const newEmail = `el-notify-new-${sfx}@example.de`;
    emails.push(newEmail);
    mail.mockClear();

    await importSites([row(id, newEmail, fp)], ACTOR, IP);

    expect(mail).toHaveBeenCalled();
    for (const call of mail.mock.calls) {
      expect(call[0]).toEqual(expect.arrayContaining([email, newEmail]));
    }
  });
});
