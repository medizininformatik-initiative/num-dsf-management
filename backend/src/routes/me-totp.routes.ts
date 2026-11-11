/**
 * me-totp.routes.ts – TOTP and TAN management of the signed-in user.
 * Mounted at /api/v1/me/totp. Used by an admin who signed in with a client
 * certificate and has to enrol TOTP at the first login (the only routes such a
 * session may reach before it has enrolled), and later to see how many TANs
 * are left and to issue a new TAN list.
 *
 *   GET  /status          { enabled, remainingTans, enrolmentRequired }
 *   POST /setup           { code?, restart? }  → { qrCodeUrl, secret }. While a pending
 *                         secret is valid the same one is returned unless restart is
 *                         true. Free while TOTP is
 *                         not enrolled; once enrolled it needs a valid TOTP code
 *                         or TAN, so a stolen session cannot swap the secret.
 *   POST /confirm         { code }   → { backupCodes } (shown once; the TAN list)
 *   POST /backup-codes    { totpCode } step-up → { backupCodes }, the old list
 *                         is invalidated
 * An organization-scoped site session never uses TOTP (403).
 * Every step is written to the audit log (TOTP_SETUP, STEP_UP_FAILED).
 * Dependencies: auth.middleware, stepUp.middleware, rateLimit.middleware,
 * totp.service, lib/totpEnrolment, audit.service
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuthAllowEnrolment, requireAuth } from '../middleware/auth.middleware';
import { requireStepUp } from '../middleware/stepUp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import {
  startTotpEnrolment,
  confirmTotpEnrolment,
  type TotpConfirmFailure,
  countBackupCodes,
  generateBackupCodes,
  verifySecondFactor,
} from '../services/totp.service';
import { isTotpEnrolmentRequired } from '../lib/totpEnrolment';
import { writeAuditLog } from '../services/audit.service';
import { asyncHandler } from '../lib/asyncHandler';
import { db } from '../db/connection';

export const meTotpRouter = Router();

// Rate limits are skipped under jest, like the auth routes.
const limiter = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

function refuseScoped(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.scopeInstanceId) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'TOTP is only used by administrator sessions.' },
    });
    return;
  }
  next();
}

function audit(req: Request, operation: 'TOTP_SETUP' | 'STEP_UP_FAILED', diff: object): void {
  writeAuditLog({
    userEmail: req.user?.email,
    resourceType: 'AUTH',
    operation,
    diffJson: diff,
    ipAddress: req.ip || 'unknown',
  }).catch(() => {});
}

// Distinct answers per reason; the frontend maps the code to its own text.
const CONFIRM_FAILURES: Record<
  TotpConfirmFailure,
  { status: number; code: string; message: string }
> = {
  NO_PENDING: {
    status: 409,
    code: 'TOTP_ENROLMENT_EXPIRED',
    message: 'The setup has expired or was not started. Start the setup again.',
  },
  INVALID_CODE: { status: 401, code: 'TOTP_INVALID', message: 'Invalid code.' },
  CODE_REUSED: {
    status: 401,
    code: 'TOTP_CODE_USED',
    message: 'This code was already used. Wait for the next code.',
  },
};

async function isEnabled(userId: string): Promise<boolean> {
  const row = (await db('users').where({ id: userId }).select('totp_enabled').first()) as
    | { totp_enabled: boolean | number }
    | undefined;
  return !!row?.totp_enabled;
}

meTotpRouter.get(
  '/status',
  requireAuthAllowEnrolment,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    res.json({
      data: {
        enabled: await isEnabled(user.id),
        remainingTans: await countBackupCodes(user.id),
        enrolmentRequired: await isTotpEnrolmentRequired(user),
      },
    });
  }),
);

meTotpRouter.post(
  '/setup',
  requireAuthAllowEnrolment,
  refuseScoped,
  ...limiter,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (await isEnabled(user.id)) {
      const code = req.body?.code;
      if (typeof code !== 'string' || code.length < 6 || code.length > 10) {
        res.status(400).json({
          error: { code: 'TOTP_REQUIRED', message: 'Current TOTP code or TAN required.' },
        });
        return;
      }
      if (!(await verifySecondFactor(user.id, code))) {
        audit(req, 'STEP_UP_FAILED', { reason: 'TOTP_INVALID', path: '/me/totp/setup' });
        res.status(401).json({ error: { code: 'TOTP_INVALID', message: 'Invalid code or TAN.' } });
        return;
      }
    }
    const restart = req.body?.restart === true;
    const { qrCodeUrl, secret, resumed } = await startTotpEnrolment(user.id, user.email, restart);
    audit(req, 'TOTP_SETUP', { action: restart ? 'restarted' : resumed ? 'resumed' : 'started' });
    res.json({ data: { qrCodeUrl, secret } });
  }),
);

meTotpRouter.post(
  '/confirm',
  requireAuthAllowEnrolment,
  refuseScoped,
  ...limiter,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      res.status(400).json({
        error: { code: 'TOTP_REQUIRED', message: '6-digit TOTP code required.' },
      });
      return;
    }
    const result = await confirmTotpEnrolment(user.id, code);
    if (!result.ok) {
      audit(req, 'STEP_UP_FAILED', {
        action: 'confirm_failed',
        reason: result.reason,
        path: '/me/totp/confirm',
      });
      const failure = CONFIRM_FAILURES[result.reason];
      res.status(failure.status).json({ error: { code: failure.code, message: failure.message } });
      return;
    }
    const backupCodes = result.backupCodes;
    audit(req, 'TOTP_SETUP', { action: 'enrolled' });
    res.json({ data: { backupCodes } });
  }),
);

meTotpRouter.post(
  '/backup-codes',
  requireAuth,
  refuseScoped,
  ...limiter,
  requireStepUp,
  asyncHandler(async (req, res) => {
    const backupCodes = await generateBackupCodes(req.user!.id);
    audit(req, 'TOTP_SETUP', { action: 'tans_regenerated' });
    res.json({ data: { backupCodes } });
  }),
);
