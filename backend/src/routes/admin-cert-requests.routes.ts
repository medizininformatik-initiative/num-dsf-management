/**
 * admin-cert-requests.routes.ts – Four-eyes requests for a colleague's admin
 * login certificate. Mounted at /api/v1/admin/admin-cert-requests; requests
 * are created via POST /api/v1/admin/users/:email/certificates.
 *
 *   GET  /                 pending + recently decided requests
 *   POST /:id/approve      third admin, other site than the requester (step-up)
 *   POST /:id/reject       { comment } (step-up)
 *   POST /:id/cancel       requester only (step-up)
 *
 * Admin-only (org-scoped sessions never are). The PEM is never returned.
 * Dependencies: auth/admin/totp/rateLimit middleware, admin-cert-requests.service, Zod
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import * as svc from '../services/admin-cert-requests.service';
import { CertRequestError } from '../services/admin-cert-requests.service';
import { AdminCertError } from '../services/admin-certificates.service';

const rejectSchema = z.object({ comment: z.string().min(1).max(1000) });

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  NOT_PENDING: 409,
  SELF_APPROVE: 403,
  TARGET_APPROVE: 403,
  SAME_SITE: 403,
  NOT_REQUESTER: 403,
  USE_CANCEL: 400,
  COMMENT_REQUIRED: 400,
  NOT_ADMIN: 403,
  NOT_AN_ADMIN: 400,
  INVALID_PEM: 400,
  PRIVATE_KEY_REJECTED: 400,
  CERTIFICATE_EXPIRED: 400,
  CERTIFICATE_NOT_YET_VALID: 400,
  CA_BLACKLISTED: 400,
  CA_NOT_WHITELISTED: 400,
  ADMIN_CERTIFICATE_IN_USE: 409,
  ORG_LOGIN_CERTIFICATE_IN_USE: 409,
};

function fail(res: Response, err: unknown): boolean {
  if (!(err instanceof CertRequestError || err instanceof AdminCertError)) return false;
  const status = STATUS[err.code];
  if (!status) return false;
  res.status(status).json({ error: { code: err.code, message: err.code } });
  return true;
}

export const adminCertRequestsRouter = Router();
adminCertRequestsRouter.use(requireAuth, requireImiAdmin);

// Step-up rate limiter for the guarded writes (skipped under jest).
const stepUp = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

adminCertRequestsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: await svc.listRequests() });
  }),
);

adminCertRequestsRouter.post(
  '/:id/approve',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    try {
      await svc.approveRequest(req.params.id, req.user!.email, req.ip || 'unknown');
      res.json({ data: { ok: true } });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);

adminCertRequestsRouter.post(
  '/:id/reject',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: { code: 'VALIDATION', message: 'comment required (max 1000 characters)' } });
    }
    try {
      await svc.rejectRequest(req.params.id, req.user!.email, parsed.data.comment, req.ip || '-');
      res.json({ data: { ok: true } });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);

adminCertRequestsRouter.post(
  '/:id/cancel',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    try {
      await svc.cancelRequest(req.params.id, req.user!.email, req.ip || 'unknown');
      res.json({ data: { ok: true } });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);
