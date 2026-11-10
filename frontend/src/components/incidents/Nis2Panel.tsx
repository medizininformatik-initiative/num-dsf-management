/**
 * Nis2Panel.tsx – the NIS2 reporting duties of an incident and the DPO
 * record: per stage (24 h early warning, 72 h notification, one-month final
 * report) the deadline with a live countdown, "overdue by" in the danger tone
 * and "due soon" in the warning tone, or who recorded the report to the BSI
 * and when. Callers with `canAcknowledge` (admins, the reporter, users of the
 * affected site) can tick a stage or "DPO informed" after a confirmation; the
 * ticks are one-way. The portal never reports to the BSI itself.
 * Dependencies: useAcknowledgeNis2, useAcknowledgeDpo, useConfirm, useNow,
 * lib/nis2, incidentLabels, lib/dateUtils, incidentErrors, Button, Icon,
 * i18n store, sonner.
 */
import { useId } from 'react';
import { toast } from 'sonner';
import type { Incident, Nis2Entry } from '../../api/incidents.api';
import { useAcknowledgeDpo, useAcknowledgeNis2 } from '../../hooks/useIncidentActions';
import { useConfirm } from '../../hooks/useConfirm';
import { useNow } from '../../hooks/useNow';
import { nis2State, type Nis2State } from '../../lib/nis2';
import { formatDateTime } from '../../lib/dateUtils';
import { incidentErrorMessage } from './incidentErrors';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { STAGE_KEY, formatDuration } from './incidentLabels';

const STATE_STYLE: Record<Nis2State['kind'], { icon: string; tone: string }> = {
  reported: { icon: 'check_circle', tone: 'text-success-fg' },
  overdue: { icon: 'error', tone: 'text-danger-fg' },
  soon: { icon: 'schedule', tone: 'text-warning-fg' },
  open: { icon: 'schedule', tone: 'text-[color:var(--text-muted)]' },
};

export function Nis2Panel({ incident }: { incident: Incident }) {
  const { t, lang } = useI18n();
  const headingId = useId();
  const confirm = useConfirm();
  const now = useNow();
  const nis2 = useAcknowledgeNis2(incident.id);
  const dpo = useAcknowledgeDpo(incident.id);
  const busy = nis2.isPending || dpo.isPending;

  async function tickStage(entry: Nis2Entry) {
    const ok = await confirm({
      title: t('incidentNis2ConfirmTitle'),
      message: (
        <div className="space-y-1">
          <p className="font-semibold text-[color:var(--text-primary)]">
            {t(STAGE_KEY[entry.stage])}
          </p>
          <p>{t('incidentNis2ConfirmMessage')}</p>
        </div>
      ),
      consequence: t('incidentAckConsequence'),
      confirmLabel: t('incidentAckConfirm'),
    });
    if (!ok) return;
    nis2.mutate(entry.stage, {
      onSuccess: () => toast.success(t('incidentAckRecorded')),
      onError: (err) => toast.error(incidentErrorMessage(err, t('incidentAckFailed'), t)),
    });
  }

  async function tickDpo() {
    const ok = await confirm({
      title: t('incidentDpoConfirmTitle'),
      message: t('incidentDpoConfirmMessage'),
      consequence: t('incidentAckConsequence'),
      confirmLabel: t('incidentAckConfirm'),
    });
    if (!ok) return;
    dpo.mutate(undefined, {
      onSuccess: () => toast.success(t('incidentAckRecorded')),
      onError: (err) => toast.error(incidentErrorMessage(err, t('incidentAckFailed'), t)),
    });
  }

  return (
    <section aria-labelledby={headingId} className="surface-card p-5" data-testid="nis2-panel">
      <h3
        id={headingId}
        className="flex items-center gap-2 text-base font-semibold text-[color:var(--text-primary)]"
      >
        <Icon name="policy" size={20} className="text-[color:var(--text-muted)]" />
        {t('incidentNis2Title')}
      </h3>
      <p className="mt-1 text-xs text-[color:var(--text-muted)]">{t('incidentNis2Intro')}</p>

      <ul className="mt-4 divide-y divide-[color:var(--border)]">
        {incident.nis2.map((entry) => {
          const state = nis2State(entry, now);
          const style = STATE_STYLE[state.kind];
          const stage = t(STAGE_KEY[entry.stage]);
          return (
            <li
              key={entry.stage}
              data-stage={entry.stage}
              data-state={state.kind}
              className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <Icon name={style.icon} size={20} className={`mt-0.5 shrink-0 ${style.tone}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[color:var(--text-primary)]">{stage}</p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  {state.kind === 'reported'
                    ? state.by
                      ? t('incidentNis2Reported', {
                          date: formatDateTime(state.at, lang),
                          by: state.by,
                        })
                      : t('incidentNis2ReportedNoActor', { date: formatDateTime(state.at, lang) })
                    : t('incidentNis2Due', { date: formatDateTime(entry.dueAt, lang) })}
                </p>
                {state.kind !== 'reported' && (
                  <p className={`text-xs font-medium tabular-nums ${style.tone}`}>
                    {state.kind === 'overdue'
                      ? t('incidentNis2Overdue', { time: formatDuration(state.ms, t) })
                      : t('incidentNis2Left', { time: formatDuration(state.ms, t) })}
                  </p>
                )}
              </div>
              {state.kind !== 'reported' && incident.canAcknowledge && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => tickStage(entry)}
                  aria-label={t('incidentNis2TickAria', { stage })}
                >
                  <Icon name="check" size={16} />
                  {t('incidentNis2Tick')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-[color:var(--border)] pt-4">
        <Icon
          name={incident.dpoInformed ? 'check_circle' : 'shield_person'}
          size={20}
          className={`mt-0.5 shrink-0 ${
            incident.dpoInformed ? 'text-success-fg' : 'text-[color:var(--text-muted)]'
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">
            {t('incidentDpoTitle')}
          </p>
          <p className="text-xs text-[color:var(--text-muted)]">
            {incident.dpoInformed
              ? incident.dpoInformed.by
                ? t('incidentDpoInformed', {
                    date: formatDateTime(incident.dpoInformed.at, lang),
                    by: incident.dpoInformed.by,
                  })
                : t('incidentDpoInformedNoActor', {
                    date: formatDateTime(incident.dpoInformed.at, lang),
                  })
              : t('incidentDpoNotInformed')}
          </p>
        </div>
        {!incident.dpoInformed && incident.canAcknowledge && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={tickDpo}>
            <Icon name="check" size={16} />
            {t('incidentDpoTick')}
          </Button>
        )}
      </div>
    </section>
  );
}
