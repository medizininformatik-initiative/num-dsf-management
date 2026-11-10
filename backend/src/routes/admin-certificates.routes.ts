/**
 * admin-certificates.routes.ts – Admin login certificates: own list + successor
 * (self-service) and recovery for a colleague. Mounted at /api/v1/admin.
 *
 *   GET    /me/certificates                    own certificates (current marked)
 *   POST   /me/certificates/preview { pem }    parse only, nothing stored
 *   POST   /me/certificates { pem, label? }    hand in a successor (step-up)
 *   PATCH  /me/certificates/:id { label }      rename
 *   DELETE /me/certificates/:id                remove, never the current one (step-up)
 *   GET    /admin-certificates                 all admins' certificates (overview)
 *   POST   /users/:email/certificates          REQUEST one for ANOTHER admin (four-eyes: a third
 *                                              admin approves via /admin-cert-requests; step-up, mail)
 *   DELETE /users/:email/certificates/:id      remove one of ANOTHER admin (step-up, at once; refused
 *                                              with LAST_OTHER_ADMIN_CERT when no other admin would
 *                                              keep a valid certificate; mails all admins)
 *
 * Every route is admin-only (org-scoped sessions never are). The PEM is never
 * logged or stored. Dependencies: auth/admin/totp/rateLimit middleware,
 * admin-certificates.service, certificate.service, notification.service, Zod
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { extractClientCert } from '../lib/clientCert';
import * as svc from '../services/admin-certificates.service';
import { AdminCertError } from '../services/admin-certificates.service';
import * as requests from '../services/admin-cert-requests.service';
import { CertRequestError } from '../services/admin-cert-requests.service';
import { previewCertificate } from '../services/certificate.service';
import { writeAuditLog } from '../services/audit.service';

const pemSchema = z.object({
  pem: z.string().min(1).max(20000),
  label: z.string().max(100).nullish(),
});
const labelSchema = z.object({ label: z.string().max(100).nullable() });
const previewSchema = z.object({ pem: z.string().min(1).max(20000) });

const STATUS: Record<string, number> = {
  PRIVATE_KEY_REJECTED: 400,
  INVALID_PEM: 400,
  CA_CERTIFICATE_REJECTED: 400,
  CERTIFICATE_EXPIRED: 400,
  CERTIFICATE_NOT_YET_VALID: 400,
  CA_BLACKLISTED: 400,
  CA_NOT_WHITELISTED: 400,
  NOT_AN_ADMIN: 400,
  USE_SELF_SERVICE: 400,
  CERTIFICATE_NOT_FOUND: 404,
  ADMIN_CERTIFICATE_IN_USE: 409,
  ORG_LOGIN_CERTIFICATE_IN_USE: 409,
  CURRENT_CERTIFICATE: 409,
  LAST_OTHER_ADMIN_CERT: 409,
};
const DENIAL_REASONS = new Set(['PRIVATE_KEY_REJECTED', 'CA_BLACKLISTED', 'CA_NOT_WHITELISTED']);

function fail(req: Request, res: Response, err: unknown): boolean {
  if (!(err instanceof AdminCertError)) return false;
  const status = STATUS[err.code];
  if (!status) return false;
  if (DENIAL_REASONS.has(err.code)) {
    writeAuditLog({
      userEmail: req.user?.email,
      resourceType: 'AUTH',
      operation: 'DENIED',
      diffJson: { reason: err.code, action: 'admin_certificate' },
      ipAddress: req.ip || 'unknown',
    }).catch(() => {});
  }
  res.status(status).json({ error: { code: err.code, message: err.code } });
  return true;
}

function invalid(res: Response, message: string): void {
  res.status(400).json({ error: { code: 'VALIDATION', message } });
}

export const adminCertificatesRouter = Router();

const gate = [requireAuth, requireImiAdmin];
// Step-up rate limiter for the guarded writes (skipped under jest).
const stepUp = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];

adminCertificatesRouter.get(
  '/me/certificates',
  ...gate,
  asyncHandler(async (req, res) => {
    const current = extractClientCert(req);
    if (current?.fingerprint) {
      // The presented certificate is a valid one: refresh expiry + last use (daily).
      await svc.recordAdminCertUse(current.fingerprint, current.pem);
    }
    const list = await svc.listForEmail(req.user!.email);
    res.json({
      data: list.map((c) => ({
        ...c,
        current: !!current?.fingerprint && c.fingerprint === current.fingerprint,
      })),
    });
  }),
);

adminCertificatesRouter.post(
  '/me/certificates/preview',
  ...gate,
  asyncHandler(async (req, res) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, 'pem required');
    try {
      const meta = svc.parseAdminCert(parsed.data.pem);
      const preview = await previewCertificate(parsed.data.pem);
      res.json({
        data: {
          subject: preview.subject,
          issuerDn: preview.issuerDn,
          validFrom: meta.validFrom,
          validUntil: preview.validUntil,
          thumbprintSha512: preview.thumbprintSha512,
          issuerTrusted: preview.issuerTrusted,
          issuerBlacklisted: preview.issuerBlacklisted,
          whitelistEnforced: preview.whitelistEnforced,
        },
      });
    } catch (err) {
      if (!fail(req, res, err)) throw err;
    }
  }),
);

adminCertificatesRouter.post(
  '/me/certificates',
  ...gate,
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const parsed = pemSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, 'pem required');
    try {
      const data = await svc.addAdminCertificate({
        email: req.user!.email,
        pem: parsed.data.pem,
        label: parsed.data.label,
        actor: req.user!.email,
        ip: req.ip || 'unknown',
        self: true,
      });
      res.status(201).json({ data });
    } catch (err) {
      if (!fail(req, res, err)) throw err;
    }
  }),
);

adminCertificatesRouter.patch(
  '/me/certificates/:id',
  ...gate,
  asyncHandler(async (req, res) => {
    const parsed = labelSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, 'label must be text or null');
    try {
      res.json({ data: await svc.setLabel(req.user!.email, req.params.id, parsed.data.label) });
    } catch (err) {
      if (!fail(req, res, err)) throw err;
    }
  }),
);

adminCertificatesRouter.delete(
  '/me/certificates/:id',
  ...gate,
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    try {
      await svc.removeAdminCertificate({
        email: req.user!.email,
        id: req.params.id,
        actor: req.user!.email,
        ip: req.ip || 'unknown',
        self: true,
        currentFingerprint: extractClientCert(req)?.fingerprint ?? null,
      });
      res.json({ data: { deleted: true } });
    } catch (err) {
      if (!fail(req, res, err)) throw err;
    }
  }),
);

adminCertificatesRouter.get(
  '/admin-certificates',
  ...gate,
  asyncHandler(async (_req, res) => {
    res.json({ data: await svc.listAll() });
  }),
);

adminCertificatesRouter.post(
  '/users/:email/certificates',
  ...gate,
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const parsed = pemSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, 'pem required');
    const target = req.params.email.toLowerCase().trim();
    try {
      // Four-eyes: this only OPENS a request; a third admin activates it.
      const data = await requests.createRequest({
        targetEmail: target,
        pem: parsed.data.pem,
        label: parsed.data.label,
        requestedBy: req.user!.email,
        ip: req.ip || 'unknown',
      });
      res.status(201).json({ data: { id: data.id, status: data.status } });
    } catch (err) {
      if (err instanceof CertRequestError && err.code === 'REQUEST_ALREADY_PENDING') {
        return res.status(409).json({ error: { code: err.code, message: err.code } });
      }
      if (!fail(req, res, err)) throw err;
    }
  }),
);

adminCertificatesRouter.delete(
  '/users/:email/certificates/:id',
  ...gate,
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const target = req.params.email.toLowerCase().trim();
    try {
      if (target === req.user!.email.toLowerCase().trim()) {
        throw new AdminCertError('USE_SELF_SERVICE');
      }
      // Takes effect at once; the service mails the affected and all other admins.
      await svc.removeAdminCertificate({
        email: target,
        id: req.params.id,
        actor: req.user!.email,
        ip: req.ip || 'unknown',
        self: false,
      });
      res.json({ data: { deleted: true } });
    } catch (err) {
      if (!fail(req, res, err)) throw err;
    }
  }),
);
