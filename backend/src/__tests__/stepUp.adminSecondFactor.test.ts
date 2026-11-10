/**
 * stepUp.adminSecondFactor.test.ts — checkStepUp for ADMIN certificate
 * sessions: the certificate alone is not enough, a 6-digit TOTP code or a TAN
 * (single-use backup code) is required as well. An admin who has not enrolled
 * gets 403 TOTP_ENROLMENT_REQUIRED. An OTP session also accepts a TAN.
 * (Org-scoped site sessions stay certificate-only: see stepUp.middleware.test.)
 *
 * Dependencies: uuid, speakeasy, node-forge, db/connection, totp.service,
 * lib/certFingerprint, middleware/stepUp.middleware.
 */
import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import speakeasy from 'speakeasy';
import forge from 'node-forge';
import { db } from '../db/connection';
import { saveTotpSecret, generateBackupCodes } from '../services/totp.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { checkStepUp } from '../middleware/stepUp.middleware';

function makeReq(
  userId: string,
  authMethod: 'otp' | 'cert',
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Request {
  return {
    user: { id: userId, email: 'stepup@example.de', authMethod },
    body,
    headers,
  } as unknown as Request;
}

function makeSelfSignedCert(cn: string): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attrs = [{ shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return forge.pki.certificateToPem(cert);
}

describe('checkStepUp — admin cert sessions need a second factor', () => {
  const adminId = uuidv4();
  const freshId = uuidv4();
  const adminEmail = `stepup-admin-${Date.now()}@example.de`;
  const freshEmail = `stepup-fresh-${Date.now()}@example.de`;
  const adminPem = makeSelfSignedCert('stepup-admin.example.de');
  const freshPem = makeSelfSignedCert('stepup-fresh.example.de');
  let secret: string;
  let tans: string[];
  let savedAutoLogin: string | undefined;
  let savedBypass: string | undefined;

  const certHeaders = (pem: string): Record<string, string> => ({
    'x-client-verify': 'SUCCESS',
    'x-client-cert': encodeURIComponent(pem),
  });

  beforeAll(async () => {
    savedAutoLogin = process.env.DEV_AUTO_LOGIN;
    savedBypass = process.env.DEV_TOTP_BYPASS;
    delete process.env.DEV_AUTO_LOGIN;
    delete process.env.DEV_TOTP_BYPASS;
    await db('users').insert({
      id: adminId,
      email: adminEmail,
      totp_enabled: true,
      created_at: new Date(),
    });
    await db('users').insert({ id: freshId, email: freshEmail, created_at: new Date() });
    secret = speakeasy.generateSecret({ length: 20 }).base32;
    await saveTotpSecret(adminId, secret);
    tans = await generateBackupCodes(adminId);
    for (const [email, pem] of [
      [adminEmail, adminPem],
      [freshEmail, freshPem],
    ]) {
      await db('admin_cert_fingerprints').insert({
        id: uuidv4(),
        email,
        fingerprint: sha512FingerprintFromPem(pem),
        created_at: new Date(),
        created_by: 'test',
      });
    }
  });

  afterAll(async () => {
    if (savedAutoLogin === undefined) delete process.env.DEV_AUTO_LOGIN;
    else process.env.DEV_AUTO_LOGIN = savedAutoLogin;
    if (savedBypass === undefined) delete process.env.DEV_TOTP_BYPASS;
    else process.env.DEV_TOTP_BYPASS = savedBypass;
    await db('admin_cert_fingerprints').whereIn('email', [adminEmail, freshEmail]).del();
    await db('users').whereIn('id', [adminId, freshId]).del();
  });

  it('asks for a code when only the certificate is presented: 400 TOTP_REQUIRED', async () => {
    const result = await checkStepUp(makeReq(adminId, 'cert', {}, certHeaders(adminPem)));
    expect(result).toMatchObject({ ok: false, status: 400, code: 'TOTP_REQUIRED' });
  });

  it('accepts the certificate plus a valid TOTP code', async () => {
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    const result = await checkStepUp(
      makeReq(adminId, 'cert', { totpCode: code }, certHeaders(adminPem)),
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects a wrong code: 401 TOTP_INVALID', async () => {
    const result = await checkStepUp(
      makeReq(adminId, 'cert', { totpCode: '000000' }, certHeaders(adminPem)),
    );
    expect(result).toMatchObject({ ok: false, status: 401, code: 'TOTP_INVALID' });
  });

  it('accepts a TAN once and refuses it the second time', async () => {
    const req = () => makeReq(adminId, 'cert', { totpCode: tans[0] }, certHeaders(adminPem));
    expect(await checkStepUp(req())).toEqual({ ok: true });
    expect(await checkStepUp(req())).toMatchObject({ ok: false, code: 'TOTP_INVALID' });
  });

  it('still fails on a wrong certificate even with a valid code', async () => {
    const code = speakeasy.totp({ secret, encoding: 'base32', time: Date.now() / 1000 + 30 });
    const result = await checkStepUp(
      makeReq(adminId, 'cert', { totpCode: code }, certHeaders(freshPem)),
    );
    expect(result).toMatchObject({ ok: false, code: 'CERT_STEP_UP_FAILED' });
  });

  it('answers 403 TOTP_ENROLMENT_REQUIRED for an admin who has not enrolled', async () => {
    const result = await checkStepUp(
      makeReq(freshId, 'cert', { totpCode: '123456' }, certHeaders(freshPem)),
    );
    expect(result).toMatchObject({ ok: false, status: 403, code: 'TOTP_ENROLMENT_REQUIRED' });
  });

  it('an OTP session accepts a TAN in place of the code', async () => {
    const result = await checkStepUp(makeReq(adminId, 'otp', { totpCode: tans[1] }));
    expect(result).toEqual({ ok: true });
  });

  it('rejects a code that is neither 6 digits nor a TAN: 400 TOTP_REQUIRED', async () => {
    const result = await checkStepUp(makeReq(adminId, 'otp', { totpCode: '12345' }));
    expect(result).toMatchObject({ ok: false, status: 400, code: 'TOTP_REQUIRED' });
  });
});
