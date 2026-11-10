/**
 * ReportIncidentButton.tsx – the top-bar entry to the report dialog, shown to
 * every signed-in user: a quiet outlined button in the danger tone with the
 * label from md up (icon only, with an accessible name, on narrow screens).
 * Dependencies: ReportIncidentDialog, Button, Icon, i18n store.
 */
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useI18n } from '../../stores/i18n.store';
import { ReportIncidentDialog } from './ReportIncidentDialog';

export function ReportIncidentButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        title={t('incidentReportButton')}
        className="border-danger-border text-danger-fg hover:bg-danger-surface"
        data-testid="report-incident-button"
      >
        <Icon name="report" size={16} />
        <span className="sr-only md:not-sr-only">{t('incidentReportButtonShort')}</span>
      </Button>
      <ReportIncidentDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
