/**
 * onboarding.routes.ts – Admin bulk cert-onboarding import endpoint.
 * Accepts a raw CSV or JSON upload (multer is intentionally NOT used — the
 * body is read as raw bytes so onboarding.service can apply its own
 * file-level guards — size, PEM content, row count — before anything is
 * parsed as structured data), then hands the validated rows to importSites
 * for per-row transactional import.
 * Dependencies: auth.middleware, admin.middleware, rateLimit.middleware,
 *               asyncHandler, onboarding.service, errMessage
 */
import express, { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireCertStepUp } from '../middleware/stepUp.middleware';
import { onboardingImportRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { errMessage } from '../lib/errMessage';
import { parseOnboardingFile, importSites } from '../services/onboarding.service';

// Maps onboarding.service's thrown file-level error codes to an HTTP status.
const PARSE_ERROR_STATUS: Record<string, number> = {
  FILE_TOO_LARGE: 413,
  PEM_NOT_ALLOWED: 400,
  UNSUPPORTED_FORMAT: 415,
  TOO_MANY_ROWS: 413,
};

const PARSE_ERROR_MESSAGE: Record<string, string> = {
  FILE_TOO_LARGE: 'Uploaded file exceeds the maximum allowed size.',
  PEM_NOT_ALLOWED: 'PEM or private key content is not allowed in this upload.',
  UNSUPPORTED_FORMAT: 'Unsupported or unparseable file format.',
  TOO_MANY_ROWS: 'Uploaded file has too many rows.',
};

export const onboardingRouter = Router();
onboardingRouter.use(requireAuth, requireImiAdmin);

// Rate limiter is skipped under jest, matching the other admin write routers.
const importLimit = process.env.NODE_ENV === 'test' ? [] : [onboardingImportRateLimit];

const rawBody = express.raw({
  type: ['text/csv', 'application/json', 'text/plain'],
  limit: '1mb',
});

onboardingRouter.post(
  '/import',
  ...importLimit,
  requireCertStepUp,
  rawBody,
  asyncHandler(async (req, res) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: { code: 'EMPTY_BODY', message: 'Request body is empty.' } });
      return;
    }

    let parsed: ReturnType<typeof parseOnboardingFile>;
    try {
      parsed = parseOnboardingFile(buf, req.headers['content-type']);
    } catch (err: unknown) {
      const code = errMessage(err);
      const status = PARSE_ERROR_STATUS[code] ?? 400;
      res.status(status).json({
        error: {
          code: code || 'INVALID_FILE',
          message: PARSE_ERROR_MESSAGE[code] || 'Invalid upload.',
        },
      });
      return;
    }

    const result = await importSites(parsed.valid, req.user!.email, req.ip || 'unknown');
    res.json({
      data: { summary: result.summary, rows: result.rows, parseErrors: parsed.errors },
    });
  }),
);
