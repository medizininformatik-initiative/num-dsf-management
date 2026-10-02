/**
 * OrganizationCard.tsx – the organization summary on the canvas: fields as a
 * description list, status and approval as StatusPills in the shared tones.
 * A failed request shows EntityCard's retry state; the "Set up" empty state
 * only appears when the API reports that no organization exists.
 * Dependencies: useOrganization, useContacts, useApprovalStatus, useModals,
 * EntityCard, Icon, StatusPill, i18n store.
 */
import { useId, type ReactNode } from 'react';
import { useOrganization } from '../../hooks/useOrganization';
import { useContacts } from '../../hooks/useContacts';
import { useApprovalStatus } from '../../hooks/useApproval';
import { useModals } from '../../hooks/useModals';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import type { StatusTone } from '../../lib/statusColors';
import { EntityCard } from './EntityCard';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';

interface Props {
  instanceId: string;
}

/** The organization as GET /organization returns it (null when none exists). */
interface OrganizationRow {
  identifier: string;
  name: string;
  email: string;
  /** MySQL BOOLEAN, so 0/1 from the API. */
  active: boolean | number;
  address_line?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country_code?: string | null;
  client_cert_thumbprint?: string | null;
}

interface ContactSummary {
  id: string;
  name?: string | null;
  email: string;
}

const ACCENT = '#4d41df';

/** Approval status → pill; `none` when there is no request, unknown statuses count as drafts. */
const APPROVAL_PILL: Record<string, { tone: StatusTone; icon?: string; label: TranslationKey }> = {
  APPROVED: { tone: 'success', icon: 'check_circle', label: 'approved' },
  PENDING: { tone: 'warning', icon: 'schedule', label: 'pending' },
  REJECTED: { tone: 'danger', icon: 'cancel', label: 'rejected' },
  DRAFT: { tone: 'neutral', icon: 'edit_note', label: 'orgCardApprovalDraft' },
  none: { tone: 'neutral', label: 'orgCardApprovalNone' },
};

function openOrganizationModal() {
  useModals.getState().openModal('org-edit');
}

export function OrganizationCard({ instanceId }: Props) {
  const { t } = useI18n();
  const orgQuery = useOrganization(instanceId);
  const org = orgQuery.data as OrganizationRow | null | undefined;
  const { data: contacts = [] } = useContacts(instanceId);
  const { data: approval } = useApprovalStatus(instanceId);
  const sharedWithId = useId();

  const card = {
    id: 'organization',
    title: t('organization'),
    borderColor: ACCENT,
    icon: 'corporate_fare',
  };

  if (orgQuery.isError && !org) {
    return (
      <EntityCard {...card} status="error" onRetry={() => void orgQuery.refetch()}>
        {null}
      </EntityCard>
    );
  }
  if (org === undefined) {
    return (
      <EntityCard {...card} status="loading">
        {null}
      </EntityCard>
    );
  }
  if (org === null) {
    return (
      <EntityCard {...card} onAdd={openOrganizationModal} addLabel={t('orgCardSetup')}>
        <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs">
          <span className="entity-card-icon inline-flex h-10 w-10 items-center justify-center rounded-full text-[color:var(--card-accent)]">
            <Icon name="domain_add" size={22} />
          </span>
          <p className="text-[color:var(--text-secondary)]">{t('emptyOrganizationHint')}</p>
          <p className="text-[color:var(--text-muted)]">{t('orgCardSetupHint')}</p>
        </div>
      </EntityCard>
    );
  }

  const approvalStatus: string = approval?.status ?? 'none';
  const approvalPill = APPROVAL_PILL[approvalStatus] ?? APPROVAL_PILL.DRAFT;
  const active = !!org.active;
  const sharedWith = (contacts as ContactSummary[]).slice(0, 5);

  return (
    <EntityCard {...card} onAdd={openOrganizationModal} addLabel={t('edit')}>
      {sharedWith.length > 0 && (
        <div className="mb-3">
          <p
            id={sharedWithId}
            className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]"
          >
            {t('orgCardSharedWith')}
          </p>
          <ul aria-labelledby={sharedWithId} className="flex gap-1">
            {sharedWith.map((c) => (
              <li
                key={c.id}
                title={c.name || c.email}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
              >
                <span aria-hidden="true">{(c.name || c.email)?.[0]?.toUpperCase()}</span>
                <span className="sr-only">{c.name || c.email}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="mb-3 divide-y divide-[color:var(--border)] text-xs">
        <Row label={t('orgCardIdentifier')}>
          <span className="font-mono text-primary dark:text-brand-400">{org.identifier}</span>
        </Row>
        <Row label={t('orgCardCity')}>{`${org.city || '—'} · ${org.country_code || '—'}`}</Row>
        <Row label={t('orgCardAddress')}>{org.address_line || '—'}</Row>
        <Row label={t('orgCardName')}>
          <span className="font-semibold">{org.name}</span>
        </Row>
        <Row label={t('orgCardEmail')}>{org.email}</Row>
        <Row label={t('orgCardStatus')}>
          <StatusPill tone={active ? 'success' : 'danger'} icon={active ? 'check_circle' : 'block'}>
            {active ? t('orgCardActive') : t('orgCardInactive')}
          </StatusPill>
        </Row>
      </dl>

      {/* Pinned to the bottom when the grid stretches the card. */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[color:var(--border)] pt-3 text-xs">
        <span className="text-[color:var(--text-muted)]">{t('orgCardApproval')}</span>
        <StatusPill tone={approvalPill.tone} icon={approvalPill.icon}>
          {t(approvalPill.label)}
        </StatusPill>
      </div>
    </EntityCard>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[2.25rem] items-center justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[color:var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right text-[color:var(--text-primary)]">{children}</dd>
    </div>
  );
}
