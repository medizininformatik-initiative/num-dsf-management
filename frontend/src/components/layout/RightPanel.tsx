/**
 * RightPanel.tsx – Status column of the canvas in the calm sidebar language:
 * one header row (the panel title; AppPage overlays its collapse or close
 * button at the right end), the latest approval request (a banner per state
 * with four-eyes progress, reviewer, rejection reason and "Fix the issues and
 * resubmit"), then grouped, collapsible sections without boxes – readiness,
 * entity stats, the request history (translated statuses, relative times,
 * review comments) and the certificate timeline. Section bodies grow and
 * shrink with their height (Collapse).
 * Position-agnostic: the root fills whatever box AppPage gives it (a 280 px
 * column or a drawer, `bare` there drops the chrome material) and scrolls
 * below its header; the sections fade up in a short stagger when it mounts.
 * Dependencies: useApproval, entity hooks, useModals, useScrollEdges,
 * ApprovalStatusBanner, ReadinessChecklist, ExpiryTimeline, Collapse, Icon,
 * sidebarStyles, lib/dateUtils, i18n store.
 */
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
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
import { useScrollEdges } from '../../hooks/useScrollEdges';
import { formatDateTime, relTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import { Icon } from '../ui/Icon';
import { ApprovalStatePill, ApprovalStatusBanner } from './ApprovalStatusBanner';
import { Collapse } from './Collapse';
import { ExpiryTimeline } from './ExpiryTimeline';
import { ReadinessChecklist } from './ReadinessChecklist';
import { FOCUS_RING, SECTION_HEADER } from './sidebarStyles';

const stagger = (index: number) => ({ '--stagger-index': index }) as CSSProperties;

/** A titled group whose header discloses its body. */
function Section({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <section className="animate-list-item-in" style={stagger(index)}>
      <h3 className="mb-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className={`-mx-1.5 flex w-[calc(100%+0.75rem)] items-center justify-between gap-2 rounded-control px-1.5 py-1 text-left hover:text-[color:var(--text-primary)] ${SECTION_HEADER} ${FOCUS_RING}`}
        >
          {title}
          <Icon
            name="chevron_right"
            size={14}
            className={`shrink-0 transition-transform duration-medium ease-spring ${open ? 'rotate-90' : ''}`}
          />
        </button>
      </h3>
      <Collapse id={bodyId} open={open} className="-m-1 p-1">
        {children}
      </Collapse>
    </section>
  );
}

function count(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}

export function RightPanel({
  instanceId,
  className = '',
  bare = false,
}: {
  instanceId: string | null;
  className?: string;
  /** Inside a drawer: no chrome material or edge hairline of its own. */
  bare?: boolean;
}) {
  const { t, lang } = useI18n();
  const headingId = useId();
  const edgesRef = useScrollEdges<HTMLDivElement>();
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
      className={`flex h-full w-full flex-col overflow-hidden ${
        bare ? '' : 'glass-chrome border-b-0 border-l'
      } ${className}`}
    >
      {/* pr-14 leaves room for the button AppPage places in this row. */}
      <div className="flex h-14 shrink-0 items-center pl-5 pr-14">
        <h2
          id={headingId}
          className="truncate text-base font-semibold text-[color:var(--text-primary)]"
        >
          {t('approvalStatus')}
        </h2>
      </div>

      <div
        ref={edgesRef}
        className="scroll-edges flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 pb-6 pt-1"
      >
        <section className="animate-list-item-in" style={stagger(0)}>
          <ApprovalStatusBanner
            approval={approval}
            onResubmit={() => useModals.getState().openModal('approval')}
          />
        </section>

        {instanceId && (
          <Section index={1} title={t('readinessTitle')}>
            <ReadinessChecklist instanceId={instanceId} showTitle={false} />
          </Section>
        )}

        <Section index={2} title={t('overview')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-0.5">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col-reverse">
                <dt className="truncate text-xs text-[color:var(--text-muted)]">{t(s.label)}</dt>
                <dd className="text-lg font-semibold tabular-nums text-[color:var(--text-primary)]">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section index={3} title={t('approvalHistory')}>
          {history.length === 0 ? (
            <p className="text-xs text-[color:var(--text-muted)]">{t('noApprovalRequests')}</p>
          ) : (
            <ol className="space-y-3 pt-0.5">
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
                        className="text-2xs text-[color:var(--text-muted)]"
                      >
                        {relTime(when, t)}
                      </time>
                    </div>
                    {resolved && req.comment && (
                      <p className="mt-1 whitespace-pre-wrap break-words pl-2 text-xs text-[color:var(--text-secondary)]">
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
          <Section index={4} title={t('expiryTimelineTitle')}>
            <ExpiryTimeline instanceId={instanceId} showTitle={false} />
          </Section>
        )}
      </div>
    </aside>
  );
}
