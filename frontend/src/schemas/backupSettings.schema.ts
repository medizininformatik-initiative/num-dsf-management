/**
 * backupSettings.schema.ts — Zod schema for the backup schedule form. Never
 * less often than daily: only 6 h, 12 h or a daily time are selectable;
 * retention 7..365 files. Messages are i18n keys.
 */
import { z } from 'zod';

export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['EVERY_6H', 'EVERY_12H', 'DAILY']),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'backupTimeInvalid'),
  retentionCount: z.coerce
    .number({ error: 'backupRetentionInvalid' })
    .int('backupRetentionInvalid')
    .min(7, 'backupRetentionInvalid')
    .max(365, 'backupRetentionInvalid'),
});

export type BackupSettingsFormData = z.infer<typeof backupSettingsSchema>;
