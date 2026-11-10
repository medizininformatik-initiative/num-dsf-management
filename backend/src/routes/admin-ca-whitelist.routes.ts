/**
 * admin-ca-whitelist.routes.ts – Admin CRUD for the CA whitelist: the CAs DSF
 * accepts in production, seeded at init with the DSF 2.1.1 defaults
 * (migration 022). Writes require the step-up (TOTP code, or the re-presented
 * client certificate in cert sessions), matching the blacklist router.
 * Dependencies: auth.middleware, admin.middleware, totp.middleware,
 *               rateLimit.middleware, asyncHandler, ca-whitelist.service, Zod
 */
import { Router } from 'express';
import { stepUpCode } from '../schemas/stepUpCode';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import * as svc from '../services/ca-whitelist.service';

const addSchema = z.object({
  subjectDn: z.string().min(3).max(500),
  kind: z.enum(['CLIENT', 'SERVER']).default('CLIENT'),
  fingerprint: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/)
    .optional(),
  reason: z.string().max(2000).optional(),
  totpCode: stepUpCode,
});

export const adminCaWhitelistRouter = Router();
adminCaWhitelistRouter.use(requireAuth, requireImiAdmin);

// Step-up rate limiter for the guarded writes (skipped under jest).
const stepUp = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

adminCaWhitelistRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const whitelist = await svc.listWhitelist();
    res.json({ data: { whitelist, enforced: svc.isWhitelistEnforced() } });
  }),
);

adminCaWhitelistRouter.post(
  '/',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message || 'Invalid input' },
      });
    }
    const { totpCode: _totpCode, ...entry } = parsed.data;
    try {
      const id = await svc.addToWhitelist(entry, req.user!.email);
      res.status(201).json({ data: { id } });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'CONFLICT') {
        return res
          .status(409)
          .json({ error: { code: 'CONFLICT', message: 'This CA is already whitelisted.' } });
      }
      throw err;
    }
  }),
);

adminCaWhitelistRouter.delete(
  '/:id',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    try {
      await svc.removeFromWhitelist(req.params.id, req.user!.email);
      res.json({ data: { deleted: true } });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Entry not found.' } });
      }
      throw err;
    }
  }),
);
