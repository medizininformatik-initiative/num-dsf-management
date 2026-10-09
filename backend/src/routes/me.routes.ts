/**
 * me.routes.ts – Returns the authenticated user's identity and admin flag
 * Mounted at /auth/me
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { isAdminCaller } from '../lib/isAdmin';
import { asyncHandler } from '../lib/asyncHandler';

export const meRouter = Router();

meRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      data: {
        email: req.user!.email,
        isAdmin: await isAdminCaller(req.user),
      },
    });
  }),
);
