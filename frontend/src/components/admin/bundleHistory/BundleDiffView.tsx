/**
 * BundleDiffView.tsx – plain-language rendering of a bundle diff: a one-line
 * summary, then one glass card per organization with its changes (colour +
 * icon + text, never colour alone), certificate fingerprints in short groups
 * and an expandable raw-FHIR block for experts.
 * Dependencies: diffModel, Icon, StatusPill, fingerprint helper, i18n store.
 */
import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import { StatusPill } from '../../ui/StatusPill';
import { fingerprintGroups } from '../../../lib/fingerprint';
import { useI18n } from '../../../stores/i18n.store';
import type { TranslationKey } from '../../../i18n/en';
import { TONE_CLASS, type StatusTone } from '../../../lib/statusColors';
import type { BundleVersionDiff } from '../../../api/bundleVersions.api';
import {
  summarySentence,
  type Change,
  type DiffViewModel,
  type OrgDiff,
  type OrgStatus,
} from './diffModel';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const STATUS: Record<OrgStatus, { tone: StatusTone; icon: string; label: TranslationKey }> = {
  added: { tone: 'success', icon: 'add_circle', label: 'historyOrgAdded' },
  removed: { tone: 'danger', icon: 'remove_circle', label: 'historyOrgRemoved' },
  withdrawn: { tone: 'danger', icon: 'block', label: 'historyOrgWithdrawn' },
  changed: { tone: 'info', icon: 'edit', label: 'historyOrgChanged' },
};

function Fingerprint({ value }: { value: string }) {
  const groups = fingerprintGroups(value);
  const short = groups.slice(0, 4);
  return (
    <span title={groups.join(' ')} className="font-mono text-xs tracking-wide">
      {short.join(' ')}
      {groups.length > 4 ? ' …' : ''}
    </span>
  );
}

interface Row {
  tone: StatusTone;
  icon: string;
  label: string;
  body?: React.ReactNode;
}

function rowOf(change: Change, t: Translate): Row {
  switch (change.kind) {
    case 'org-name':
      return {
        tone: 'info',
        icon: 'edit',
        label: t('historyOrgRenamed', { before: change.before, after: change.after }),
      };
    case 'withdrawal-lifted':
      return { tone: 'success', icon: 'undo', label: t('historyWithdrawalLifted') };
    case 'thumbprint-added':
    case 'thumbprint-removed': {
      const added = change.kind === 'thumbprint-added';
      return {
        tone: added ? 'success' : 'danger',
        icon: added ? 'add_circle' : 'remove_circle',
        label: t(added ? 'historyThumbprintAdded' : 'historyThumbprintRemoved'),
        body: <Fingerprint value={change.value} />,
      };
    }
    case 'endpoint-added':
    case 'endpoint-removed': {
      const added = change.kind === 'endpoint-added';
      return {
        tone: added ? 'success' : 'danger',
        icon: added ? 'add_circle' : 'remove_circle',
        label: t(added ? 'historyEndpointAdded' : 'historyEndpointRemoved'),
        body: <span className="break-all font-mono text-xs">{change.address || change.id}</span>,
      };
    }
    case 'endpoint-address':
    case 'endpoint-name': {
      const address = change.kind === 'endpoint-address';
      return {
        tone: 'info',
        icon: 'edit',
        label: t(address ? 'historyEndpointAddress' : 'historyEndpointRenamed'),
        body: (
          <span className="block space-y-0.5 text-xs">
            <span className="block break-all">
              <span className="font-semibold">{t('historyBefore')}: </span>
              <span className="font-mono line-through">{change.before}</span>
            </span>
            <span className="block break-all">
              <span className="font-semibold">{t('historyAfter')}: </span>
              <span className="font-mono">{change.after}</span>
            </span>
          </span>
        ),
      };
    }
    case 'membership-added':
    case 'membership-removed': {
      const added = change.kind === 'membership-added';
      return {
        tone: added ? 'success' : 'danger',
        icon: added ? 'add_circle' : 'remove_circle',
        label: t(added ? 'historyMembershipAdded' : 'historyMembershipRemoved'),
        body: (
          <span className="text-xs">
            {t('historyMembershipVia', { parent: change.parent, endpoint: change.endpoint })}
            {change.roles.length > 0 && (
              <span className="ml-1 font-semibold">{change.roles.join(', ')}</span>
            )}
          </span>
        ),
      };
    }
    case 'membership-roles':
      return {
        tone: 'info',
        icon: 'edit',
        label: t('historyMembershipRoles'),
        body: (
          <span className="text-xs">
            {t('historyMembershipVia', { parent: change.parent, endpoint: change.endpoint })}
            {' · '}
            {[
              change.rolesAdded.length > 0
                ? t('historyRolesAdded', { roles: change.rolesAdded.join(', ') })
                : '',
              change.rolesRemoved.length > 0
                ? t('historyRolesRemoved', { roles: change.rolesRemoved.join(', ') })
                : '',
            ]
              .filter(Boolean)
              .join('; ')}
          </span>
        ),
      };
  }
}

