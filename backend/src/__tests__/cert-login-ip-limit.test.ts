/**
 * cert-login-ip-limit.test.ts – The per-certificate cert-login bucket does not
 * stop one source trying many certificates (each new certificate is a new
 * bucket). certLoginFailureIpRateLimit counts FAILED certificate logins per
 * source IP, whatever certificate was presented; successful logins do not
 * count, so a NAT full of working clients is not throttled.
 * Dependencies: supertest, express, uuid, redis.service, rateLimit.middleware
 */
import express, { type Express } from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { redis } from '../services/redis.service';
import { certLoginFailureIpRateLimit } from '../middleware/rateLimit.middleware';

const MAX = parseInt(process.env.RATE_LIMIT_CERT_LOGIN_FAIL_MAX || '30', 10);
const ips: string[] = [];

function buildApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.post('/login', certLoginFailureIpRateLimit, (req, res) => {
    if (req.get('x-ok') === '1') return res.json({ data: { ok: true } });
    return res.status(401).json({ error: { code: 'CERT_NOT_REGISTERED' } });
  });
  return app;
}

function freshIp(): string {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  ips.push(ip);
  return ip;
}

afterAll(async () => {
  for (const ip of ips) await redis.del(`ratelimit:cert-login-fail:${ip}`);
});

describe('certLoginFailureIpRateLimit', () => {
  it('throttles a source IP after too many failed certificate logins', async () => {
    const app = buildApp();
    const ip = freshIp();
    for (let i = 0; i < MAX; i++) {
      const res = await request(app)
        .post('/login')
        .set('X-Forwarded-For', ip)
        .set('X-Cert', uuidv4());
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/login').set('X-Forwarded-For', ip);
    expect(blocked.status).toBe(429);
  });

  it('does not count successful logins', async () => {
    const app = buildApp();
    const ip = freshIp();
    for (let i = 0; i < MAX + 5; i++) {
      const res = await request(app).post('/login').set('X-Forwarded-For', ip).set('x-ok', '1');
      expect(res.status).toBe(200);
    }
  });
});
