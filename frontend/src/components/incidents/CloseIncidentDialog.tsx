/**
 * CloseIncidentDialog.tsx – close an incident for good, with the step-up
 * code: outcome CLOSED needs the post-incident review with the measures
 * derived from it, FALSE_ALARM needs the reason. The note is required and
 * capped like the backend; a closed incident is never reopened or edited.
 * Each opening starts empty.
 * Dependencies: StepUpConfirmDialog, FormField, useCloseIncident,
 * incidentErrors, incident.schema limits, i18n store, sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import type { CloseOutcome, Incident } from '../../api/incidents.api';
import { useCloseIncident } from '../../hooks/useIncidentActions';
import { INCIDENT_TEXT_MAX } from '../../schemas/incident.schema';
import { useI18n } from '../../stores/i18n.store';
import { StepUpConfirmDialog } from '../admin/StepUpConfirmDialog';
import { FormField, inputClass } from '../modals/FormField';
import { incidentErrorMessage } from './incidentErrors';

interface CloseIncidentDialogProps {
  incident: Incident;
  outcome: CloseOutcome;
  open: boolean;
  onClose: () => void;
}

export function CloseIncidentDialog({
  incident,
  outcome,
  open,
  onClose,
}: CloseIncidentDialogProps) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNote('');
      setCode('');
    }
  }
  const close = useCloseIncident(incident.id);
  const falseAlarm = outcome === 'FALSE_ALARM';
  const trimmed = note.trim();

  function submit(totpCode: string | undefined) {
    close.mutate(
      { outcome, note: trimmed, totpCode },
      {
        onSuccess: () => {
          toast.success(falseAlarm ? t('incidentFalseAlarmToast') : t('incidentClosedToast'));
          onClose();
        },
        onError: (err) => {
          setCode('');
          toast.error(incidentErrorMessage(err, t('genericActionFailed'), t));
        },
      },
    );
  }

  return (
    <StepUpConfirmDialog
      open={open}
      title={falseAlarm ? t('incidentFalseAlarmTitle') : t('incidentCloseTitle')}
      subtitle={incident.title}
      message={falseAlarm ? t('incidentFalseAlarmMessage') : t('incidentCloseMessage')}
      consequence={t('incidentCloseConsequence')}
      confirmLabel={falseAlarm ? t('incidentActionFalseAlarm') : t('incidentActionClose')}
      pending={close.isPending}
      confirmDisabled={trimmed.length === 0}
      isDirty={trimmed !== ''}
      totpCode={code}
      onTotpCodeChange={setCode}
      onConfirm={submit}
      onCancel={onClose}
    >
      <FormField label={falseAlarm ? t('incidentFalseAlarmNote') : t('incidentCloseNote')} required>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={falseAlarm ? 3 : 6}
          maxLength={INCIDENT_TEXT_MAX}
          className={`${inputClass} resize-y`}
        />
      </FormField>
    </StepUpConfirmDialog>
  );
}
