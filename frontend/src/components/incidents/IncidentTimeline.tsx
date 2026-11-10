/**
 * IncidentTimeline.tsx – the append-only event log of an incident, oldest
 * first: per event the type, time, actor and its details in words (measure
 * results, comment text, restart checklist, review note, changed fields), and
 * the hash-chain status of the whole log at the top (verified, or broken at a
 * given entry, in the danger tone). Each event's hash and previous hash sit in
 * a collapsed details element for whoever has to check them.
 * Dependencies: incidentLabels, lib/dateUtils, Icon, StatusPill, i18n store.
 */
import { useId, type ReactNode } from 'react';
import type { IncidentChain, IncidentEvent, SuspendMeasure } from '../../api/incidents.api';
import type { TranslationKey } from '../../i18n/en';
import { formatDateTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { EVENT_ICON, EVENT_KEY, FIELD_KEY, MEASURE_KEY, STAGE_KEY } from './incidentLabels';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;
type Details = Record<string, unknown>;

const str = (d: Details, k: string): string | null =>
  typeof d[k] === 'string' ? (d[k] as string) : null;
const num = (d: Details, k: string): number | null =>
  typeof d[k] === 'number' ? (d[k] as number) : null;

function measureResult(d: Details, t: T): string | null {
  const parts: string[] = [];
  const blocked = num(d, 'blocked');
  const removed = num(d, 'removedLogins');
  const version = num(d, 'versionNumber');
  const mailed = num(d, 'mailed');
  if (blocked !== null) parts.push(t('incidentResultBlocked', { n: blocked }));
  if (removed !== null) {
    parts.push(t('incidentResultLogins', { n: removed, s: num(d, 'sessionsRevoked') ?? 0 }));
  }
  if (str(d, 'sessionsSkipped') === 'OWNER_IS_ADMIN')
    parts.push(t('incidentResultSessionsSkipped'));
  if (version !== null) parts.push(t('incidentResultVersion', { v: version }));
  if (mailed !== null) parts.push(t('incidentResultMailed', { n: mailed }));
  return parts.length ? parts.join(' · ') : null;
}

function updatedValue(field: string, value: unknown, t: T, lang: 'de' | 'en'): string {
  if (value === null || value === undefined || value === '') return t('incidentValueNone');
  if (field === 'detectedAt' && typeof value === 'string') return formatDateTime(value, lang);
  return String(value);
}

function EventDetails({ event }: { event: IncidentEvent }): ReactNode {
  const { t, lang } = useI18n();
  const d = event.details ?? {};
  const text = 'whitespace-pre-wrap break-words text-sm text-[color:var(--text-secondary)]';
  switch (event.type) {
    case 'REPORTED': {
      const level = num(d, 'escalationLevel');
      return level ? <p className={text}>{t('incidentDetailLevel', { n: level })}</p> : null;
    }
    case 'SUSPENDED':
    case 'MEASURE': {
      const measure = str(d, 'measure') as SuspendMeasure | null;
      const result = measureResult(d, t);
      return (
        <div className={text}>
          {measure && MEASURE_KEY[measure] && <p>{t(MEASURE_KEY[measure])}</p>}
          {result && <p className="text-xs text-[color:var(--text-muted)]">{result}</p>}
        </div>
      );
    }
    case 'COMMENT':
      return <p className={text}>{str(d, 'text')}</p>;
    case 'SUSPENSION_LIFTED': {
      const version = num(d, 'versionNumber');
      return (
        <div className={text}>
          <ul className="space-y-0.5">
            {(
              [
                ['causeFixed', 'incidentLiftCauseFixed'],
                ['fixTested', 'incidentLiftFixTested'],
                ['releasedByTechBoard', 'incidentLiftReleased'],
              ] as const
            )
              .filter(([k]) => d[k] === true)
              .map(([k, key]) => (
                <li key={k} className="flex items-center gap-1.5">
                  <Icon name="check" size={14} className="shrink-0 text-success-fg" />
                  {t(key)}
                </li>
              ))}
          </ul>
          {str(d, 'note') && <p className="mt-1">{str(d, 'note')}</p>}
          {version !== null && (
            <p className="text-xs text-[color:var(--text-muted)]">
              {t('incidentResultVersion', { v: version })}
            </p>
          )}
        </div>
      );
    }
    case 'CLOSED':
      return <p className={text}>{str(d, 'reviewNote')}</p>;
    case 'FALSE_ALARM':
      return <p className={text}>{str(d, 'reason')}</p>;
    case 'UPDATED': {
      const field = str(d, 'field') ?? '';
      const label = FIELD_KEY[field] ? t(FIELD_KEY[field]) : field;
      const stage = str(d, 'stage');
      if (field === 'nis2' || field === 'dpoInformed') {
        const what =
          stage && stage in STAGE_KEY ? t(STAGE_KEY[stage as keyof typeof STAGE_KEY]) : label;
        return <p className={text}>{t('incidentUpdatedRecorded', { field: what })}</p>;
      }
      return (
        <p className={`${text} break-all`}>
          {t('incidentUpdatedFromTo', {
            field: label,
            from: updatedValue(field, d.from, t, lang),
            to: updatedValue(field, d.to, t, lang),
          })}
        </p>
      );
    }
    default:
      return null;
  }
}

export function ChainStatus({ chain }: { chain: IncidentChain }) {
  const { t } = useI18n();
  if (chain.valid) {
    return (
      <StatusPill tone="success" icon="verified" title={t('incidentChainHint')}>
        {t('incidentChainValid')}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="danger" icon="gpp_bad" role="status" title={t('incidentChainHint')}>
      {chain.brokenAt !== null
        ? t('incidentChainBroken', { n: chain.brokenAt })
        : t('incidentChainBrokenUnknown')}
    </StatusPill>
  );
}

export function IncidentTimeline({
  events,
  chain,
}: {
  events: IncidentEvent[];
  chain: IncidentChain;
}) {
  const { t, lang } = useI18n();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="surface-card p-5"
      data-testid="incident-timeline"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold text-[color:var(--text-primary)]">
          {t('incidentTimelineTitle')}
        </h3>
        <ChainStatus chain={chain} />
      </div>
      <p className="mt-1 text-xs text-[color:var(--text-muted)]">{t('incidentChainHint')}</p>

      <ol className="mt-4 space-y-4">
        {events.map((event) => {
          const broken = !chain.valid && chain.brokenAt === event.seq;
          return (
            <li key={event.id} data-type={event.type} className="flex gap-3">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  broken
                    ? 'bg-danger-surface text-danger-fg'
                    : 'bg-[color:var(--bg-hover)] text-[color:var(--text-secondary)]'
                }`}
              >
                <Icon name={EVENT_ICON[event.type] ?? 'circle'} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-semibold text-[color:var(--text-primary)]">
                    {EVENT_KEY[event.type] ? t(EVENT_KEY[event.type]) : event.type}
                  </span>
                  <time dateTime={event.at} className="text-xs text-[color:var(--text-muted)]">
                    {formatDateTime(event.at, lang)}
                  </time>
                  <span className="text-xs text-[color:var(--text-muted)]">
                    {event.actorEmail ?? t('incidentActorHidden')}
                  </span>
                </p>
                <div className="mt-1">
                  <EventDetails event={event} />
                </div>
                <details className="mt-1 text-xs text-[color:var(--text-muted)]">
                  <summary className="cursor-pointer select-none rounded-small focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]">
                    #{event.seq} · {t('incidentHashValues')}
                  </summary>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 font-mono">
                    <dt>{t('incidentPrevHashLabel')}</dt>
                    <dd className="break-all">{event.prevHash}</dd>
                    <dt>{t('incidentHashLabel')}</dt>
                    <dd className="break-all">{event.hash}</dd>
                  </dl>
                </details>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
