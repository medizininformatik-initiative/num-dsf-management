/**
 * admin-backups.routes.ts – Admin API for application backups: schedule
 * settings, run history, "back up now" and the download of a stored backup.
 * Writes and the download need the step-up (TOTP code, or the re-presented
 * client certificate in cert sessions). Restoring is deliberately NOT an API:
 * it is done by hand on the server (scripts/restore-backup.sh).
 * Dependencies: auth.middleware, admin.middleware, totp.middleware,
 *               rateLimit.middleware, asyncHandler, backup.service, audit.service, Zod
 */
import { Router } from 'express';
import { stepUpCode } from '../schemas/stepUpCode';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import { requireFreshTotp } from '../middleware/totp.middleware';
import { backupDownloadRateLimit, stepUpTotpRateLimit } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../lib/asyncHandler';
import { errMessage } from '../lib/errMessage';
import { MAX_RETENTION, MIN_RETENTION, isValidDailyTime } from '../lib/backupSchedule';
import { readBackupKey } from '../lib/backupCrypto';
import { writeAuditLog } from '../services/audit.service';
import * as svc from '../services/backup.service';

const settingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['EVERY_6H', 'EVERY_12H', 'DAILY']),
  dailyTime: z.string().refine(isValidDailyTime, 'dailyTime must be HH:MM'),
  retentionCount: z.number().int().min(MIN_RETENTION).max(MAX_RETENTION),
  totpCode: stepUpCode,
});

export const adminBackupsRouter = Router();
adminBackupsRouter.use(requireAuth, requireImiAdmin);

// Step-up rate limiter for the guarded routes (skipped under jest).
const stepUp = process.env.NODE_ENV === 'test' ? [] : [stepUpTotpRateLimit];
const downloadLimit = process.env.NODE_ENV === 'test' ? [] : [backupDownloadRateLimit];

adminBackupsRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await svc.getSettings();
    res.json({
      data: {
        settings,
        encryptionEnabled: !!readBackupKey(),
        directory: svc.backupDir(),
      },
    });
  }),
);

adminBackupsRouter.put(
  '/settings',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message || 'Invalid input' },
      });
    }
    const { totpCode: _totpCode, ...input } = parsed.data;
    const settings = await svc.updateSettings(input, req.user!.email, req.ip);
    res.json({ data: { settings } });
  }),
);

adminBackupsRouter.get(
  '/runs',
  asyncHandler(async (_req, res) => {
    res.json({ data: { runs: await svc.listRuns() } });
  }),
);

adminBackupsRouter.post(
  '/run',
  ...stepUp,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    try {
      const run = await svc.runBackup({
        trigger: 'MANUAL',
        userEmail: req.user!.email,
        ip: req.ip,
      });
      res.status(201).json({ data: { run } });
    } catch (err: unknown) {
      if (errMessage(err) === 'BACKUP_BUSY') {
        return res.status(409).json({
          error: { code: 'BACKUP_BUSY', message: 'Another backup is already running.' },
        });
      }
      // The failed run is recorded and shown on the page; the cause stays in the server log.
      return res.status(500).json({
        error: { code: 'BACKUP_FAILED', message: 'The backup failed. See the run history.' },
      });
    }
  }),
);

// POST (not GET): the OTP step-up code travels in the request body.
adminBackupsRouter.post(
  '/runs/:id/download',
  ...stepUp,
  ...downloadLimit,
  requireFreshTotp,
  asyncHandler(async (req, res) => {
    const run = await svc.getRun(req.params.id);
    const file = run ? await svc.openBackupFile(run) : null;
    if (!run || !file) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Backup file not found (it may have been pruned).' },
      });
    }
    await writeAuditLog({
      userEmail: req.user!.email,
      resourceType: 'BACKUP',
      resourceId: run.id,
      operation: 'DOWNLOAD',
      diffJson: { fileName: run.fileName, sha256: run.sha256 },
      ipAddress: req.ip,
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    file.stream.on('error', () => res.destroy());
    file.stream.pipe(res);
  }),
);
