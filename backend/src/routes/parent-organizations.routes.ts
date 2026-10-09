/**
 * parent-organizations.routes.ts — parent organizations for the membership form
 * Mounted at /api/v1/parent-organizations; any authenticated user.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { listParentOrganizations } from '../services/parentOrganizations.service';
import { asyncHandler } from '../lib/asyncHandler';

export const parentOrganizationsRouter = Router();

parentOrganizationsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ data: await listParentOrganizations(), error: null });
  }),
);
