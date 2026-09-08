/**
 * stepUp.middleware.test.ts — unit-tests the checkStepUp / requireStepUp guard.
 *
 * requireFreshTotp (totp.middleware.ts) used to be the only step-up gate, and
 * only understood a fresh 6-digit TOTP code. Cert-authenticated sessions
 * (POST /auth/client-cert-login) cannot produce one, so checkStepUp branches
 * on req.user.authMethod: an 'otp' session still needs a fresh TOTP code
 * (delegating to totp.service.verifyTotpCode, same as before), a 'cert'
 * session must instead re-present the same client certificate it logged in
 * with (verified via lib/clientCert + auth.service.resolveCertLogin).
 *
 * The OTP path is exercised against the REAL verify path (encrypted secret in
 * the DB, speakeasy-minted code), mirroring totp.middleware.test.ts. The cert
 * path uses real (node-forge generated) self-signed certs and a real
 * admin_cert_fingerprints row, mirroring auth-client-cert.test.ts.
 *
 * Dependencies: express types, uuid, speakeasy, node-forge, db/connection,
 * totp.service, lib/certFingerprint, middleware/stepUp.middleware.
 */
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import speakeasy from 'speakeasy';
import forge from 'node-forge';
import { db } from '../db/connection';
import { saveTotpSecret } from '../services/totp.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { checkStepUp, requireStepUp } from '../middleware/stepUp.middleware';

interface CapturedResponse {
  statusCode: number | null;
  body: unknown;
}

function makeRes(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: null, body: null };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

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

describe('checkStepUp — otp sessions', () => {
  const userId = uuidv4();
  const email = `stepup-otp-${Date.now()}@example.de`;
  let secret: string;
  let savedAutoLogin: string | undefined;
  let savedBypass: string | undefined;

  beforeAll(async () => {
    // Force the dev TOTP bypass off so verifyTotpCode runs the real
    // decrypt+verify path instead of short-circuiting to true.
    savedAutoLogin = process.env.DEV_AUTO_LOGIN;
    savedBypass = process.env.DEV_TOTP_BYPASS;
    delete process.env.DEV_AUTO_LOGIN;
    delete process.env.DEV_TOTP_BYPASS;

    await db('users').insert({ id: userId, email, totp_enabled: true, created_at: new Date() });
    secret = speakeasy.generateSecret({ length: 20 }).base32;
    await saveTotpSecret(userId, secret);
  });

  afterAll(async () => {
    if (savedAutoLogin === undefined) delete process.env.DEV_AUTO_LOGIN;
    else process.env.DEV_AUTO_LOGIN = savedAutoLogin;
    if (savedBypass === undefined) delete process.env.DEV_TOTP_BYPASS;
    else process.env.DEV_TOTP_BYPASS = savedBypass;
    await db('users').where({ id: userId }).del();
  });

  it('(a) rejects a missing code with 400 TOTP_REQUIRED', async () => {
    const result = await checkStepUp(makeReq(userId, 'otp', {}));
    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'TOTP_REQUIRED',
      message: expect.any(String),
    });
  });

  it('(b) rejects when TOTP is not configured with 403 TOTP_NOT_CONFIGURED', async () => {
    const noTotpUserId = uuidv4();
    const noTotpEmail = `stepup-nototp-${Date.now()}@example.de`;
    await db('users').insert({
      id: noTotpUserId,
      email: noTotpEmail,
      totp_enabled: false,
      created_at: new Date(),
    });
    try {
      const result = await checkStepUp(makeReq(noTotpUserId, 'otp', { totpCode: '123456' }));
      expect(result).toEqual({
        ok: false,
        status: 403,
        code: 'TOTP_NOT_CONFIGURED',
        message: expect.any(String),
      });
    } finally {
      await db('users').where({ id: noTotpUserId }).del();
    }
  });

  it('(b2) rejects with 403 TOTP_NOT_CONFIGURED when totp_enabled is true but no secret was ever saved', async () => {
    const halfSetupUserId = uuidv4();
    const halfSetupEmail = `stepup-halfsetup-${Date.now()}@example.de`;
    await db('users').insert({
      id: halfSetupUserId,
      email: halfSetupEmail,
      totp_enabled: true,
      created_at: new Date(),
    });
    try {
      const result = await checkStepUp(makeReq(halfSetupUserId, 'otp', { totpCode: '123456' }));
      expect(result).toEqual({
        ok: false,
        status: 403,
        code: 'TOTP_NOT_CONFIGURED',
        message: expect.any(String),
      });
    } finally {
      await db('users').where({ id: halfSetupUserId }).del();
    }
  });

  it('(b3) accepts the dev TOTP bypass even when totp_enabled is true but no secret was ever saved', async () => {
    const bypassUserId = uuidv4();
    const bypassEmail = `stepup-bypass-${Date.now()}@example.de`;
    await db('users').insert({
      id: bypassUserId,
      email: bypassEmail,
      totp_enabled: true,
      created_at: new Date(),
    });
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.DEV_AUTO_LOGIN = 'true';
    process.env.DEV_TOTP_BYPASS = 'true';
    try {
      const result = await checkStepUp(makeReq(bypassUserId, 'otp', { totpCode: '123456' }));
      expect(result).toEqual({ ok: true });
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      delete process.env.DEV_AUTO_LOGIN;
      delete process.env.DEV_TOTP_BYPASS;
      await db('users').where({ id: bypassUserId }).del();
    }
  });

  it('accepts a fresh valid TOTP code', async () => {
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    const result = await checkStepUp(makeReq(userId, 'otp', { totpCode: code }));
    expect(result).toEqual({ ok: true });
  });

  it('rejects a well-formed but wrong code with 401 TOTP_INVALID', async () => {
    const result = await checkStepUp(makeReq(userId, 'otp', { totpCode: '000000' }));
    expect(result).toEqual({
      ok: false,
      status: 401,
      code: 'TOTP_INVALID',
      message: expect.any(String),
    });
  });
});

