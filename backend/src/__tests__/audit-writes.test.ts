/**
 * audit-writes.test.ts – new audit writes of step-up failures and rate-limit hits
 * (no DB: audit.service is mocked).
 * Dependencies: stepUp.middleware, rateLimit.middleware (limit handler), audit.service (mock)
 */
import type { Request, Response } from 'express';

jest.mock('../services/audit.service', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/totp.service', () => ({
  verifyTotpCode: jest.fn().mockResolvedValue(false),
  isDevTotpBypassActive: jest.fn().mockReturnValue(true),
}));
jest.mock('../services/auth.service', () => ({
  resolveCertLogin: jest.fn().mockResolvedValue(null),
  verifyAccessToken: jest.fn(),
}));

import { writeAuditLog } from '../services/audit.service';
import { requireStepUp } from '../middleware/stepUp.middleware';
import { auditedLimitHandler } from '../middleware/rateLimitAudit';

const writeMock = writeAuditLog as jest.Mock;

function resMock() {
  const res = { status: jest.fn(), json: jest.fn(), send: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & typeof res;
}

describe('step-up failure audit', () => {
  beforeEach(() => writeMock.mockClear());

  it('records a wrong code as STEP_UP_FAILED without the code itself', async () => {
    const res = resMock();
    const next = jest.fn();
    await requireStepUp(
      {
        user: { id: 'u1', email: 'adm@example.de' },
        body: { totpCode: '123456' },
        originalUrl: '/api/v1/admin/users?x=1',
        ip: '10.0.0.5',
      } as unknown as Request,
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledTimes(1);
    const entry = writeMock.mock.calls[0][0];
    expect(entry).toMatchObject({
      userEmail: 'adm@example.de',
      resourceType: 'AUTH',
      operation: 'STEP_UP_FAILED',
      diffJson: { reason: 'TOTP_INVALID', path: '/api/v1/admin/users' },
      ipAddress: '10.0.0.5',
    });
    expect(JSON.stringify(entry)).not.toContain('123456');
  });

  it('does not audit a request that simply carries no code', async () => {
    await requireStepUp(
      { user: { id: 'u1', email: 'a@example.de' }, body: {} } as unknown as Request,
      resMock(),
      jest.fn(),
    );
    expect(writeMock).not.toHaveBeenCalled();
  });
});

describe('rate-limit hit audit', () => {
  it('records RATE_LIMITED with the bucket and answers with the configured body', () => {
    writeMock.mockClear();
    const res = resMock();
    const options = { statusCode: 429, message: { error: { code: 'RATE_LIMITED' } } };
    const handler = auditedLimitHandler('otp') as unknown as (...a: unknown[]) => void;
    handler(
      { body: { email: 'x@example.de' }, originalUrl: '/auth/verify-otp?a=1', ip: '1.2.3.4' },
      res,
      jest.fn(),
      options,
    );
    expect(writeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'x@example.de',
        operation: 'RATE_LIMITED',
        diffJson: { bucket: 'otp', path: '/auth/verify-otp' },
        ipAddress: '1.2.3.4',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).toHaveBeenCalledWith(options.message);
  });
});
