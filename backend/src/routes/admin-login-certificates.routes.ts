/**
 * admin-login-certificates.routes.ts – Admins decide which certificates of an
 * organization may log in as that organization (the "Login" flag).
 * Mounted at /api/v1/admin/organizations (behind requireAuth + requireImiAdmin).
 *
 *   GET    /:identifier/login-certificates
 *   POST   /:identifier/login-certificates        { certificateId, totpCode? }
 *   DELETE /:identifier/login-certificates/:fingerprint
 *
 * Writes need the step-up (TOTP code, or the re-presented client certificate in
 * cert sessions) like other admin writes.
 * Dependencies: auth/admin/totp/rateLimit middleware, org-login-certificates.service, Zod
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import * as svc from '../services/org-login-certificates.service';

const enableSchema = z.object({
  certificateId: z.string().uuid(),
  totpCode: z.string().length(6).optional(),
});

const STATUS: Record<string, number> = {
  ORGANIZATION_NOT_FOUND: 404,
  CERTIFICATE_NOT_FOUND: 404,
  LOGIN_CERTIFICATE_NOT_FOUND: 404,
  INVALID_CERTIFICATE: 400,
  ADMIN_CERTIFICATE: 409,
  FINGERPRINT_IN_USE: 409,
};

function fail(res: Response, err: unknown): boolean {
  const code = err instanceof Error ? err.message : '';
  const status = STATUS[code];
  if (!status) return false;
  res.status(status).json({ error: { code, message: code } });
  return true;
}

export const adminLoginCertificatesRouter = Router();
adminLoginCertificatesRouter.use(requireAuth, requireImiAdmin);

// Step-up rate limiter for the guarded writes (skipped under jest).
const stepUp = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

adminLoginCertificatesRouter.get(
  '/:identifier/login-certificates',
  asyncHandler(async (req, res) => {
    try {
      res.json({ data: await svc.listForOrganization(req.params.identifier) });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);

adminLoginCertificatesRouter.post(
  '/:identifier/login-certificates',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const parsed = enableSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: parsed.error.errors[0]?.message || 'Invalid input' },
      });
    }
    try {
      const data = await svc.enable(
        req.params.identifier,
        parsed.data.certificateId,
        req.user!.email,
        req.ip || 'unknown',
      );
      res.status(201).json({ data });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);

adminLoginCertificatesRouter.delete(
  '/:identifier/login-certificates/:fingerprint',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    if (!/^[0-9a-f]{128}$/.test(req.params.fingerprint)) {
      return res
        .status(400)
        .json({ error: { code: 'VALIDATION', message: 'Invalid fingerprint' } });
    }
    try {
      await svc.remove(
        req.params.identifier,
        req.params.fingerprint,
        req.user!.email,
        req.ip || 'unknown',
      );
      res.json({ data: { deleted: true } });
    } catch (err) {
      if (!fail(res, err)) throw err;
    }
  }),
);
