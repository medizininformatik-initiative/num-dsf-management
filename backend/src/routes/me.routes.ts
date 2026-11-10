/**
 * me.routes.ts – Returns the authenticated user's identity and admin flag
 * Mounted at /auth/me. totpEnrolmentRequired is true for an admin who signed
 * in with a certificate and still has to set up TOTP; that session may use
 * this route (it is how the frontend learns it must enrol) but little else.
 */
import { Router } from 'express';
import { requireAuthAllowEnrolment } from '../middleware/auth.middleware';
import { isAdminCaller } from '../lib/isAdmin';
import { isTotpEnrolmentRequired } from '../lib/totpEnrolment';
import { asyncHandler } from '../lib/asyncHandler';

export const meRouter = Router();

meRouter.get(
  '/',
  requireAuthAllowEnrolment,
  asyncHandler(async (req, res) => {
    res.json({
      data: {
        email: req.user!.email,
        isAdmin: await isAdminCaller(req.user),
        totpEnrolmentRequired: await isTotpEnrolmentRequired(req.user!),
      },
    });
  }),
);
