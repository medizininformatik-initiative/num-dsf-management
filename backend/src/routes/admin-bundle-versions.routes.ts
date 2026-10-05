/**
 * admin-bundle-versions.routes.ts – Admin read API for the bundle history.
 * Dependencies: auth.middleware, admin.middleware, asyncHandler, Zod,
 *               bundle-versions.service
 *
 * Endpoints (all behind requireAuth + requireImiAdmin):
 *   GET    /admin/bundle-versions               — paginated list
 *   GET    /admin/bundle-versions/:id           — single version + parsed bundle
 *   GET    /admin/bundle-versions/:id/download  — raw bundle JSON (Content-Disposition attachment)
 *   POST   /admin/bundle-versions/:id/restore   — request the restore of an old version (four-eyes, step-up)
 *   GET    /admin/bundle-versions/:idA/diff/:idB
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import * as svc from '../services/bundle-versions.service';
import { createRestoreRequest } from '../services/bundle-restore.service';
import { sendRestoreError } from './admin-bundle-restores.routes';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const restoreSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  totpCode: z.string().length(6).optional(),
});

export const adminBundleVersionsRouter = Router();
adminBundleVersionsRouter.use(requireAuth, requireImiAdmin);

// Step-up rate limiter for the guarded write (skipped under jest).
const stepUp = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

adminBundleVersionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = listSchema.parse(req.query);
    const { rows, total } = await svc.listVersions(parsed);
    res.json({
      data: rows,
      meta: {
        page: parsed.page,
        limit: parsed.limit,
        total,
        pages: Math.ceil(total / parsed.limit),
      },
    });
  }),
);

adminBundleVersionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const v = await svc.getVersion(req.params.id);
    res.json({ data: v });
  }),
);

adminBundleVersionsRouter.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const v = await svc.getVersion(req.params.id);
    res.setHeader('Content-Type', 'application/fhir+json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dsf-bundle-v${v.version_number}.json"`,
    );
    res.setHeader('X-Bundle-Signature', v.signature);
    res.setHeader('X-Content-Hash', v.content_hash);
    res.send(v.bundle_json);
  }),
);

// Request the restore of an old version (four-eyes). A second admin of another
// site must approve it (POST /admin/bundle-restores/:rid/approve) before anything
// is published. Step-up like every admin write.
adminBundleVersionsRouter.post(
  '/:id/restore',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const parsed = restoreSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: parsed.error.errors[0]?.message || 'Invalid input' },
      });
    }
    try {
      const data = await createRestoreRequest(
        req.params.id,
        parsed.data.reason,
        req.user!.email,
        req.ip,
      );
      res.status(201).json({ data });
    } catch (err) {
      if (!sendRestoreError(err, res)) throw err;
    }
  }),
);

adminBundleVersionsRouter.get(
  '/:idA/diff/:idB',
  asyncHandler(async (req, res) => {
    const diff = await svc.diffVersions(req.params.idA, req.params.idB);
    res.json({ data: diff });
  }),
);
