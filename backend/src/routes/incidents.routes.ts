/**
 * incidents.routes.ts – Incident register for every signed-in user
 * (/api/v1/incidents): report an incident, list and read the visible ones,
 * and tick "reported to BSI" / "DPO informed". Admins see everything through
 * the same reads; their actions live in admin-incidents.routes.
 * Dependencies: auth.middleware, validate.middleware, rateLimit.middleware,
 *               incidents.service, incident-events.service, schemas/incident.schema,
 *               lib/incidentErrors, lib/nis2Deadlines, asyncHandler
 */
import { Router, type Request } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { sendIncidentError } from '../lib/incidentErrors';
import * as svc from '../services/incidents.service';
import { listEvents, verifyEvents } from '../services/incident-events.service';

export const incidentsRouter = Router();
incidentsRouter.use(requireAuth);

const caller = (req: Request) => svc.callerOf(req.user!, req.ip || 'unknown');

incidentsRouter.get(
  '/organizations',
  asyncHandler(async (_req, res) => {
    res.json({ data: await svc.listOrganizations() });
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
          chain: verifyEvents(row.id, events),
        },
      });
    } catch (err) {
      if (!sendIncidentError(res, err)) throw err;
    }
  }),
);
