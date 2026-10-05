/**
 * admin-bundle-restores.routes.ts – four-eyes decisions on restore requests.
 * Mounted at /api/v1/admin/bundle-restores (behind requireAuth + requireImiAdmin).
 *   GET  /                 — list requests, newest first
 *   POST /:rid/approve     — second admin of another site; publishes the restore (step-up)
 *   POST /:rid/reject      — { comment } (step-up)
 *   POST /:rid/cancel      — the requester withdraws a pending request (step-up)
 * Dependencies: auth/admin/totp middleware, bundle-restore.service
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import * as svc from '../services/bundle-restore.service';
import { RestoreRequestError } from '../services/bundle-restore.service';

export const adminBundleRestoresRouter = Router();
adminBundleRestoresRouter.use(requireAuth, requireImiAdmin);

// Step-up rate limiter for the guarded writes (skipped under jest).
const stepUp = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

const rejectSchema = z.object({ comment: z.string().trim().min(3).max(500) });

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_PENDING: 409,
  NOT_PENDING: 409,
  VERSION_NOT_RESTORABLE: 409,
  SAME_SITE: 403,
  SELF_APPROVE: 403,
  NOT_REQUESTER: 403,
};

/** Answers a RestoreRequestError with its HTTP status; false for any other error. */
export function sendRestoreError(err: unknown, res: Response): boolean {
  if (!(err instanceof RestoreRequestError)) return false;
  res.status(STATUS[err.code] ?? 400).json({ error: { code: err.code, message: err.message } });
  return true;
}

adminBundleRestoresRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: await svc.listRestoreRequests() });
  }),
);

adminBundleRestoresRouter.post(
  '/:rid/approve',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    try {
      const data = await svc.approveRestoreRequest(req.params.rid, req.user!.email, req.ip);
      res.json({ data });
    } catch (err) {
      if (!sendRestoreError(err, res)) throw err;
    }
  }),
);

adminBundleRestoresRouter.post(
  '/:rid/reject',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: parsed.error.errors[0]?.message || 'Invalid input' },
      });
    }
    try {
      await svc.rejectRestoreRequest(req.params.rid, req.user!.email, parsed.data.comment, req.ip);
      res.json({ data: { ok: true } });
    } catch (err) {
      if (!sendRestoreError(err, res)) throw err;
    }
  }),
);

adminBundleRestoresRouter.post(
  '/:rid/cancel',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    try {
      await svc.cancelRestoreRequest(req.params.rid, req.user!.email, req.ip);
      res.json({ data: { ok: true } });
    } catch (err) {
      if (!sendRestoreError(err, res)) throw err;
    }
  }),
);
