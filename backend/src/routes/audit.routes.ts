/**
 * audit.routes.ts – Audit-log read + export endpoints
 * Dependencies: auth.middleware, instance.middleware, validate.middleware,
 *               auditQuery.service, auditExport.service, audit.service, isAdmin, query schema
 *
 * Two routers exported:
 *   auditRouter              — per-instance audit (requireInstanceOwnership)
 *     GET /           paged, filtered, with anomaly flags
 *     GET /export     CSV / JSON of the current filter set
 *   crossInstanceAuditRouter — cross-instance; admins see all sites, others only
 *                              the sites they own. The all-sites export is admin-only.
 *
 * Audit_logs is append-only at the DB layer (see migration 013).
 * All query logic lives in services/auditQuery.service.ts.
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { auditExportQuerySchema, auditQuerySchema } from '../schemas/query.schema';
import { isAdminEmail } from '../lib/isAdmin';
import * as svc from '../services/auditQuery.service';
import { writeAuditLog } from '../services/audit.service';
import { EXPORT_ROW_CAP, exportFilename, streamAuditExport } from '../services/auditExport.service';

type ExportQuery = svc.AuditFilters & { format: 'csv' | 'json' };

/** Filters out of the validated query (everything except paging / format). */
function filtersOf(q: svc.AuditFilters): svc.AuditFilters {
  const { resource, operation, from, to, actor, instanceId, q: text, flaggedOnly } = q;
  return { resource, operation, from, to, actor, instanceId, q: text, flaggedOnly };
}

/** Run the export for a scope: query, audit the export itself, stream the file. */
async function runExport(
  req: Request,
  res: Response,
  scope: svc.AuditScope,
  fileScope: string,
  instanceId?: string,
): Promise<void> {
  const { format, ...rest } = req.query as unknown as ExportQuery;
  const filters = filtersOf(rest);
  const { rows, truncated } = await svc.queryAuditForExport(scope, filters, EXPORT_ROW_CAP);

  await writeAuditLog({
    userEmail: req.user!.email,
    instanceId,
    resourceType: 'AUDIT',
    operation: 'EXPORT',
    diffJson: {
      format,
      scope: fileScope,
      rows: rows.length,
      truncated,
      filters: Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''),
      ),
    },
    ipAddress: req.ip || 'unknown',
  });

  await streamAuditExport(res, rows, format, exportFilename(fileScope, format), truncated);
}

export const auditRouter = Router({ mergeParams: true });
auditRouter.use(requireAuth, requireInstanceOwnership);

auditRouter.get(
  '/',
  validate(auditQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const params = req.query as unknown as svc.AuditQueryParams;
    const { rows, total, summary } = await svc.listInstanceAudit(req.instance!.id, params);
    res.json({
      data: rows,
      meta: {
        page: params.page,
        limit: params.limit,
        total,
        pages: Math.ceil(total / params.limit),
        summary,
      },
    });
  }),
);

auditRouter.get(
  '/export',
  validate(auditExportQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const instanceId = req.instance!.id;
    await runExport(
      req,
      res,
      { kind: 'instance', instanceId },
      `site-${instanceId.slice(0, 8)}`,
      instanceId,
    );
  }),
);

// Cross-instance audit router — user scope (no instance ownership check).
// Admins see all rows; non-admins see only audit_logs whose instance they own.
export const crossInstanceAuditRouter = Router();

crossInstanceAuditRouter.get(
  '/',
  requireAuth,
  validate(auditQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const isAdmin = await isAdminEmail(req.user!.email);
    const params = req.query as unknown as svc.AuditQueryParams;

    const { rows, total, summary } = await svc.listCrossInstanceAudit(
      req.user!.id,
      isAdmin,
      params,
    );

    res.json({
      data: rows,
      meta: {
        total,
        page: params.page,
        limit: params.limit,
        pages: Math.ceil(total / params.limit),
        isAdmin,
        summary,
      },
    });
  }),
);

// All-sites export: admin only. Site users export their own site via the
// per-instance route.
crossInstanceAuditRouter.get(
  '/export',
  requireAuth,
  validate(auditExportQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!(await isAdminEmail(req.user!.email))) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Exporting the audit log of all sites requires admin.',
        },
      });
      return;
    }
    await runExport(req, res, { kind: 'all' }, 'all');
  }),
);
