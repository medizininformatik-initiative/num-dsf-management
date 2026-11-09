/**
 * admin-marketplace-stepup-limit.test.ts – Every marketplace admin write runs
 * behind the step-up rate limiter (stepUpTotpRateLimit) before the TOTP is
 * checked, so a stolen admin token cannot grind the 6-digit code. Auth and the
 * limiter are mocked; the router is loaded outside NODE_ENV=test, where the
 * real limiter is mounted.
 * Dependencies: supertest, express, admin-marketplace.routes (mocked middleware)
 */
import express from 'express';
import request from 'supertest';

const limiter = jest.fn((_req: express.Request, res: express.Response) => {
  res.status(429).json({ error: { code: 'RATE_LIMITED' } });
});

jest.mock('../middleware/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 'u1', email: 'admin@imi-test.example.de', authMethod: 'otp' };
    next();
  },
}));
jest.mock('../middleware/admin.middleware', () => ({
  requireImiAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));
jest.mock('../middleware/rateLimit.middleware', () => ({
  stepUpTotpRateLimit: (req: express.Request, res: express.Response) => limiter(req, res),
}));

function loadApp(): express.Express {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let router: express.Router | undefined;
  try {
    jest.isolateModules(() => {
      router = require('../routes/admin-marketplace.routes').adminMarketplaceRouter;
    });
  } finally {
    process.env.NODE_ENV = saved;
  }
  const app = express();
  app.use(express.json());
  app.use('/m', router!);
  return app;
}

describe('marketplace admin writes and the step-up limiter', () => {
  const app = loadApp();
  const body = { totpCode: '000000' };

  it.each([
    ['post', '/m'],
    ['patch', '/m/x'],
    ['patch', '/m/x/meta'],
    ['delete', '/m/x'],
  ] as const)('%s %s is rate-limited before the TOTP check', async (method, path) => {
    limiter.mockClear();
    const res = await request(app)[method](path).send(body);
    expect(limiter).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(429);
  });
});
