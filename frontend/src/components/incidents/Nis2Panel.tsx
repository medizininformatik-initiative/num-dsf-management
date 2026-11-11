/**
 * Nis2Panel.tsx – the NIS2 reporting duties of an incident and the DPO
 * record, in the order of BSIG § 32: early warning (24 h), notification
 * (72 h), interim report (only when the BSI requests it), progress report
 * (once the final report falls due while the incident is open) and final
 * report (one month after the notification, "provisional" until that is
 * ticked, or one month after the closure). Per stage the deadline with a live
 * countdown ("overdue by" in the danger tone, "due soon" in the warning tone)
 * or who recorded the report to the BSI and when. Callers with
 * `canAcknowledge` (admins, the reporter, users of the affected site) see a
 * collapsible form of the stage's report fields, can request the interim
 * report, and tick a stage once its fields are saved, or "DPO informed",
 * after a confirmation; the ticks are one-way. The portal never reports to the
 * BSI itself: it is a filling aid and a record.
 * Dependencies: useAcknowledgeNis2, useAcknowledgeDpo, useConfirm, useNow,
 * lib/nis2, lib/nis2Fields, Nis2StageFields, Nis2InterimRequest,
 * incidentLabels, lib/dateUtils, incidentErrors, Button, Icon, i18n store,
 * sonner.
 */
import { useId, useState } from 'react';
import { toast } from 'sonner';
import type { Incident, Nis2Entry, Nis2Stage } from '../../api/incidents.api';
import { useAcknowledgeDpo, useAcknowledgeNis2 } from '../../hooks/useIncidentActions';
import { useConfirm } from '../../hooks/useConfirm';
import { useNow } from '../../hooks/useNow';
import { nis2State, type Nis2State } from '../../lib/nis2';
import { FIELD_STAGE_OF, isNis2StageComplete } from '../../lib/nis2Fields';
import { formatDateTime } from '../../lib/dateUtils';
import { incidentErrorMessage } from './incidentErrors';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Nis2InterimRequest } from './Nis2InterimRequest';
import { Nis2StageFields } from './Nis2StageFields';
import { STAGE_KEY, formatDuration } from './incidentLabels';

const STATE_STYLE: Record<Nis2State['kind'], { icon: string; tone: string }> = {
  reported: { icon: 'check_circle', tone: 'text-success-fg' },
  overdue: { icon: 'error', tone: 'text-danger-fg' },
  soon: { icon: 'schedule', tone: 'text-warning-fg' },
  open: { icon: 'schedule', tone: 'text-[color:var(--text-muted)]' },
  pending: { icon: 'schedule', tone: 'text-[color:var(--text-muted)]' },
};

