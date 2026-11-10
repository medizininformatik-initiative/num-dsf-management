/**
 * SuspendSiteDialog.tsx – confirm an incident and/or suspend its site, with
 * the step-up code. Two modes:
 * - confirmFirst (the incident is REPORTED): confirming is the main action;
 *   "Suspend the site in the same step" adds the measures and sends one
 *   suspend request with confirm: true. The toggle is on by default at
 *   escalation level 2 and 3 and hidden when no site is recorded.
 * - otherwise: suspend the site of a confirmed incident.
 * All four measures start checked; at least one is required. Each opening
 * starts from the defaults again. A spent code is cleared after a failure.
 * Dependencies: StepUpConfirmDialog, MeasureChecklist, useConfirmIncident,
 * useSuspendSite, incidentErrors, checkboxClass, i18n store, sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { SUSPEND_MEASURES, type Incident, type SuspendMeasure } from '../../api/incidents.api';
import { useConfirmIncident, useSuspendSite } from '../../hooks/useIncidentActions';
import { useI18n } from '../../stores/i18n.store';
import { StepUpConfirmDialog } from '../admin/StepUpConfirmDialog';
import { checkboxClass } from '../modals/FormField';
import { MeasureChecklist } from './MeasureChecklist';
import { incidentErrorMessage } from './incidentErrors';

interface SuspendSiteDialogProps {
  incident: Incident;
  open: boolean;
  confirmFirst: boolean;
  onClose: () => void;
}

export function SuspendSiteDialog({
  incident,
  open,
  confirmFirst,
  onClose,
}: SuspendSiteDialogProps) {
  const { t } = useI18n();
  const hasSite = incident.organization !== null;
  const defaultSuspend = hasSite && (!confirmFirst || incident.escalationLevel >= 2);
  const [measures, setMeasures] = useState<SuspendMeasure[]>([...SUSPEND_MEASURES]);
  const [suspend, setSuspend] = useState(defaultSuspend);
  const [code, setCode] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMeasures([...SUSPEND_MEASURES]);
      setSuspend(defaultSuspend);
      setCode('');
    }
  }

  const confirmMut = useConfirmIncident(incident.id);
  const suspendMut = useSuspendSite(incident.id);
  const pending = confirmMut.isPending || suspendMut.isPending;
  const site = incident.organization?.name ?? t('incidentSiteUnknownShort');

  function fail(err: unknown) {
    setCode('');
    toast.error(incidentErrorMessage(err, t('genericActionFailed'), t));
  }

  function submit(totpCode: string | undefined) {
    if (suspend) {
      suspendMut.mutate(
        { measures, confirm: confirmFirst, totpCode },
        {
          onSuccess: (data) => {
            toast.success(t('incidentSuspended', { n: data.results.length }));
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }
    confirmMut.mutate(totpCode, {
      onSuccess: () => {
        toast.success(t('incidentConfirmed'));
        onClose();
      },
      onError: fail,
    });
  }

  return (
    <StepUpConfirmDialog
      open={open}
      title={confirmFirst ? t('incidentConfirmTitle') : t('incidentSuspendTitle', { site })}
      subtitle={incident.title}
      message={confirmFirst ? t('incidentConfirmMessage') : t('incidentSuspendMessage')}
      consequence={suspend ? t('incidentSuspendConsequence') : undefined}
      confirmLabel={
        confirmFirst
          ? suspend
            ? t('incidentConfirmAndSuspend')
            : t('incidentActionConfirm')
          : t('incidentActionSuspend')
      }
      destructive={suspend}
      pending={pending}
      confirmDisabled={suspend && measures.length === 0}
      totpCode={code}
      onTotpCodeChange={setCode}
      onConfirm={submit}
      onCancel={onClose}
    >
      {confirmFirst && hasSite && (
        <label className="flex cursor-pointer items-start gap-3 text-sm font-medium text-[color:var(--text-primary)]">
          <input
            type="checkbox"
            checked={suspend}
            onChange={(e) => setSuspend(e.target.checked)}
            className={`mt-0.5 ${checkboxClass}`}
          />
          {t('incidentConfirmAlsoSuspend')}
        </label>
      )}
      {suspend && <MeasureChecklist value={measures} onChange={setMeasures} disabled={pending} />}
    </StepUpConfirmDialog>
  );
}
