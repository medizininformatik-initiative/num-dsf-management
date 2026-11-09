/**
 * admin-marketplace.routes.ts – Admin write endpoints (step-up gated).
 * Mounted at /api/v1/admin/marketplace. All write endpoints require a fresh
 * step-up (TOTP code, or a re-presented client cert for cert sessions) behind
 * the step-up rate limiter.
 * Dependencies: auth.middleware, admin.middleware, stepUp.middleware, marketplace.service
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { validate } from '../middleware/validate.middleware';
import { checkStepUp } from '../middleware/stepUp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import {
  createMarketplaceSchema,
  patchMarketplaceSchema,
  patchMarketplaceMetaSchema,
  deleteMarketplaceSchema,
} from '../schemas/marketplace.schema';
import { addEntry, updateStatus, updateMeta, removeEntry } from '../services/marketplace.service';
import { sanitizeError } from '../lib/sanitizeError';

export const adminMarketplaceRouter = Router();
adminMarketplaceRouter.use(requireAuth, requireImiAdmin);

// Step-up brute-force guard on every write, as on the other admin routers (skipped under jest).
const stepUpLimiter = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

async function checkTotp(req: Request, res: Response): Promise<boolean> {
  const result = await checkStepUp(req);
  if (!result.ok) {
    res.status(result.status).json({ error: { code: result.code, message: result.message } });
    return false;
  }
  return true;
}

// POST /api/v1/admin/marketplace  { gitUrl, status?, totpCode }
adminMarketplaceRouter.post(
  '/',
  ...stepUpLimiter,
  validate(createMarketplaceSchema),
  async (req, res) => {
    if (!(await checkTotp(req, res))) return;
    try {
      const entry = await addEntry(
        { gitUrl: req.body.gitUrl, status: req.body.status },
        req.user!.email,
        req.ip || 'unknown',
      );
      res.status(201).json({ data: entry });
    } catch (err: unknown) {
      const status = err instanceof Error && err.message === 'ALREADY_EXISTS' ? 409 : 400;
      res.status(status).json({ error: sanitizeError(err) });
    }
  },
);

// PATCH /api/v1/admin/marketplace/:id  { status, totpCode }
adminMarketplaceRouter.patch(
  '/:id',
  ...stepUpLimiter,
  validate(patchMarketplaceSchema),
  async (req, res) => {
    if (!(await checkTotp(req, res))) return;
    try {
      const entry = await updateStatus(
        req.params.id,
        req.body.status,
        req.user!.email,
        req.ip || 'unknown',
      );
      res.json({ data: entry });
    } catch (err: unknown) {
      const status = err instanceof Error && err.message === 'NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: sanitizeError(err) });
    }
  },
);

// PATCH /api/v1/admin/marketplace/:id/meta  { ...dsf/trust fields, totpCode }
adminMarketplaceRouter.patch(
  '/:id/meta',
  ...stepUpLimiter,
  validate(patchMarketplaceMetaSchema),
  async (req, res) => {
    if (!(await checkTotp(req, res))) return;
    try {
      const entry = await updateMeta(req.params.id, req.body, req.user!.email, req.ip || 'unknown');
      res.json({ data: entry });
    } catch (err: unknown) {
      const status = err instanceof Error && err.message === 'NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: sanitizeError(err) });
    }
  },
);

// DELETE /api/v1/admin/marketplace/:id  { totpCode }
adminMarketplaceRouter.delete(
  '/:id',
  ...stepUpLimiter,
  validate(deleteMarketplaceSchema),
  async (req, res) => {
    if (!(await checkTotp(req, res))) return;
    try {
      await removeEntry(req.params.id, req.user!.email, req.ip || 'unknown');
      res.json({ data: { deleted: true } });
    } catch (err: unknown) {
      const status = err instanceof Error && err.message === 'NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: sanitizeError(err) });
    }
  },
);
