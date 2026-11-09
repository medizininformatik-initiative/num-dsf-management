/**
 * BackupSettingsForm.tsx – the schedule form of the backup page: on/off,
 * interval (every 6 h, every 12 h, daily at a time in Europe/Berlin; never
 * less often than daily) and how many files to keep. RHF + Zod; the parent
 * runs the step-up and the save.
 * Dependencies: react-hook-form, zod schema, Button, Icon, fieldClasses,
 * FormField (checkbox class), i18n store.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  backupSettingsSchema,
  type BackupSettingsFormData,
} from '../../../schemas/backupSettings.schema';
import type { BackupSettings } from '../../../api/backups.api';
import { Button } from '../../ui/Button';
import { checkboxClass } from '../../modals/FormField';
import { FIELD_CLASS, HINT_CLASS, LABEL_CLASS } from '../fieldClasses';
import { useI18n } from '../../../stores/i18n.store';
import type { TranslationKey } from '../../../i18n/en';

export interface BackupSettingsFormProps {
  settings: BackupSettings;
  saving: boolean;
  onSave: (values: BackupSettingsFormData) => void;
}

export function BackupSettingsForm({ settings, saving, onSave }: BackupSettingsFormProps) {
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<z.input<typeof backupSettingsSchema>, unknown, BackupSettingsFormData>({
    resolver: zodResolver(backupSettingsSchema),
    defaultValues: toValues(settings),
  });

  useEffect(() => {
    reset(toValues(settings));
  }, [settings, reset]);

  const mode = watch('mode');
  const err = (key?: string) => (key ? t(key as TranslationKey) : undefined);

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSave)}
      className="surface-card space-y-4 p-5"
      aria-labelledby="backup-settings-title"
      data-testid="backup-settings-form"
    >
      <h2 id="backup-settings-title" className="text-base font-semibold">
        {t('backupSettingsTitle')}
      </h2>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className={checkboxClass} {...register('enabled')} />
        {t('backupEnabledLabel')}
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="backup-mode" className={LABEL_CLASS}>
            {t('backupIntervalLabel')}
          </label>
          <select id="backup-mode" className={FIELD_CLASS} {...register('mode')}>
            <option value="EVERY_6H">{t('backupModeEvery6h')}</option>
            <option value="EVERY_12H">{t('backupModeEvery12h')}</option>
            <option value="DAILY">{t('backupModeDaily')}</option>
          </select>
          <span className={HINT_CLASS}>{t('backupIntervalHint')}</span>
        </div>
        {mode === 'DAILY' && (
          <div>
            <label htmlFor="backup-time" className={LABEL_CLASS}>
              {t('backupDailyTimeLabel')}
            </label>
            <input
              id="backup-time"
              type="time"
              className={FIELD_CLASS}
              aria-invalid={!!errors.dailyTime}
              {...register('dailyTime')}
            />
            {errors.dailyTime && (
              <span role="alert" className="mt-1 block text-xs text-danger-fg">
                {err(errors.dailyTime.message)}
              </span>
            )}
          </div>
        )}
        <div>
          <label htmlFor="backup-retention" className={LABEL_CLASS}>
            {t('backupRetentionLabel')}
          </label>
          <input
            id="backup-retention"
            type="number"
            min={7}
            max={365}
            className={FIELD_CLASS}
            aria-invalid={!!errors.retentionCount}
            {...register('retentionCount')}
          />
          {errors.retentionCount ? (
            <span role="alert" className="mt-1 block text-xs text-danger-fg">
              {err(errors.retentionCount.message)}
            </span>
          ) : (
            <span className={HINT_CLASS}>{t('backupRetentionHint')}</span>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!isDirty || saving} aria-busy={saving || undefined}>
          {t('backupSaveSettings')}
        </Button>
      </div>
    </form>
  );
}

function toValues(s: BackupSettings): BackupSettingsFormData {
  return {
    enabled: s.enabled,
    mode: s.mode,
    dailyTime: s.dailyTime,
    retentionCount: s.retentionCount,
  };
}