describe('checkStepUp — cert sessions', () => {
  const ownerId = uuidv4();
  const ownerEmail = `stepup-cert-owner-${Date.now()}@example.de`;
  const otherId = uuidv4();
  const otherEmail = `stepup-cert-other-${Date.now()}@example.de`;

  const ownerPem = makeSelfSignedCert('stepup-cert-owner.example.de');
  const otherPem = makeSelfSignedCert('stepup-cert-other.example.de');

  beforeAll(async () => {
    await db('users').insert({ id: ownerId, email: ownerEmail, created_at: new Date() });
    await db('users').insert({ id: otherId, email: otherEmail, created_at: new Date() });
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: ownerEmail,
      fingerprint: sha512FingerprintFromPem(ownerPem),
      created_at: new Date(),
      created_by: 'test',
    });
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: otherEmail,
      fingerprint: sha512FingerprintFromPem(otherPem),
      created_at: new Date(),
      created_by: 'test',
    });
  });

  afterAll(async () => {
    await db('admin_cert_fingerprints').whereIn('email', [ownerEmail, otherEmail]).del();
    await db('users').whereIn('id', [ownerId, otherId]).del();
  });

  it('(c) calls through when the registered owner re-presents their cert', async () => {
    const req = makeReq(
      ownerId,
      'cert',
      {},
      {
        'x-client-verify': 'SUCCESS',
        'x-client-cert': encodeURIComponent(ownerPem),
      },
    );
    const result = await checkStepUp(req);
    expect(result).toEqual({ ok: true });
  });

  it('(d) rejects a cert session with no cert headers: 401 CERT_STEP_UP_FAILED', async () => {
    const result = await checkStepUp(makeReq(ownerId, 'cert', {}, {}));
    expect(result).toEqual({
      ok: false,
      status: 401,
      code: 'CERT_STEP_UP_FAILED',
      message: expect.any(String),
    });
  });

  it('(e) rejects a cert registered to a different user: 401 CERT_STEP_UP_FAILED', async () => {
    const req = makeReq(
      ownerId,
      'cert',
      {},
      {
        'x-client-verify': 'SUCCESS',
        'x-client-cert': encodeURIComponent(otherPem),
      },
    );
    const result = await checkStepUp(req);
    expect(result).toEqual({
      ok: false,
      status: 401,
      code: 'CERT_STEP_UP_FAILED',
      message: expect.any(String),
    });
  });
});

describe('requireStepUp middleware', () => {
  const ownerId = uuidv4();
  const ownerEmail = `stepup-mw-${Date.now()}@example.de`;
  const ownerPem = makeSelfSignedCert('stepup-mw-owner.example.de');

  beforeAll(async () => {
    await db('users').insert({ id: ownerId, email: ownerEmail, created_at: new Date() });
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: ownerEmail,
      fingerprint: sha512FingerprintFromPem(ownerPem),
      created_at: new Date(),
      created_by: 'test',
    });
  });

  afterAll(async () => {
    await db('admin_cert_fingerprints').where({ email: ownerEmail }).del();
    await db('users').where({ id: ownerId }).del();
  });

  it('calls next() and writes no response when the cert step-up succeeds', async () => {
    const req = makeReq(
      ownerId,
      'cert',
      {},
      {
        'x-client-verify': 'SUCCESS',
        'x-client-cert': encodeURIComponent(ownerPem),
      },
    );
    const { res, captured } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireStepUp(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.statusCode).toBeNull();
    expect(captured.body).toBeNull();
  });

  it('writes the failure status/code and never calls next() when the cert step-up fails', async () => {
    const req = makeReq(ownerId, 'cert', {}, {});
    const { res, captured } = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await requireStepUp(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(401);
    expect(captured.body).toMatchObject({ error: { code: 'CERT_STEP_UP_FAILED' } });
  });
});
