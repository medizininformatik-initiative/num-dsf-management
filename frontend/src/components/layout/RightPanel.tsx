/**
 * RightPanel.tsx – Status column of the canvas: the latest approval request
 * (a banner per state with four-eyes progress, reviewer and rejection reason,
 * plus "Fix the issues and resubmit"), the readiness checklist, entity stats,
 * the request history (translated statuses, relative times, review comments)
 * and the certificate timeline.
 * Position-agnostic: the root fills whatever box AppPage gives it (a 280 px
 * column or a drawer) on the chrome glass material and scrolls on its own;
 * the sections fade up in a short stagger when it mounts.
 * Dependencies: useApproval, entity hooks, useModals, ApprovalStatusBanner,
 * ReadinessChecklist, ExpiryTimeline, lib/dateUtils, i18n store.
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  useApprovalStatus,
  useApprovalHistory,
  type ApprovalRequest,
  type ApprovalStatus,
} from '../../hooks/useApproval';
import { useContacts } from '../../hooks/useContacts';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useCertificates } from '../../hooks/useCertificates';
import { useMemberships } from '../../hooks/useMemberships';
import { useModals } from '../../hooks/useModals';
import { formatDateTime, relTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import { ApprovalStatePill, ApprovalStatusBanner } from './ApprovalStatusBanner';
import { ExpiryTimeline } from './ExpiryTimeline';
import { ReadinessChecklist } from './ReadinessChecklist';

const sectionHeading =
  'mb-2 text-[11px] font-bold uppercase tracking-widest text-[color:var(--text-muted)]';

function Section({ index, children }: { index: number; children: ReactNode }) {
  return (
    <section className="animate-list-item-in" style={{ '--stagger-index': index } as CSSProperties}>
      {children}
    </section>
  );
}

function count(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}

export function RightPanel({
  instanceId,
  className = '',
}: {
  instanceId: string | null;
  className?: string;
}) {
  const { t, lang } = useI18n();
  const headingId = useId();
  const { data: approvalData } = useApprovalStatus(instanceId);
  const { data: historyData } = useApprovalHistory(instanceId);
  const approval: ApprovalStatus | null | undefined = approvalData;
  const history: ApprovalRequest[] = Array.isArray(historyData) ? historyData : [];
  const { data: contacts } = useContacts(instanceId);
  const { data: endpoints } = useEndpoints(instanceId);
  const { data: certificates } = useCertificates(instanceId);
  const { data: memberships } = useMemberships(instanceId);

  const stats: { label: TranslationKey; value: number }[] = [
    { label: 'contacts', value: count(contacts) },
    { label: 'endpoints', value: count(endpoints) },
    { label: 'certificates', value: count(certificates) },
    { label: 'memberships', value: count(memberships) },
  ];

  return (
    <aside
      aria-labelledby={headingId}
      className={`glass-chrome flex h-full w-full flex-col gap-6 overflow-y-auto overscroll-contain border-b-0 border-l p-5 ${className}`}
    >
      <div>
        <h2
          id={headingId}
          className="text-lg font-bold tracking-tight text-[color:var(--text-primary)]"
        >
          {t('approvalStatus')}
        </h2>
        <p className="text-xs text-[color:var(--text-muted)]">{t('rightPanelSubtitle')}</p>
      </div>

      <Section index={0}>
        <ApprovalStatusBanner
          approval={approval}
          onResubmit={() => useModals.getState().openModal('approval')}
        />
      </Section>

      {instanceId && (
        <Section index={1}>
          <ReadinessChecklist instanceId={instanceId} />
        </Section>
      )}

      <Section index={2}>
        <h3 className={sectionHeading}>{t('overview')}</h3>
        <dl className="grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex flex-col-reverse rounded-xl bg-[color:var(--bg-hover)] p-3 text-center"
            >
              <dt className="truncate text-[11px] text-[color:var(--text-muted)]">{t(s.label)}</dt>
              <dd className="text-lg font-bold text-[color:var(--text-primary)]">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section index={3}>
        <h3 className={sectionHeading}>{t('approvalHistory')}</h3>
        {history.length === 0 ? (
          <p className="text-xs text-[color:var(--text-muted)]">{t('noApprovalRequests')}</p>
        ) : (
          <ol className="space-y-3">
            {history.slice(0, 5).map((req) => {
              const when = req.submitted_at || req.created_at;
              const resolved = req.status === 'APPROVED' || req.status === 'REJECTED';
              return (
                <li key={req.id}>
                  <div className="flex items-center justify-between gap-2">
                    <ApprovalStatePill status={req.status} />
                    <time
                      dateTime={when}
                      title={formatDateTime(when, lang)}
                      className="text-[11px] text-[color:var(--text-muted)]"
                    >
                      {relTime(when, t)}
                    </time>
                  </div>
                  {resolved && req.comment && (
                    <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-[color:var(--border)] pl-2 text-xs text-[color:var(--text-secondary)]">
                      {req.comment}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {count(certificates) > 0 && (
        <Section index={4}>
          <ExpiryTimeline instanceId={instanceId} />
        </Section>
      )}
    </aside>
  );
}
