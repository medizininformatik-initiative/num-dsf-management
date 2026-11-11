/**
 * incidents.routes.ts – Incident register for every signed-in user
 * (/api/v1/incidents): report an incident, list and read the visible ones,
 * save the NIS2 report fields, request an interim report and tick "reported
 * to BSI" / "DPO informed". Admins see everything through
 * the same reads; their actions live in admin-incidents.routes.
 * Dependencies: auth.middleware, validate.middleware, rateLimit.middleware,
 *               incidents.service, incident-events.service, schemas/incident.schema,
 *               incident-nis2.service, schemas/nis2Report.schema, lib/incidentErrors,
 *               lib/nis2Deadlines, lib/nis2Entries, asyncHandler
 */
import { Router, type Request } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { incidentReportRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { sendIncidentError } from '../lib/incidentErrors';
import { NIS2_STAGES, type Nis2Stage } from '../lib/nis2Deadlines';
import { reportIncidentSchema } from '../schemas/incident.schema';
import { interimRequestSchema, nis2DraftSchema } from '../schemas/nis2Report.schema';
import { FIELD_STAGE } from '../lib/nis2Entries';
import { requestInterimReport, updateNis2Fields } from '../services/incident-nis2.service';
import * as svc from '../services/incidents.service';
import { listEvents, verifyEvents } from '../services/incident-events.service';

export const incidentsRouter = Router();
incidentsRouter.use(requireAuth);

// Rate limit skipped under jest, like the other per-user limiters.
const reportLimit = process.env.NODE_ENV === 'test' ? [] : [incidentReportRateLimit];

const caller = (req: Request) => svc.callerOf(req.user!, req.ip || 'unknown');

incidentsRouter.get(
  '/organizations',
  asyncHandler(async (req, res) => {
    res.json({ data: await svc.listOrganizations(await caller(req)) });
  }),
);

incidentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: await svc.listIncidents(await caller(req)) });
  }),
);

incidentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const c = await caller(req);
    try {
      const row = await svc.requireVisible(req.params.id, c);
      const events = await listEvents(row.id);
      res.json({
        data: {
          incident: svc.toApi(row, c),
          events: events.map((e) => svc.eventForCaller(e, row, c)),
          chain: verifyEvents(row.id, events, svc.hashedFieldsOf(row)),
        },
      });
    } catch (err) {
      if (!sendIncidentError(res, err)) throw err;
    }
  }),
);

incidentsRouter.post(
  '/',
  ...reportLimit,
  validate(reportIncidentSchema),
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json({ data: await svc.reportIncident(req.body, await caller(req)) });
    } catch (err) {
      if (!sendIncidentError(res, err)) throw err;
    }
  }),
);

// The BSI asked for an interim report (date of the request).
incidentsRouter.post(
  '/:id/nis2/interim-request',
  validate(interimRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      res.json({
        data: await requestInterimReport(req.params.id, req.body.requestedAt, await caller(req)),
      });
    } catch (err) {
      if (!sendIncidentError(res, err)) throw err;
    }
  }),
);

// Save the report fields of a stage (a draft; ticking the stage needs the full set).
incidentsRouter.put(
  '/:id/nis2/:stage/fields',
  asyncHandler(async (req, res) => {
    const stage = req.params.stage as Nis2Stage;
    if (!NIS2_STAGES.includes(stage)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Unknown NIS2 stage' } });
    }
    const fieldStage = FIELD_STAGE[stage];
    if (!fieldStage) {
      return sendIncidentError(res, new Error('NIS2_STAGE_WITHOUT_FIELDS'));
    }
    const parsed = nis2DraftSchema[fieldStage].safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Invalid input', details: parsed.error.issues },
      });
    }
    try {
      res.json({
        data: await updateNis2Fields(
          req.params.id,
          stage,
          parsed.data as Record<string, string>,
          await caller(req),
        ),
      });
    } catch (err) {
      if (!sendIncidentError(res, err)) throw err;
    }
  }),
);

incidentsRouter.post(
  '/:id/nis2/:stage',
  asyncHandler(async (req, res) => {
    const stage = req.params.stage as Nis2Stage;
    if (!NIS2_STAGES.includes(stage)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Unknown NIS2 stage' } });
    }
    try {
      res.json({ data: await svc.acknowledgeNis2(req.params.id, stage, await caller(req)) });
    } catch (err) {
      if (!sendIncidentError(res, err)) throw err;
    }
  }),
);

incidentsRouter.post(
  '/:id/dpo-informed',
  asyncHandler(async (req, res) => {
    try {
      res.json({ data: await svc.acknowledgeDpo(req.params.id, await caller(req)) });
    } catch (err) {
      if (!sendIncidentError(res, err)) throw err;
    }
  }),
);
