/**
 * onboarding-foreign-certificate.test.ts – A certificate belongs to one
 * organization. The onboarding import must not make the SHA-512 fingerprint
 * of a certificate another organization registered the login of a different
 * site, in the import and in the dry run (FINGERPRINT_IN_USE), as uploads
 * already refuse it (CERT_REGISTERED_ELSEWHERE).
 * Dependencies: db, onboarding.service, lib/certFingerprint, helpers/allowListSites
 */
import { db } from '../db/connection';
import { importSites, onboardingRowSchema, previewSites } from '../services/onboarding.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const newId = `ob-foreign-${sfx}.example.de`;
const contact = `ob-foreign-${sfx}@example.de`;

describe('onboarding with another organization’s certificate', () => {
  let owner: Site;

  beforeAll(async () => {
    owner = await seedSite({ label: 'ob-owner', approval: null });
  });

  afterAll(async () => {
    const org = await db('organizations').where({ identifier: newId }).first();
    await db('organizations').where({ identifier: newId }).del();
    if (org) await db('instances').where({ id: org.instance_id }).del();
    await db('users').where({ email: contact }).del();
    await db('email_whitelist').where({ email: contact }).del();
    await db('audit_logs').where({ instance_id: owner.instanceId }).del();
    await removeSites([owner]);
  });

  it('refuses the fingerprint in the dry run and the import', async () => {
    const row = onboardingRowSchema.parse({
      organizationIdentifier: newId,
      organizationName: 'Foreign Cert Org',
      contactEmail: contact,
      clientCertFingerprint: sha512FingerprintFromPem(owner.certPem!),
    });

    const dry = await previewSites([row]);
    expect(dry.rows[0]).toMatchObject({ ok: false, issue: 'FINGERPRINT_IN_USE' });

    const res = await importSites([row], 'importer@imi-test.example.de', '127.0.0.1');
    expect(res.rows[0]).toMatchObject({ ok: false, issue: 'FINGERPRINT_IN_USE' });
    expect(await db('organizations').where({ identifier: newId }).first()).toBeUndefined();
  });
});
