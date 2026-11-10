/**
 * LiftSuspensionDialog.tsx – lift a site's suspension after the restart
 * checklist: cause fixed, fix proven by tests, release by the DSF
 * Technikgremium (all three must be ticked) plus a required note, then the
 * step-up code. Blocked thumbprints stay blocked; the site needs a new,
 * four-eyes-approved certificate. Each opening starts empty.
 * Dependencies: StepUpConfirmDialog, FormFieldGroup, FormField, useLiftSuspension,
 * incidentErrors, incident.schema limits, i18n store, sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import type { Incident } from '../../api/incidents.api';
import { useLiftSuspension } from '../../hooks/useIncidentActions';
import type { TranslationKey } from '../../i18n/en';
import { INCIDENT_NOTE_MAX } from '../../schemas/incident.schema';
import { useI18n } from '../../stores/i18n.store';
import { StepUpConfirmDialog } from '../admin/StepUpConfirmDialog';
import { FormField, FormFieldGroup, checkboxClass, inputClass } from '../modals/FormField';
import { incidentErrorMessage } from './incidentErrors';

type Check = 'causeFixed' | 'fixTested' | 'releasedByTechBoard';
const CHECKS: [Check, TranslationKey][] = [
  ['causeFixed', 'incidentLiftCauseFixed'],
  ['fixTested', 'incidentLiftFixTested'],
  ['releasedByTechBoard', 'incidentLiftReleased'],
];
const NONE: Record<Check, boolean> = {
  causeFixed: false,
  fixTested: false,
  releasedByTechBoard: false,
};

interface LiftSuspensionDialogProps {
  incident: Incident;
  open: boolean;
  onClose: () => void;
}

export function LiftSuspensionDialog({ incident, open, onClose }: LiftSuspensionDialogProps) {
  const { t } = useI18n();
  const [checks, setChecks] = useState(NONE);
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChecks(NONE);
      setNote('');
      setCode('');
    }
  }
  const lift = useLiftSuspension(incident.id);
  const allChecked = CHECKS.every(([k]) => checks[k]);
  const noteOk = note.trim().length > 0;

  function submit(totpCode: string | undefined) {
    lift.mutate(
      {
        body: { causeFixed: true, fixTested: true, releasedByTechBoard: true, note: note.trim() },
        totpCode,
      },
      {
        onSuccess: () => {
          toast.success(t('incidentLifted'));
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
      title={t('incidentLiftTitle', {
        site: incident.organization?.name ?? t('incidentSiteUnknownShort'),
      })}
      subtitle={incident.title}
      message={t('incidentLiftMessage')}
      confirmLabel={t('incidentActionLift')}
      pending={lift.isPending}
      confirmDisabled={!allChecked || !noteOk}
      isDirty={note.trim() !== '' || CHECKS.some(([k]) => checks[k])}
      totpCode={code}
      onTotpCodeChange={setCode}
      onConfirm={submit}
      onCancel={onClose}
    >
      <FormFieldGroup label={t('incidentLiftChecklist')} required>
        <div className="space-y-2">
          {CHECKS.map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-3 text-sm text-[color:var(--text-primary)]"
            >
              <input
                type="checkbox"
                checked={checks[key]}
                onChange={(e) => setChecks((c) => ({ ...c, [key]: e.target.checked }))}
                className={`mt-0.5 ${checkboxClass}`}
              />
              {t(label)}
            </label>
          ))}
        </div>
      </FormFieldGroup>
      <FormField label={t('incidentLiftNote')} required>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={INCIDENT_NOTE_MAX}
          className={`${inputClass} resize-y`}
        />
      </FormField>
    </StepUpConfirmDialog>
  );
}
