/**
 * certificates.routes.ts – Certificate CRUD + renewal + upload preview + expiry probe
 * Dependencies: auth/instance middleware, certificate.service, sanitizeError
 *
 * SECURITY: PEM uploads are screened by rejectPrivateKey() before any
 * parsing or storage — see certificate.service.ts.
 */
import { Router, type Request } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
import { validate } from '../middleware/validate.middleware';
import { createCertificateSchema, renewCertificateSchema } from '../schemas/certificate.schema';
import * as svc from '../services/certificate.service';
import { listForInstance as listLoginCertificates } from '../services/org-login-certificates.service';
import { db } from '../db/connection';
import { sanitizeError } from '../lib/sanitizeError';
import { asyncHandler } from '../lib/asyncHandler';
import { writeAuditLog } from '../services/audit.service';
import { isAdminCaller } from '../lib/isAdmin';

const DENIAL_REASONS = new Set([
  'PRIVATE_KEY_REJECTED',
  'CA_BLACKLISTED',
  'CA_NOT_WHITELISTED',
  'CERT_REGISTERED_ELSEWHERE',
]);

/** Audit a refused certificate upload (never the PEM itself) without blocking the response. */
function auditCertificateDenial(req: Request, err: unknown): void {
  const reason = err instanceof Error ? err.message : '';
  if (!DENIAL_REASONS.has(reason)) return;
  writeAuditLog({
    userEmail: req.user?.email,
    instanceId: req.instance?.id,
    resourceType: 'CERTIFICATE',
    operation: 'DENIED',
    diffJson: { reason },
    ipAddress: req.ip || 'unknown',
  }).catch(() => {});
}

/** 409 when another organization holds the certificate, else 400. */
function uploadErrorStatus(err: unknown): number {
  return err instanceof Error && err.message === 'CERT_REGISTERED_ELSEWHERE' ? 409 : 400;
}

export const certificatesRouter = Router({ mergeParams: true });
certificatesRouter.use(requireAuth, requireInstanceOwnership);

certificatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: await svc.getCertificates(req.instance!.id) });
  }),
);

// Which certificates may log in as the organization (read-only; admins change
// this via /api/v1/admin/organizations/:identifier/login-certificates).
certificatesRouter.get(
  '/login-certificates',
  asyncHandler(async (req, res) => {
    res.json({ data: await listLoginCertificates(req.instance!.id) });
  }),
);

certificatesRouter.get(
  '/expiring',
  asyncHandler(async (req, res) => {
    const org = await db('organizations').where({ instance_id: req.instance!.id }).first();
    if (!org) return res.json({ data: [] });
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);
    const expiring = await db('certificates')
      .where({ organization_id: org.identifier })
      .where('valid_until', '<=', ninetyDaysFromNow)
      .select('id', 'subject', 'thumbprint', 'valid_until');
    res.json({ data: expiring });
  }),
);

certificatesRouter.post('/', validate(createCertificateSchema), async (req, res) => {
  try {
    const cert = await svc.createCertificate(
      req.instance!.id,
      req.body.pem,
      req.user!.email,
      req.ip || 'unknown',
      await isAdminCaller(req.user),
    );
    res.status(201).json({ data: cert });
  } catch (err: unknown) {
    auditCertificateDenial(req, err);
    if (err instanceof Error && err.message === 'PRIVATE_KEY_REJECTED') {
      return res
        .status(400)
        .json({ error: { code: 'PRIVATE_KEY_REJECTED', message: 'Private keys are not allowed' } });
    }
    // Known business codes (INVALID_PEM, CA_BLACKLISTED, CA_NOT_WHITELISTED)
    // pass through so the UI can explain the rejection; anything else is masked.
    res.status(uploadErrorStatus(err)).json({ error: sanitizeError(err) });
  }
});

// Parse without storing, so the upload dialog can show what would be
// registered (subject, expiry, DSF fingerprint, issuer checks) before saving.
certificatesRouter.post('/preview', validate(createCertificateSchema), async (req, res) => {
  try {
    res.json({ data: await svc.previewCertificate(req.body.pem) });
  } catch (err: unknown) {
    auditCertificateDenial(req, err);
    if (err instanceof Error && err.message === 'PRIVATE_KEY_REJECTED') {
      return res
        .status(400)
        .json({ error: { code: 'PRIVATE_KEY_REJECTED', message: 'Private keys are not allowed' } });
    }
    res.status(400).json({ error: sanitizeError(err) });
  }
});

certificatesRouter.delete(
  '/:cid',
  asyncHandler(async (req, res) => {
    await svc.deleteCertificate(
      req.instance!.id,
      req.params.cid,
      req.user!.email,
      req.ip || 'unknown',
    );
    res.json({ data: { deleted: true } });
  }),
);

certificatesRouter.post('/:cid/renew', validate(renewCertificateSchema), async (req, res) => {
  try {
    const cert = await svc.renewCertificate(
      req.instance!.id,
      req.params.cid,
      req.body,
      req.user!.email,
      req.ip || 'unknown',
      await isAdminCaller(req.user),
    );
    res.json({ data: cert });
  } catch (err: unknown) {
    auditCertificateDenial(req, err);
    if (err instanceof Error && err.message === 'PRIVATE_KEY_REJECTED') {
      return res
        .status(400)
        .json({ error: { code: 'PRIVATE_KEY_REJECTED', message: 'Private keys are not allowed' } });
    }
    res.status(uploadErrorStatus(err)).json({ error: sanitizeError(err) });
  }
});
