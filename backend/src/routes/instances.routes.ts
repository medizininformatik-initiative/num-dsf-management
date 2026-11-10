/**
 * instances.routes.ts – DSF Instance CRUD (list, create, show, rename, archive, delete)
 * Dependencies: auth.middleware, stepUp.middleware, instances.service, asyncHandler, Zod
 *
 * All DB work lives in services/instances.service.ts — handlers stay
 * focused on request parsing + response shape.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
import { requireStepUp } from '../middleware/stepUp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import * as svc from '../services/instances.service';
import { resolveReceiver } from '../services/fhir.service';
import { listReceiverHistory } from '../services/bundle-versions.service';

const labelSchema = z.object({
  label: z.string().trim().min(1, 'label required').max(255, 'label too long'),
});

export const instancesRouter = Router();
instancesRouter.use(requireAuth);

instancesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      data: await svc.listForUser(req.user!.id, req.user!.email, req.user!.scopeInstanceId, {
        includeArchived: req.query.includeArchived === 'true',
      }),
    });
  }),
);

instancesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user!.scopeInstanceId) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'A site login cannot create instances' },
      });
    }
    const instance = await svc.createInstance(req.user!.id, req.user!.email, req.ip || 'unknown');
    res.status(201).json({ data: instance });
  }),
);

instancesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const instance = await svc.getInstance(
      req.params.id,
      req.user!.email,
      req.user!.scopeInstanceId,
    );
    if (!instance)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Instance not found' } });
    res.json({ data: instance });
  }),
);

// Versions of the published allow list a site can download for one of its
// endpoints (newest first); the endpoint must belong to the instance.
instancesRouter.get(
  '/:id/bundle-history',
  requireInstanceOwnership,
  asyncHandler(async (req, res) => {
    const endpointId = typeof req.query.endpointId === 'string' ? req.query.endpointId : '';
    if (!endpointId) {
      return res
        .status(400)
        .json({ error: { code: 'MISSING_ENDPOINT', message: 'endpointId required' } });
    }
    try {
      await resolveReceiver(req.instance!.id, endpointId);
    } catch {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 50, 1), 200);
    res.json({ data: await listReceiverHistory({ limit }) });
  }),
);

instancesRouter.put(
  '/:id/label',
  asyncHandler(async (req, res) => {
    const parsed = labelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message || 'Invalid label' },
      });
    }
    if (req.user!.scopeInstanceId && req.user!.scopeInstanceId !== req.params.id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN' } });
    }
    const updated = await svc.renameInstance(req.params.id, req.user!.id, parsed.data.label);
    if (!updated) return res.status(403).json({ error: { code: 'FORBIDDEN' } });
    res.json({ data: updated });
  }),
);

// Archive / unarchive / delete are owner actions. A site login (organization
// certificate session) runs as the owner's user but must not manage the
// instance itself.
function ownerSessionOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.user!.scopeInstanceId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'A site login cannot do this' } });
    return;
  }
  next();
}

const notOwner = { error: { code: 'FORBIDDEN', message: 'Only the owner can do this' } };

instancesRouter.put(
  '/:id/archive',
  ownerSessionOnly,
  asyncHandler(async (req, res) => {
    const updated = await svc.archiveInstance(
      req.params.id,
      req.user!.id,
      req.user!.email,
      req.ip || 'unknown',
    );
    if (!updated) return res.status(403).json(notOwner);
    res.json({ data: updated });
  }),
);

instancesRouter.put(
  '/:id/unarchive',
  ownerSessionOnly,
  asyncHandler(async (req, res) => {
    const updated = await svc.unarchiveInstance(
      req.params.id,
      req.user!.id,
      req.user!.email,
      req.ip || 'unknown',
    );
    if (!updated) return res.status(403).json(notOwner);
    res.json({ data: updated });
  }),
);

// Step-up rate limiter guarding the TOTP re-verification (skipped under jest).
const stepUpLimiter = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

// Only an instance that was never approved or published can be deleted; any
// other instance can only be archived (409 INSTANCE_HAS_HISTORY).
instancesRouter.delete(
  '/:id',
  ownerSessionOnly,
  ...stepUpLimiter,
  requireStepUp,
  asyncHandler(async (req, res) => {
    try {
      const deleted = await svc.deleteInstance(
        req.params.id,
        req.user!.id,
        req.user!.email,
        req.ip || 'unknown',
      );
      if (!deleted) return res.status(403).json(notOwner);
      res.json({ data: { deleted: true } });
    } catch (e) {
      if (e instanceof Error && e.message === 'INSTANCE_HAS_HISTORY') {
        return res.status(409).json({
          error: {
            code: 'INSTANCE_HAS_HISTORY',
            message:
              'This instance was approved, published or has an incident. Archive it instead.',
          },
        });
      }
      throw e;
    }
  }),
);
