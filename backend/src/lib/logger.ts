/**
 * logger.ts – Structured JSON logging with pino
 * Dependencies: pino
 *
 * Features:
 * - JSON format in production, pretty-print in development
 * - Sensitive data redaction (password, token, pem, secret, otp, code)
 * - Log level configurable via LOG_LEVEL env var
 */
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// err.body / err.raw: body-parser attaches the raw request text to its
// errors, which may be a PEM or a private key.
export const REDACT_PATHS = [
  'password',
  'token',
  'pem',
  'secret',
  'otp',
  'code',
  'totpCode',
  'backupCodes',
  'tempToken',
  '*.accessToken',
  '*.refreshToken',
  '*.tempToken',
  'req.body.pem',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-client-cert"]',
  'err.body',
  'err.raw',
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  transport:
    !isProduction && !isTest
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
