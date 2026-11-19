/**
 * IncidentAdminPanel.tsx – everything an admin does with one incident, shown
 * between its facts and its timeline: the action bar (Confirm, Suspend site,
 * Lift suspension, Close, False alarm, Export JSON/CSV) with the step-up
 * dialogs, the classification form and the comment form. At escalation level
 * 2 or 3 an unsuspended open incident with a known site gets a callout that
 * offers the suspension right away, and raising the level to 2 or 3 opens
 * the suspend dialog at once. Closing is blocked while the site is suspended;
 * a closed incident offers Archive (step-up dialog) and the export. A false alarm without an
 * active suspension also shows its certificate blocks and the four-eyes lift (BlockLiftPanel).
 * Dependencies: BlockLiftPanel, SuspendSiteDialog, LiftSuspensionDialog, CloseIncidentDialog,
 * IncidentSettingsForm, IncidentCommentForm, IncidentExportButtons,
 * incidentLabels, Button, Icon, i18n store.
 */
import { useId, useState } from 'react';
import type { CloseOutcome, IncidentDetail } from '../../api/incidents.api';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { ArchiveIncidentDialog } from './ArchiveIncidentDialog';
import { BlockLiftPanel } from './BlockLiftPanel';
import { CloseIncidentDialog } from './CloseIncidentDialog';
import { IncidentCommentForm } from './IncidentCommentForm';
import { IncidentExportButtons } from './IncidentExportButtons';
import { IncidentSettingsForm } from './IncidentSettingsForm';
import { LiftSuspensionDialog } from './LiftSuspensionDialog';
import { SuspendSiteDialog } from './SuspendSiteDialog';
import { isOpen } from './incidentLabels';

type Dialog = 'suspend' | 'lift' | 'archive' | CloseOutcome | null;

function Hint({ icon, children }: { icon: string; children: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-[color:var(--text-muted)]">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0" />
      {children}
    </p>
  );
}

export function IncidentAdminPanel({ detail }: { detail: IncidentDetail }) {
  const { t } = useI18n();
  const headingId = useId();
  const { incident } = detail;
  const [dialog, setDialog] = useState<Dialog>(null);
  const open = isOpen(incident.status);
  const reported = incident.status === 'REPORTED';
  const hasSite = incident.organization !== null;
  const canSuspend = open && hasSite && !incident.suspended;
  const suggestSuspend = canSuspend && incident.escalationLevel >= 2;
  const close = () => setDialog(null);

  return (
    <>
      <section
        aria-labelledby={headingId}
        className={`surface-card space-y-4 p-5 ${suggestSuspend ? 'border-danger-border' : ''}`}
        data-testid="incident-admin-actions"
      >
        <h3 id={headingId} className="text-base font-semibold text-[color:var(--text-primary)]">
          {t('incidentActionsTitle')}
        </h3>

        {suggestSuspend && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-control border border-danger-border bg-danger-surface p-3 text-sm text-danger-fg"
          >
            <Icon name="warning" size={20} className="shrink-0" />
            <p className="min-w-0 flex-1 font-medium">
              {t('incidentSuggestSuspend', { n: incident.escalationLevel })}
            </p>
            <Button variant="destructive" size="sm" onClick={() => setDialog('suspend')}>
              <Icon name="block" size={16} />
              {reported ? t('incidentConfirmAndSuspend') : t('incidentActionSuspend')}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {reported && (
            <Button size="sm" onClick={() => setDialog('suspend')}>
              <Icon name="gpp_bad" size={16} />
              {t('incidentActionConfirm')}
            </Button>
          )}
          {canSuspend && !reported && !suggestSuspend && (
            <Button variant="destructive" size="sm" onClick={() => setDialog('suspend')}>
              <Icon name="block" size={16} />
              {t('incidentActionSuspend')}
            </Button>
          )}
          {incident.suspended && (
            <Button size="sm" onClick={() => setDialog('lift')}>
              <Icon name="lock_open" size={16} />
              {t('incidentActionLift')}
            </Button>
          )}
          {open && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={incident.suspended}
                onClick={() => setDialog('CLOSED')}
              >
                <Icon name="task_alt" size={16} />
                {t('incidentActionClose')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={incident.suspended}
                onClick={() => setDialog('FALSE_ALARM')}
              >
                <Icon name="do_not_disturb_on" size={16} />
                {t('incidentActionFalseAlarm')}
              </Button>
            </>
          )}
          {!open && !incident.suspended && !incident.archivedAt && (
            <Button variant="secondary" size="sm" onClick={() => setDialog('archive')}>
              <Icon name="inventory_2" size={16} />
              {t('incidentActionArchive')}
            </Button>
          )}
          <span className="flex flex-wrap gap-2 sm:ml-auto">
            <IncidentExportButtons incidentId={incident.id} />
          </span>
        </div>

        {open && incident.suspended && <Hint icon="info">{t('incidentStillSuspendedHint')}</Hint>}
        {open && !hasSite && <Hint icon="info">{t('incidentNoSiteHint')}</Hint>}
        {!open && <Hint icon="lock">{t('incidentClosedHint')}</Hint>}
        {incident.archivedAt && <Hint icon="inventory_2">{t('incidentArchivedHint')}</Hint>}
      </section>

      {incident.status === 'FALSE_ALARM' && !incident.suspended && hasSite && (
        <BlockLiftPanel incident={incident} />
      )}

      {open && (
        <IncidentSettingsForm
          incident={incident}
          onLevelRaised={() => {
            if (canSuspend) setDialog('suspend');
          }}
        />
      )}
      {open && <IncidentCommentForm incidentId={incident.id} />}

      <SuspendSiteDialog
        incident={incident}
        open={dialog === 'suspend'}
        confirmFirst={reported}
        onClose={close}
      />
      <LiftSuspensionDialog incident={incident} open={dialog === 'lift'} onClose={close} />
      <ArchiveIncidentDialog incident={incident} open={dialog === 'archive'} onClose={close} />
      <CloseIncidentDialog
        incident={incident}
        outcome={dialog === 'FALSE_ALARM' ? 'FALSE_ALARM' : 'CLOSED'}
        open={dialog === 'CLOSED' || dialog === 'FALSE_ALARM'}
        onClose={close}
      />
    </>
  );
}