export function Nis2Panel({ incident }: { incident: Incident }) {
  const { t, lang } = useI18n();
  const headingId = useId();
  const confirm = useConfirm();
  const now = useNow();
  const nis2 = useAcknowledgeNis2(incident.id);
  const dpo = useAcknowledgeDpo(incident.id);
  const busy = nis2.isPending || dpo.isPending;
  const [open, setOpen] = useState<Partial<Record<Nis2Stage, boolean>>>({});
  const hasProgress = incident.nis2.some((e) => e.stage === 'PROGRESS_REPORT');

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

  /** Why a stage cannot be ticked yet, as a hint; null when it can. */
  function blockedHint(entry: Nis2Entry): string | null {
    if (entry.stage === 'INTERIM_REPORT') {
      return entry.requestedAt ? null : t('incidentNis2NeedsRequest');
    }
    const fieldStage = FIELD_STAGE_OF[entry.stage];
    if (fieldStage && !isNis2StageComplete(fieldStage, entry.fields)) {
      return t('incidentNis2NeedsFields');
    }
    return null;
  }

  function dueText(entry: Nis2Entry, state: Nis2State): string {
    if (state.kind === 'reported') {
      return state.by
        ? t('incidentNis2Reported', { date: formatDateTime(state.at, lang), by: state.by })
        : t('incidentNis2ReportedNoActor', { date: formatDateTime(state.at, lang) });
    }
    if (entry.stage === 'INTERIM_REPORT') {
      return entry.requestedAt
        ? t('incidentNis2Requested', { date: formatDateTime(entry.requestedAt, lang) })
        : t('incidentNis2DueOnRequest');
    }
    if (!entry.dueAt) return t('incidentNis2DueAfterClose');
    return t('incidentNis2Due', { date: formatDateTime(entry.dueAt, lang) });
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
          const fieldStage = FIELD_STAGE_OF[entry.stage];
          const showFields = !!fieldStage && entry.fields !== null;
          const complete = !!fieldStage && isNis2StageComplete(fieldStage, entry.fields);
          const locked =
            !!fieldStage && !!incident.nis2.find((e) => e.stage === fieldStage)?.reportedAt;
          const hint =
            state.kind !== 'reported' && incident.canAcknowledge ? blockedHint(entry) : null;
          const expanded = !!open[entry.stage];
          return (
            <li
              key={entry.stage}
              data-stage={entry.stage}
              data-state={state.kind}
              className="py-3 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <Icon name={style.icon} size={20} className={`mt-0.5 shrink-0 ${style.tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[color:var(--text-primary)]">{stage}</p>
                  <p className="text-xs text-[color:var(--text-muted)]">
                    {dueText(entry, state)}
                    {entry.provisional && state.kind !== 'reported' && (
                      <span
                        title={t('incidentNis2ProvisionalHint')}
                        className="ml-2 rounded-full border border-[color:var(--border)] px-1.5 py-px text-[11px] font-medium text-warning-fg"
                      >
                        {t('incidentNis2Provisional')}
                      </span>
                    )}
                  </p>
                  {(state.kind === 'overdue' || state.kind === 'soon' || state.kind === 'open') && (
                    <p className={`text-xs font-medium tabular-nums ${style.tone}`}>
                      {state.kind === 'overdue'
                        ? t('incidentNis2Overdue', { time: formatDuration(state.ms, t) })
                        : t('incidentNis2Left', { time: formatDuration(state.ms, t) })}
                    </p>
                  )}
                  {entry.stage === 'PROGRESS_REPORT' && state.kind !== 'reported' && (
                    <p className="text-xs text-[color:var(--text-muted)]">
                      {t('incidentNis2ProgressHint')}
                    </p>
                  )}
                </div>
                {showFields && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={expanded}
                    aria-label={t('incidentNis2FieldsToggle', { stage })}
                    onClick={() => setOpen((o) => ({ ...o, [entry.stage]: !expanded }))}
                  >
                    <Icon
                      name={complete ? 'check_circle' : 'edit_note'}
                      size={16}
                      className={complete ? 'text-success-fg' : 'text-[color:var(--text-muted)]'}
                    />
                    <span>{t('incidentNis2Fields')}</span>
                    <span className="sr-only">
                      {complete ? t('incidentNis2FieldsComplete') : t('incidentNis2FieldsMissing')}
                    </span>
                    <Icon name={expanded ? 'expand_less' : 'expand_more'} size={16} />
                  </Button>
                )}
                {state.kind !== 'reported' && incident.canAcknowledge && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || hint !== null}
                    onClick={() => tickStage(entry)}
                    aria-label={t('incidentNis2TickAria', { stage })}
                  >
                    <Icon name="check" size={16} />
                    {t('incidentNis2Tick')}
                  </Button>
                )}
              </div>
              {hint && <p className="mt-1 pl-8 text-xs text-[color:var(--text-muted)]">{hint}</p>}
              {entry.stage === 'INTERIM_REPORT' &&
                state.kind !== 'reported' &&
                incident.canAcknowledge && (
                  <Nis2InterimRequest
                    key={entry.requestedAt ?? 'none'}
                    incidentId={incident.id}
                    requestedAt={entry.requestedAt ?? null}
                  />
                )}
              {showFields && expanded && fieldStage && (
                <Nis2StageFields
                  incidentId={incident.id}
                  stage={entry.stage}
                  fieldStage={fieldStage}
                  values={entry.fields ?? {}}
                  locked={locked}
                  shared={fieldStage === 'FINAL_REPORT' && hasProgress}
                />
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
