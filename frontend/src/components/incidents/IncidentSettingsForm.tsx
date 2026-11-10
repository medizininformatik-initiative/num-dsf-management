/**
 * IncidentSettingsForm.tsx – the admin's classification of an open incident:
 * escalation level, detection time (the NIS2 deadlines move with it) and the
 * Zulip thread link (https only, empty removes it). No step-up; only changed
 * fields are sent and every change is logged by the backend. After raising
 * the level to 2 or 3, `onLevelRaised` lets the caller offer the suspension
 * right away.
 * Dependencies: React Hook Form, Zod, FormField, Button, useUpdateIncident,
 * incident.schema, incidentErrors, i18n store, sonner.
 */
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import type { EscalationLevel, Incident, UpdateIncidentBody } from '../../api/incidents.api';
import { useUpdateIncident } from '../../hooks/useIncidentActions';
import {
  ZULIP_URL_MAX,
  detectedAtSchema,
  toLocalInputValue,
  zulipUrlSchema,
} from '../../schemas/incident.schema';
import { useI18n } from '../../stores/i18n.store';
import { FormField, inputClass, selectClass } from '../modals/FormField';
import { Button } from '../ui/Button';
import { incidentErrorMessage } from './incidentErrors';

const settingsSchema = z.object({
  escalationLevel: z.enum(['1', '2', '3']),
  detectedAt: detectedAtSchema,
  zulipUrl: zulipUrlSchema,
});
type SettingsForm = z.infer<typeof settingsSchema>;

interface IncidentSettingsFormProps {
  incident: Incident;
  onLevelRaised?: (level: EscalationLevel) => void;
}

function defaults(incident: Incident): SettingsForm {
  return {
    escalationLevel: String(incident.escalationLevel) as SettingsForm['escalationLevel'],
    detectedAt: toLocalInputValue(new Date(incident.detectedAt)),
    zulipUrl: incident.zulipUrl ?? '',
  };
}

export function IncidentSettingsForm({ incident, onLevelRaised }: IncidentSettingsFormProps) {
  const { t } = useI18n();
  const headingId = useId();
  const update = useUpdateIncident(incident.id);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    values: defaults(incident),
  });

  function onSubmit(data: SettingsForm) {
    const before = defaults(incident);
    const body: UpdateIncidentBody = {};
    const level = Number(data.escalationLevel) as EscalationLevel;
    if (data.escalationLevel !== before.escalationLevel) body.escalationLevel = level;
    if (data.detectedAt !== before.detectedAt) {
      body.detectedAt = new Date(data.detectedAt).toISOString();
    }
    if (data.zulipUrl.trim() !== before.zulipUrl) body.zulipUrl = data.zulipUrl.trim() || null;
    if (Object.keys(body).length === 0) return;

    update.mutate(body, {
      onSuccess: () => {
        toast.success(t('incidentSettingsSaved'));
        if (body.escalationLevel !== undefined && level > incident.escalationLevel && level >= 2) {
          onLevelRaised?.(level);
        }
      },
      onError: (err) => {
        reset(before);
        toast.error(incidentErrorMessage(err, t('genericActionFailed'), t));
      },
    });
  }

  return (
    <section aria-labelledby={headingId} className="surface-card p-5">
      <h3 id={headingId} className="text-base font-semibold text-[color:var(--text-primary)]">
        {t('incidentSettingsTitle')}
      </h3>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-3 space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('incidentFieldLevel')}
            required
            error={errors.escalationLevel?.message}
          >
            <select {...register('escalationLevel')} className={selectClass}>
              <option value="1">{t('incidentLevel1')}</option>
              <option value="2">{t('incidentLevel2')}</option>
              <option value="3">{t('incidentLevel3')}</option>
            </select>
          </FormField>
          <FormField
            label={t('incidentFieldDetectedAt')}
            required
            hint={t('incidentDetectedAtHint')}
            error={errors.detectedAt?.message}
          >
            <input
              {...register('detectedAt')}
              type="datetime-local"
              max={toLocalInputValue(new Date())}
              className={inputClass}
            />
          </FormField>
        </div>
        <FormField
          label={t('incidentDetailZulip')}
          hint={t('incidentZulipHint')}
          error={errors.zulipUrl?.message}
        >
          <input
            {...register('zulipUrl')}
            type="url"
            inputMode="url"
            spellCheck={false}
            maxLength={ZULIP_URL_MAX}
            placeholder="https://"
            className={inputClass}
          />
        </FormField>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!isDirty || update.isPending}>
            {t('incidentSettingsSave')}
          </Button>
        </div>
      </form>
    </section>
  );
}
