/**
 * admin-approval.routes.ts – Admin-only approval management endpoints
 * Mounted at /api/v1/admin/approval
 * Dependencies: approval.service, stepUp.middleware, auth.middleware, admin.middleware, rateLimit.middleware
 *
 * approve/reject are rate-limited per-user via stepUpTotpRateLimit, matching
 * the other admin routers' step-up guards. The IP-keyed otpRateLimit (meant
 * for pre-auth OTP requests) would let admins behind the same NAT/proxy
 * throttle each other, so it is not used here.
 */
import { Router, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireStepUp } from '../middleware/stepUp.middleware';
import * as svc from '../services/approval.service';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { writeAuditLog } from '../services/audit.service';

export const adminApprovalRouter = Router();

const totpLimiter = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

adminApprovalRouter.get(
  '/pending',
  requireAuth,
  requireImiAdmin,
  async (_req, res, next: NextFunction) => {
    try {
      const requests = await svc.getPendingApprovals();
      const sigsByRequest = await svc.getSignaturesForRequests(requests.map((r: any) => r.id));
      const enriched = requests.map((r: any) => ({
        ...r,
        signatures: sigsByRequest.get(r.id) ?? [],
      }));
      res.json({ data: enriched });
    } catch (e) {
      // Forward to the global error handler — an unguarded throw from an async
      // handler is an unhandled rejection (Express 4) and would crash the process.
      next(e);
    }
  },
);

adminApprovalRouter.post(
  '/:rid/approve',
  requireAuth,
  requireImiAdmin,
  ...totpLimiter,
  requireStepUp,
  async (req, res, next: NextFunction) => {
    try {
      const result = await svc.approveRequest(req.params.rid, req.user!.email, req.ip || 'unknown');
      res.json({ data: result });
    } catch (e: any) {
      const code = e?.message;
      if (code === 'ALREADY_DECIDED' || code === 'ALREADY_APPROVED_SAME_SITE') {
        // Four-eyes violation attempts (same admin twice, same site twice) stay in the audit trail.
        writeAuditLog({
          userEmail: req.user!.email,
          resourceType: 'APPROVAL',
          resourceId: req.params.rid,
          operation: 'DENIED',
          diffJson: { reason: code },
          ipAddress: req.ip || 'unknown',
        }).catch(() => {});
      }
      if (code === 'ALREADY_DECIDED')
        return res
          .status(409)
          .json({ error: { code, message: 'You already decided this request.' } });
      if (code === 'ALREADY_APPROVED_SAME_SITE')
        return res
          .status(409)
          .json({ error: { code, message: 'Another admin from your site has already approved.' } });
      if (code === 'REQUEST_REJECTED')
        return res.status(409).json({ error: { code, message: 'Request was already rejected.' } });
      if (code === 'REQUEST_APPROVED')
        return res.status(409).json({ error: { code, message: 'Request was already approved.' } });
      if (code === 'REQUEST_FINALIZED')
        return res.status(409).json({ error: { code, message: 'Request is no longer pending.' } });
      if (code === 'INVALID_ADMIN_EMAIL')
        return res.status(400).json({ error: { code, message: 'Invalid admin email.' } });
      if (code === 'REQUEST_NOT_FOUND')
        return res.status(404).json({ error: { code, message: 'Request not found.' } });
      // Unmapped error → global handler (sanitized 500). Never `throw` here:
      // an async-handler throw is an unhandled rejection that crashes the process.
      next(e);
    }
  },
);

adminApprovalRouter.post(
  '/:rid/reject',
  requireAuth,
  requireImiAdmin,
  ...totpLimiter,
  requireStepUp,
  async (req, res, next: NextFunction) => {
    try {
      const { comment } = req.body;
      await svc.rejectRequest(req.params.rid, req.user!.email, comment || '', req.ip || 'unknown');
      res.json({ data: { status: 'REJECTED' } });
    } catch (e: any) {
      const code = e?.message;
      if (code === 'ALREADY_DECIDED')
        return res
          .status(409)
          .json({ error: { code, message: 'You already decided this request.' } });
      if (code === 'REQUEST_FINALIZED')
        return res.status(409).json({ error: { code, message: 'Request is no longer pending.' } });
      if (code === 'INVALID_ADMIN_EMAIL')
        return res.status(400).json({ error: { code, message: 'Invalid admin email.' } });
      if (code === 'REQUEST_NOT_FOUND')
        return res.status(404).json({ error: { code, message: 'Request not found.' } });
      // Unmapped error → global handler (sanitized 500). Never `throw` here:
      // an async-handler throw is an unhandled rejection that crashes the process.
      next(e);
    }
  },
);
