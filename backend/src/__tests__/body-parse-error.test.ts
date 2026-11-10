/**
 * body-parse-error.test.ts – A malformed JSON body makes body-parser throw an
 * error that carries the raw request text in err.body. That text can be a
 * PEM or a private key, so it must never be logged: the error handler answers
 * 400 without logging the error object, and the logger redacts err.body and
 * err.raw anyway.
 * Dependencies: supertest, app, lib/logger, pino
 */
import { Writable } from 'stream';
import pino from 'pino';
import request from 'supertest';
import { app } from '../app';
import { logger, REDACT_PATHS } from '../lib/logger';

const SECRET = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ-secret-body';

afterEach(() => jest.restoreAllMocks());

describe('malformed JSON body', () => {
  it('answers 400 and logs nothing of the body', async () => {
    const spies = (['error', 'warn', 'info'] as const).map((level) =>
      jest.spyOn(logger, level).mockImplementation(() => undefined),
    );
    const res = await request(app)
      .post('/auth/request-otp')
      .set('Content-Type', 'application/json')
      .send(`{"email": "${SECRET}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-body');
    }
  });
});

describe('logger redaction', () => {
  it('redacts err.body and err.raw', () => {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink);
    log.error({ err: { message: 'x', body: SECRET, raw: SECRET } }, 'parse failed');
    expect(out).not.toContain('secret-body');
  });
});
