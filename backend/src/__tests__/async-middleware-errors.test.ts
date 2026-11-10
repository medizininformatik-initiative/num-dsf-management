/**
 * async-middleware-errors.test.ts – Express 4 does not catch a rejected promise
 * from an async middleware; without a handler the rejection is unhandled and
 * Node ends the process. The guards must hand any error to next(err) so the
 * global error handler answers, and their promise must never reject.
 * Dependencies: instance.middleware, admin.middleware, stepUp.middleware, lib/isAdmin
 */
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as isAdmin from '../lib/isAdmin';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireStepUp } from '../middleware/stepUp.middleware';

function mockRes(): Response {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

function mockReq(user: unknown): Request {
  return {
    params: { instanceId: uuidv4() },
    user,
    body: {},
    method: 'GET',
    originalUrl: '/api/v1/instances/x',
    ip: '127.0.0.1',
    get: () => undefined,
  } as unknown as Request;
}

afterEach(() => jest.restoreAllMocks());

describe('async guards forward errors to next(err)', () => {
  it('requireInstanceOwnership forwards a failing lookup', async () => {
    jest.spyOn(isAdmin, 'isAdminCaller').mockRejectedValue(new Error('db down'));
    const next = jest.fn() as unknown as NextFunction;
    await expect(
      requireInstanceOwnership(mockReq({ id: 'u', email: 'u@example.de' }), mockRes(), next),
    ).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('requireImiAdmin forwards a failing admin check', async () => {
    jest.spyOn(isAdmin, 'isAdminCaller').mockRejectedValue(new Error('db down'));
    const next = jest.fn() as unknown as NextFunction;
    await expect(
      requireImiAdmin(mockReq({ id: 'u', email: 'u@example.de' }), mockRes(), next),
    ).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('requireStepUp forwards an error thrown while checking', async () => {
    const next = jest.fn() as unknown as NextFunction;
    // No req.user: the TOTP branch dereferences it and throws.
    const req = mockReq(undefined);
    req.body = { totpCode: '123456' };
    await expect(requireStepUp(req, mockRes(), next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