function OrgCard({ org, t }: { org: OrgDiff; t: Translate }) {
  const meta = STATUS[org.status];
  const heading = org.id === null ? t('historyUnassigned') : org.name;
  return (
    <section
      className="glass-thin rounded-card p-4"
      aria-label={heading}
      data-testid="diff-org"
      data-status={org.status}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-[color:var(--text-primary)]">{heading}</h3>
        {org.id !== null && (
          <>
            <StatusPill tone={meta.tone} icon={meta.icon}>
              {t(meta.label)}
            </StatusPill>
            {org.isParent && <StatusPill tone="neutral">{t('historyOrgParent')}</StatusPill>}
            {org.name !== org.id && (
              <span className="font-mono text-[11px] text-[color:var(--text-muted)]">{org.id}</span>
            )}
          </>
        )}
      </header>
      {org.changes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {org.changes.map((c, i) => {
            const row = rowOf(c, t);
            return (
              <li
                key={i}
                className="flex items-start gap-2 rounded-control border border-[color:var(--border)] px-3 py-2"
                data-kind={c.kind}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${TONE_CLASS[row.tone]}`}
                >
                  <Icon name={row.icon} size={16} />
                </span>
                <div className="min-w-0 text-sm text-[color:var(--text-primary)]">
                  <span className="font-semibold">{row.label}</span>
                  {row.body && (
                    <div className="mt-0.5 text-[color:var(--text-secondary)]">{row.body}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface Props {
  model: DiffViewModel;
  raw: BundleVersionDiff;
}

export function BundleDiffView({ model, raw }: Props) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);
  const sentence = summarySentence(model.summary, t);

  if (model.isEmpty) {
    return (
      <p className="glass-thin rounded-card p-4 text-sm text-[color:var(--text-secondary)]">
        {t('historyNoChanges')}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="diff-view">
      <p
        className="text-base font-semibold text-[color:var(--text-primary)]"
        data-testid="diff-summary"
      >
        {sentence}
      </p>
      {model.organizations.map((org) => (
        <OrgCard key={org.id ?? 'unassigned'} org={org} t={t} />
      ))}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          aria-expanded={showRaw}
          className="press-effect inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
        >
          <Icon name={showRaw ? 'expand_less' : 'code'} size={16} />
          {t('historyRawShow')}
        </button>
        {showRaw && (
          <div className="mt-2">
            <p className="mb-1 text-[11px] text-[color:var(--text-muted)]">{t('historyRawHint')}</p>
            <pre
              tabIndex={0}
              className="glass-thin max-h-96 overflow-auto rounded-control p-3 text-[11px] leading-relaxed text-[color:var(--text-primary)]"
              data-testid="diff-raw"
            >
              {JSON.stringify(raw, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
