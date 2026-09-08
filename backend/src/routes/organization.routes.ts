/**
 * organization.routes.ts – Organization upsert + removal-request
 * Dependencies: auth/instance middleware, organization.service, schema, sanitizeError
 *
 * client_cert_thumbprint writes are gated by an admin-vs-owner check
 * (FORBIDDEN_THUMBPRINT_WRITE) so an admin's session can't plant a
 * thumbprint on a victim org.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
import { validate } from '../middleware/validate.middleware';
import { upsertOrganizationSchema } from '../schemas/organization.schema';
import * as svc from '../services/organization.service';
import { asyncHandler } from '../lib/asyncHandler';
import { db } from '../db/connection';
import { checkStepUp } from '../middleware/stepUp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';

export const organizationRouter = Router({ mergeParams: true });
organizationRouter.use(requireAuth, requireInstanceOwnership);

// Step-up rate limiter guarding the conditional re-verification below (skipped under jest).
const stepUpLimiter = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

organizationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const org = await svc.getOrganization(req.instance!.id);
    res.json({ data: org });
  }),
);

organizationRouter.put(
  '/',
  ...stepUpLimiter,
  validate(upsertOrganizationSchema),
  asyncHandler(async (req, res) => {
    const existingOrgRow = await db('organizations')
      .where({ instance_id: req.instance!.id })
      .first();
    const existingThumb = existingOrgRow?.client_cert_thumbprint ?? null;
    const incomingThumb = (req.body?.clientCertThumbprint ?? null) || null;

    // Step-up required when the owner is changing client_cert_thumbprint.
    // Same-value re-saves (unchanged form submit) are allowed without it.
    const isCrossUser = req.instance!.user_id !== req.user!.id;
    if (!isCrossUser && existingThumb !== incomingThumb) {
      const result = await checkStepUp(req);
      if (!result.ok) {
        return res
          .status(result.status)
          .json({ error: { code: result.code, message: result.message } });
      }
    }

    // Defense against admin planting a thumbprint on a victim org and then
    // calling /auth/client-cert-login to impersonate the victim. Admins may
    // still freely edit non-cert fields on another user's instance, but the
    // thumbprint — which is the auth credential — is locked to the owner.
    if (isCrossUser && existingThumb !== incomingThumb) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN_THUMBPRINT_WRITE',
          message: "Admins cannot modify client_cert_thumbprint on another user's organization.",
        },
      });
    }

    const org = await svc.upsertOrganization(
      req.instance!.id,
      req.body,
      req.user!.email,
      req.ip || 'unknown',
    );
    res.json({ data: org });
  }),
);

organizationRouter.post(
  '/request-removal',
  asyncHandler(async (req, res) => {
    const { submitApproval } = await import('../services/approval.service');
    const request = await submitApproval(req.instance!.id, req.user!.email, req.ip || 'unknown');
    res.json({ data: request });
  }),
);
