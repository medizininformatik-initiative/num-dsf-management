/**
 * approval.routes.ts – Tenant-side approval submission + status
 * Dependencies: auth.middleware, instance.middleware, approval.service, sanitizeError
 *
 * Endpoints (requireAuth + requireInstanceOwnership):
 *   POST /instances/:id/approval/submit
 *   POST /instances/:id/approval/withdraw  (409 NOT_PENDING unless a request is PENDING)
 *   GET  /instances/:id/approval/status
 *   GET  /instances/:id/approval/history
 *
 * Admin side (approve/reject) lives in admin-approval.routes.ts.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
import * as svc from '../services/approval.service';
import { sanitizeError } from '../lib/sanitizeError';
import { asyncHandler } from '../lib/asyncHandler';

export const approvalRouter = Router({ mergeParams: true });

approvalRouter.post('/submit', requireAuth, requireInstanceOwnership, async (req, res) => {
  try {
    const request = await svc.submitApproval(
      req.instance!.id,
      req.user!.email,
      req.ip || 'unknown',
    );
    res.json({ data: request });
  } catch (err: unknown) {
    res.status(400).json({ error: sanitizeError(err) });
  }
});

approvalRouter.post('/withdraw', requireAuth, requireInstanceOwnership, async (req, res, next) => {
  try {
    const request = await svc.withdrawApproval(
      req.instance!.id,
      req.user!.email,
      req.ip || 'unknown',
    );
    res.json({ data: request });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'NOT_PENDING') {
      return res
        .status(409)
        .json({ error: { code: 'NOT_PENDING', message: 'No pending request to withdraw.' } });
    }
    next(err);
  }
});

approvalRouter.get(
  '/status',
  requireAuth,
  requireInstanceOwnership,
  asyncHandler(async (req, res) => {
    res.json({ data: await svc.getApprovalStatus(req.instance!.id) });
  }),
);

approvalRouter.get(
  '/history',
  requireAuth,
  requireInstanceOwnership,
  asyncHandler(async (req, res) => {
    res.json({ data: await svc.getApprovalHistory(req.instance!.id) });
  }),
);
