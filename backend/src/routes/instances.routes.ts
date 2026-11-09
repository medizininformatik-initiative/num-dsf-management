/**
 * instances.routes.ts – DSF Instance CRUD (list, create, show, rename)
 * Dependencies: auth.middleware, instances.service, asyncHandler, Zod
 *
 * All DB work lives in services/instances.service.ts — handlers stay
 * focused on request parsing + response shape.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
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
      data: await svc.listForUser(req.user!.id, req.user!.email, req.user!.scopeInstanceId),
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
