/**
 * allowlist-freshness.routes.ts – has this site obtained the current allow list?
 * Dependencies: auth.middleware, instance.middleware, allowlist-freshness.service
 *
 *   GET /instances/:instanceId/allow-list/freshness   (requireAuth + requireInstanceOwnership)
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
import { getAllowListFreshness } from '../services/allowlist-freshness.service';
import { asyncHandler } from '../lib/asyncHandler';

export const allowListFreshnessRouter = Router({ mergeParams: true });

allowListFreshnessRouter.get(
  '/freshness',
  requireAuth,
  requireInstanceOwnership,
  asyncHandler(async (req, res) => {
    res.json({ data: await getAllowListFreshness(req.instance!.id) });
  }),
);
