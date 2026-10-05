/**
 * onboarding.routes.ts – Admin bulk cert-onboarding endpoints: the CSV/XLSX
 * templates and the import. The import accepts a raw CSV, JSON or XLSX upload
 * (multer is intentionally NOT used — the body is read as raw bytes so
 * onboarding.service can apply its own file-level guards — size, PEM content,
 * row count — before anything is parsed as structured data), then hands the
 * validated rows to importSites for per-row transactional import.
 * `POST /parse` only parses and validates a file (no DB, no write) so many
 * files can be merged client-side. `?dryRun=true` validates and reports what would happen without writing
 * anything; as it changes nothing it skips the certificate step-up and the
 * import rate limit.
 * Dependencies: auth.middleware, admin.middleware, rateLimit.middleware,
 *               asyncHandler, onboarding.service, onboardingTemplate.service,
 *               errMessage
 */
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireCertStepUp } from '../middleware/stepUp.middleware';
import { onboardingImportRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { errMessage } from '../lib/errMessage';
import {
  parseOnboardingFile,
  parseOnboardingXlsx,
  isXlsxUpload,
  importSites,
  previewSites,
  XLSX_CONTENT_TYPE,
} from '../services/onboarding.service';
import { buildCsvTemplate, buildXlsxTemplate } from '../services/onboardingTemplate.service';

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

onboardingRouter.get('/template.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="dsf-onboarding-template.csv"');
  res.send(buildCsvTemplate());
});

onboardingRouter.get(
  '/template.xlsx',
  asyncHandler(async (_req, res) => {
    const buf = await buildXlsxTemplate();
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="dsf-onboarding-template.xlsx"');
    res.send(buf);
  }),
);

const isDryRun = (req: Request): boolean => req.query.dryRun === 'true';

// Applies a guard only to real (writing) imports; a dry run passes straight through.
function unlessDryRun(guard: (req: Request, res: Response, next: NextFunction) => unknown) {
  return (req: Request, res: Response, next: NextFunction) =>
    isDryRun(req) ? next() : guard(req, res, next);
}

// Rate limiter is skipped under jest, matching the other admin write routers.
const importLimit =
  process.env.NODE_ENV === 'test'
    ? []
    : [unlessDryRun((req, res, next) => onboardingImportRateLimit(req, res, next))];

const rawBody = express.raw({
  type: ['text/csv', 'application/json', 'text/plain', XLSX_CONTENT_TYPE],
  limit: '1mb',
});

// Parses the raw body into validated rows; on a file-level problem it sends
// the error response itself and returns null.
async function parseUpload(
  req: Request,
  res: Response,
): Promise<Awaited<ReturnType<typeof parseOnboardingXlsx>> | null> {
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    res.status(400).json({ error: { code: 'EMPTY_BODY', message: 'Request body is empty.' } });
    return null;
  }
  try {
    const contentType = req.headers['content-type'];
    return isXlsxUpload(buf, contentType)
      ? await parseOnboardingXlsx(buf)
      : parseOnboardingFile(buf, contentType);
  } catch (err: unknown) {
    const code = errMessage(err);
    const status = PARSE_ERROR_STATUS[code] ?? 400;
    res.status(status).json({
      error: {
        code: code || 'INVALID_FILE',
        message: PARSE_ERROR_MESSAGE[code] || 'Invalid upload.',
      },
    });
    return null;
  }
}

// Parse only (no DB access, nothing written): the multi-file upload reads each
// file through here and merges the rows client-side before one check / import.
onboardingRouter.post(
  '/parse',
  rawBody,
  asyncHandler(async (req, res) => {
    const parsed = await parseUpload(req, res);
    if (!parsed) return;
    const rows = parsed.valid.map((r, i) => ({ ...r, row: parsed.validRows[i] }));
    res.json({ data: { rows, parseErrors: parsed.errors } });
  }),
);

onboardingRouter.post(
  '/import',
  ...importLimit,
  unlessDryRun(requireCertStepUp),
  rawBody,
  asyncHandler(async (req, res) => {
    const parsed = await parseUpload(req, res);
    if (!parsed) return;

    const dryRun = isDryRun(req);
    const result = dryRun
      ? await previewSites(parsed.valid)
      : await importSites(parsed.valid, req.user!.email, req.ip || 'unknown');
    // `row` ties each result to its data-row number in the upload.
    const rows = result.rows.map((r, i) => ({ ...r, row: parsed.validRows[i] }));
    res.json({
      data: { dryRun, summary: result.summary, rows, parseErrors: parsed.errors },
    });
  }),
);
