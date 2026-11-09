/**
 * onboarding-login-notice.test.ts – A re-import that sets or replaces the
 * login certificate of an existing organization tells the clinic like any
 * other login change (mail + audit, actor = the importing admin). A new
 * organization and an unchanged re-import send no notice.
 * Dependencies: db, onboarding.service, notification.service (mocked)
 */
jest.mock('../services/notification.service', () => ({
  ...jest.requireActual('../services/notification.service'),
  sendOrgLoginCertificateChangedEmail: jest.fn().mockResolvedValue(undefined),
}));

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { importSites, onboardingRowSchema } from '../services/onboarding.service';
import { sendOrgLoginCertificateChangedEmail } from '../services/notification.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ACTOR = `importer-${sfx}@imi-test.example.de`;
const IP = '127.0.0.1';
const mail = sendOrgLoginCertificateChangedEmail as jest.Mock;

function fp(): string {
  return (uuidv4() + uuidv4() + uuidv4() + uuidv4()).replace(/-/g, '');
}

function row(identifier: string, contactEmail: string, fingerprint: string) {
  return onboardingRowSchema.parse({
    organizationIdentifier: identifier,
    organizationName: 'Notice Org',
    contactEmail,
    clientCertFingerprint: fingerprint,
  });
}

const emails: string[] = [];

afterAll(async () => {
  if (emails.length) {
    await db('users').whereIn('email', emails).del();
    await db('email_whitelist').whereIn('email', emails).del();
  }
});

describe('onboarding re-import of a login certificate', () => {
  it('mails nothing for a new organization', async () => {
    const id = `notice-new-${sfx}.example.de`;
    const email = `notice-new-${sfx}@example.de`;
    emails.push(email);
    mail.mockClear();

    await importSites([row(id, email, fp())], ACTOR, IP);

    expect(mail).not.toHaveBeenCalled();
  });

  it('tells the clinic when a re-import replaces the login certificate', async () => {
    const id = `notice-old-${sfx}.example.de`;
    const email = `notice-old-${sfx}@example.de`;
    emails.push(email);
    const oldFp = fp();
    const newFp = fp();
    await importSites([row(id, email, oldFp)], ACTOR, IP);

    mail.mockClear();
    await importSites([row(id, email, oldFp)], ACTOR, IP);
    expect(mail).not.toHaveBeenCalled();

    const res = await importSites([row(id, email, newFp)], ACTOR, IP);

    expect(res.rows[0]).toMatchObject({ action: 'updated', ok: true });
    expect(mail).toHaveBeenCalledWith(
      [email],
      expect.objectContaining({
        change: 'enable',
        byAdmin: ACTOR,
        fingerprintPrefix: newFp.slice(0, 16),
      }),
    );
    expect(mail).toHaveBeenCalledWith(
      [email],
      expect.objectContaining({
        change: 'disable',
        byAdmin: ACTOR,
        fingerprintPrefix: oldFp.slice(0, 16),
      }),
    );
    const audits = await db('audit_logs')
      .where({ resource_type: 'ORGANIZATION', resource_id: id, user_email: ACTOR })
      .whereRaw("JSON_EXTRACT(diff_json, '$.action') = 'login_certificate'")
      .pluck('diff_json');
    expect(audits).toHaveLength(2);
  });

  it('tells the clinic when a re-import sets a login for an organization without one', async () => {
    const id = `notice-set-${sfx}.example.de`;
    const email = `notice-set-${sfx}@example.de`;
    emails.push(email);
    await importSites([row(id, email, fp())], ACTOR, IP);
    await db('org_login_certificates').where({ organization_id: id }).del();
    const newFp = fp();

    mail.mockClear();
    await importSites([row(id, email, newFp)], ACTOR, IP);

    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledWith(
      [email],
      expect.objectContaining({ change: 'enable', byAdmin: ACTOR }),
    );
  });
});
