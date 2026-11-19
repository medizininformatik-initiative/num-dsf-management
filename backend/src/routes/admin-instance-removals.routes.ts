/**
 * admin-instance-removals.routes.ts – Removing a whole site with two admins.
 * Mounted at /api/v1/admin/instance-removals (behind requireAuth + requireImiAdmin).
 *   GET  /               pending + recently decided requests
 *   POST /               { instanceId, reason } open a request (step-up)
 *   POST /:id/confirm    second admin of another e-mail domain executes it (step-up)
 *   POST /:id/cancel     the requester withdraws a pending request (step-up)
 * Dependencies: auth/admin/totp/rateLimit middleware, instance-removal.service, Zod
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import * as svc from '../services/instance-removal.service';
import { InstanceRemovalError } from '../services/instance-removal.service';

export const adminInstanceRemovalsRouter = Router();
adminInstanceRemovalsRouter.use(requireAuth, requireImiAdmin);

// Step-up rate limiter for the guarded writes (skipped under jest).
const stepUp = [
  ...(process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit]),
  requireFreshTotp,
];

const createSchema = z.object({
  instanceId: z.string().uuid(),
  reason: z.string().trim().min(3).max(2000),
  totpCode: z.string().optional(),
});

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  INSTANCE_NOT_FOUND: 404,
  NOT_PENDING: 409,
  ALREADY_REMOVED: 409,
  REQUEST_ALREADY_PENDING: 409,
  SELF_CONFIRM: 403,
  SAME_SITE: 403,
  NOT_REQUESTER: 403,
  REASON_REQUIRED: 400,
};

function fail(res: Response, err: unknown): boolean {
  if (!(err instanceof InstanceRemovalError)) return false;
  res.status(STATUS[err.code] ?? 400).json({ error: { code: err.code, message: err.code } });
  return true;
}

adminInstanceRemovalsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: await svc.listRemovals() });
  }),
);

adminInstanceRemovalsRouter.post(
  '/',
  ...stepUp,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    try {
      const data = await svc.requestRemoval(
        req.body.instanceId,
        req.body.reason,
        req.user!.email,
        req.ip || 'unknown',
      );
      res.status(201).json({ data });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);

adminInstanceRemovalsRouter.post(
  '/:id/confirm',
  ...stepUp,
  asyncHandler(async (req, res) => {
    try {
      const data = await svc.confirmRemoval(req.params.id, req.user!.email, req.ip || 'unknown');
      res.json({ data });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);

adminInstanceRemovalsRouter.post(
  '/:id/cancel',
  ...stepUp,
  asyncHandler(async (req, res) => {
    try {
      await svc.cancelRemoval(req.params.id, req.user!.email, req.ip || 'unknown');
      res.json({ data: { ok: true } });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);
