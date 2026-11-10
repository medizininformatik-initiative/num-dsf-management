/**
 * admin-incidents.routes.ts – Admin actions on incidents
 * (/api/v1/admin/incidents). One admin acts alone; confirm, suspend, lift and
 * close need the fresh step-up (TOTP code or re-presented client
 * certificate), comments and field updates do not. Export downloads one
 * incident with its timeline and hash chain.
 * Dependencies: auth.middleware, admin.middleware, totp.middleware,
 *               rateLimit.middleware, validate.middleware, incidents.service,
 *               incident-suspension.service, incident-export.service,
 *               schemas/incident.schema, lib/incidentErrors, asyncHandler
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { sendIncidentError } from '../lib/incidentErrors';
import {
  closeIncidentSchema,
  commentIncidentSchema,
  exportIncidentQuerySchema,
  incidentStepUpSchema,
  liftSuspensionSchema,
  suspendIncidentSchema,
  updateIncidentSchema,
} from '../schemas/incident.schema';
import * as svc from '../services/incidents.service';
import { liftSuspension, suspendIncident } from '../services/incident-suspension.service';
import {
  buildIncidentExport,
  incidentExportCsv,
  incidentExportFilename,
} from '../services/incident-export.service';

export const adminIncidentsRouter = Router();
adminIncidentsRouter.use(requireAuth, requireImiAdmin);

// Step-up rate limiter for the step-up-gated writes (skipped under jest).
const stepUp = [
  ...(process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit]),
  requireFreshTotp,
];

const caller = (req: Request) => svc.callerOf(req.user!, req.ip || 'unknown');

/** Run an action and answer its known errors; anything else goes to the error handler. */
async function act(res: Response, status: number, run: () => Promise<unknown>): Promise<void> {
  try {
    res.status(status).json({ data: await run() });
  } catch (err) {
    if (!sendIncidentError(res, err)) throw err;
  }
}

adminIncidentsRouter.post(
  '/:id/confirm',
  ...stepUp,
  validate(incidentStepUpSchema),
  asyncHandler(async (req, res) => {
    await act(res, 200, async () => svc.confirmIncident(req.params.id, await caller(req)));
  }),
);

adminIncidentsRouter.post(
  '/:id/suspend',
  ...stepUp,
  validate(suspendIncidentSchema),
  asyncHandler(async (req, res) => {
    await act(res, 200, async () =>
      suspendIncident(
        req.params.id,
        req.body.measures,
        req.body.confirm === true,
        await caller(req),
      ),
    );
  }),
);

adminIncidentsRouter.post(
  '/:id/lift-suspension',
  ...stepUp,
  validate(liftSuspensionSchema),
  asyncHandler(async (req, res) => {
    const { totpCode: _totp, ...checklist } = req.body;
    await act(res, 200, async () => liftSuspension(req.params.id, checklist, await caller(req)));
  }),
);

adminIncidentsRouter.post(
  '/:id/close',
  ...stepUp,
  validate(closeIncidentSchema),
  asyncHandler(async (req, res) => {
    await act(res, 200, async () =>
      svc.closeIncident(req.params.id, req.body.outcome, req.body.note, await caller(req)),
    );
  }),
);

adminIncidentsRouter.post(
  '/:id/comment',
  validate(commentIncidentSchema),
  asyncHandler(async (req, res) => {
    await act(res, 201, async () =>
      svc.commentIncident(req.params.id, req.body.text, await caller(req)),
    );
  }),
);

adminIncidentsRouter.patch(
  '/:id',
  validate(updateIncidentSchema),
  asyncHandler(async (req, res) => {
    await act(res, 200, async () => svc.updateIncident(req.params.id, req.body, await caller(req)));
  }),
);

adminIncidentsRouter.get(
  '/:id/export',
  validate(exportIncidentQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const c = await caller(req);
    try {
      const doc = await buildIncidentExport(req.params.id, c);
      await svc.auditIncident(
        { id: doc.incident.id, organization_id: doc.incident.organization?.identifier ?? null },
        c,
        'UPDATE',
        { action: 'incident_export', format },
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${incidentExportFilename(doc.incident.id, format)}"`,
      );
      if (format === 'csv') {
        res.type('text/csv; charset=utf-8').send(incidentExportCsv(doc));
      } else {
        res.type('application/json').send(JSON.stringify(doc, null, 2));
      }
    } catch (err) {
      if (!sendIncidentError(res, err)) throw err;
    }
  }),
);
