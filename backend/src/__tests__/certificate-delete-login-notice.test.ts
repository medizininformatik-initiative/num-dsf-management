/**
 * certificate-delete-login-notice.test.ts – Deleting an uploaded certificate
 * also ends the login entry linked to it (a deleted, possibly compromised
 * certificate must not keep logging in). That is a login change like any
 * other: the clinic is mailed and it is audited, never silent.
 * Dependencies: db, certificate.service, notification.service (mocked),
 *               lib/certFingerprint, helpers/allowListSites
 */
jest.mock('../services/notification.service', () => ({
  ...jest.requireActual('../services/notification.service'),
  sendOrgLoginCertificateChangedEmail: jest.fn().mockResolvedValue(undefined),
}));

import { db } from '../db/connection';
import { createCertificate, deleteCertificate } from '../services/certificate.service';
import { sendOrgLoginCertificateChangedEmail } from '../services/notification.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { makeCertPem, removeSites, seedSite, type Site } from './helpers/allowListSites';

const mail = sendOrgLoginCertificateChangedEmail as jest.Mock;

describe('deleting a certificate that is a login certificate', () => {
  let site: Site;

  beforeAll(async () => {
    site = await seedSite({ label: 'del-login', certificate: false, approval: null });
  });

  afterAll(async () => {
    await db('audit_logs').where({ instance_id: site.instanceId }).del();
    await removeSites([site]);
  });

  it('removes the login entry and tells the clinic', async () => {
    const pem = makeCertPem(`login.${site.orgId}`);
    const fingerprint = sha512FingerprintFromPem(pem);
    await db('org_login_certificates').insert({
      fingerprint,
      organization_id: site.orgId,
      certificate_id: null,
      source: 'ADMIN',
      created_by: 'test',
      created_at: new Date(),
    });
    const cert = await createCertificate(site.instanceId, pem, site.email, '127.0.0.1', false);
    expect((await db('org_login_certificates').where({ fingerprint }).first()).certificate_id).toBe(
      cert.id,
    );
    mail.mockClear();

    await deleteCertificate(site.instanceId, cert.id, site.email, '127.0.0.1');

    expect(await db('org_login_certificates').where({ fingerprint }).first()).toBeUndefined();
    expect(mail).toHaveBeenCalledWith(
      [site.email],
      expect.objectContaining({ change: 'disable', fingerprintPrefix: fingerprint.slice(0, 16) }),
    );
    const audit = await db('audit_logs')
      .where({ instance_id: site.instanceId, resource_type: 'ORGANIZATION' })
      .whereRaw("JSON_EXTRACT(diff_json, '$.action') = 'login_certificate'")
      .first();
    expect(audit).toBeDefined();
  });
});
