/**
 * ReportIncidentDialog.tsx – the "Report security incident" form for every
 * signed-in user (admins also use it to record an incident after a phone
 * call): affected site (defaults to the site of the active instance for site
 * users, "unknown" allowed), short title, description, escalation level,
 * detection time (defaults to now; the NIS2 deadlines run from it) and whether
 * the DPO is informed. Each opening starts a fresh form (keyed), so the
 * detection time is "now" again. On success all admins are mailed by the
 * backend; a 429 gets its own message pointing to the phone.
 * Dependencies: Modal, FormField, useIncidentSites, useReportIncident, useMe,
 * useOrganization, canvas store, incident.schema, getErrorMessage, i18n store,
 * React Hook Form, Zod, sonner.
 */
import { Select } from '../ui/Select';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Modal } from '../modals/Modal';
import { FormField, ModalFooter, checkboxClass, inputClass } from '../modals/FormField';
import { useIncidentSites } from '../../hooks/useIncidents';
import { useReportIncident } from '../../hooks/useIncidentActions';
import { useMe } from '../../hooks/useMe';
import { useOrganization } from '../../hooks/useOrganization';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import { getErrorCode, getErrorMessage } from '../../lib/getErrorMessage';
import type { EscalationLevel } from '../../api/incidents.api';
import {
  INCIDENT_TEXT_MAX,
  INCIDENT_TITLE_MAX,
  reportIncidentSchema,
  toLocalInputValue,
  type ReportIncidentForm,
} from '../../schemas/incident.schema';

interface ReportIncidentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ReportIncidentDialog({ open, onClose }: ReportIncidentDialogProps) {
  const { t } = useI18n();
  // A new key per opening remounts the form with fresh defaults.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((s) => s + 1);
  }
  const [dirty, setDirty] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('incidentReportTitle')}
      subtitle={t('incidentReportSubtitle')}
      isDirty={dirty}
    >
      <ReportForm key={session} active={open} onDone={onClose} onDirtyChange={setDirty} />
    </Modal>
  );
}

function ReportForm({
  active,
  onDone,
  onDirtyChange,
}: {
  active: boolean;
  onDone: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const { data: me } = useMe();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const { data: ownOrg } = useOrganization(me?.isAdmin ? null : activeInstanceId);
  const sites = useIncidentSites(active);
  const report = useReportIncident();

  const {
    register,
    handleSubmit,
    setValue,
    getFieldState,
    formState: { errors, isDirty },
  } = useForm<ReportIncidentForm>({
    resolver: zodResolver(reportIncidentSchema),
    defaultValues: {
      organizationId: '',
      title: '',
      description: '',
      escalationLevel: '1',
      detectedAt: toLocalInputValue(new Date()),
      dpoInformed: false,
    },
  });

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  // Site users report for their own site unless they pick another one.
  const ownIdentifier = (ownOrg as { identifier?: string } | null | undefined)?.identifier;
  const siteKnown = !!sites.data?.some((s) => s.identifier === ownIdentifier);
  useEffect(() => {
    if (ownIdentifier && siteKnown && !getFieldState('organizationId').isDirty) {
      setValue('organizationId', ownIdentifier);
    }
  }, [ownIdentifier, siteKnown, getFieldState, setValue]);

  async function onSubmit(data: ReportIncidentForm) {
    try {
      await report.mutateAsync({
        organizationId: data.organizationId || null,
        title: data.title,
        description: data.description,
        escalationLevel: Number(data.escalationLevel) as EscalationLevel,
        detectedAt: new Date(data.detectedAt).toISOString(),
        dpoInformed: data.dpoInformed,
      });
      toast.success(t('incidentReportedToast'));
      onDirtyChange(false);
      onDone();
    } catch (err: unknown) {
      toast.error(
        getErrorCode(err) === 'RATE_LIMITED'
          ? t('incidentReportRateLimited')
          : getErrorMessage(err, t('incidentReportFailed')),
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField label={t('incidentFieldSite')} error={errors.organizationId?.message}>
        <Select
          {...register('organizationId')}

          data-testid="incident-site-select"
        >
          <option value="">{t('incidentSiteUnknown')}</option>
          {sites.data?.map((s) => (
            <option key={s.identifier} value={s.identifier}>
              {s.name} ({s.identifier})
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t('incidentFieldTitle')} required error={errors.title?.message}>
        <input
          {...register('title')}
          className={inputClass}
          maxLength={INCIDENT_TITLE_MAX}
          autoComplete="off"
        />
      </FormField>

      <FormField
        label={t('incidentFieldDescription')}
        required
        hint={t('incidentDescriptionHint')}
        error={errors.description?.message}
      >
        <textarea
          {...register('description')}
          rows={5}
          maxLength={INCIDENT_TEXT_MAX}
          className={`${inputClass} resize-y`}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('incidentFieldLevel')} required error={errors.escalationLevel?.message}>
          <Select {...register('escalationLevel')}>
            <option value="1">{t('incidentLevel1')}</option>
            <option value="2">{t('incidentLevel2')}</option>
            <option value="3">{t('incidentLevel3')}</option>
          </Select>
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

      <label className="flex cursor-pointer items-start gap-3 text-sm text-[color:var(--text-primary)]">
        <input type="checkbox" {...register('dpoInformed')} className={`mt-0.5 ${checkboxClass}`} />
        {t('incidentFieldDpo')}
      </label>

      <ModalFooter
        onCancel={onDone}
        loading={report.isPending}
        loadingLabel={t('incidentReportSending')}
        submitLabel={t('incidentReportSubmit')}
      />
    </form>
  );
}
