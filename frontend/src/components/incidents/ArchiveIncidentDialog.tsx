/**
 * ArchiveIncidentDialog.tsx – archive (soft delete) a finished incident with
 * the step-up code. Nothing is deleted: the incident only leaves the default
 * lists. Each opening starts with an empty code.
 * Dependencies: StepUpConfirmDialog, useArchiveIncident, incidentErrors,
 * i18n store, sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import type { Incident } from '../../api/incidents.api';
import { useArchiveIncident } from '../../hooks/useIncidentActions';
import { useI18n } from '../../stores/i18n.store';
import { StepUpConfirmDialog } from '../admin/StepUpConfirmDialog';
import { incidentErrorMessage } from './incidentErrors';

interface ArchiveIncidentDialogProps {
  incident: Incident;
  open: boolean;
  onClose: () => void;
}

export function ArchiveIncidentDialog({ incident, open, onClose }: ArchiveIncidentDialogProps) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCode('');
  }
  const archive = useArchiveIncident(incident.id);

  function submit(totpCode: string | undefined) {
    archive.mutate(totpCode, {
      onSuccess: () => {
        toast.success(t('incidentArchiveToast'));
        onClose();
      },
      onError: (err) => {
        setCode('');
        toast.error(incidentErrorMessage(err, t('genericActionFailed'), t));
      },
    });
  }

  return (
    <StepUpConfirmDialog
      open={open}
      title={t('incidentArchiveTitle')}
      subtitle={incident.title}
      message={t('incidentArchiveMessage')}
      confirmLabel={t('incidentActionArchive')}
      pending={archive.isPending}
      totpCode={code}
      onTotpCodeChange={setCode}
      onConfirm={submit}
      onCancel={onClose}
    />
  );
}
