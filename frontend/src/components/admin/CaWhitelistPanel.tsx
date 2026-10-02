/**
 * CaWhitelistPanel.tsx – the CA whitelist tab of the admin CA page: whether
 * the list is enforced on upload, an add form, and the entries grouped by kind
 * (client CAs, server roots), filtered by the page's search and kind filter.
 * Each entry shows its common name, full DN, SHA-256 fingerprint (copyable),
 * source and expiry; removal asks for confirmation first (useConfirm, or the
 * step-up dialog with the TOTP code in OTP sessions).
 * Dependencies: caWhitelist.api, caBlacklist.api (KnownCaRow), useAdmin keys,
 * useConfirm, lib/certStatus, lib/dateUtils, lib/fingerprint, lib/authMode,
 * lib/getErrorMessage, StatusPill, Icon, CaFingerprint, CaWhitelistAddForm,
 * StepUpConfirmDialog, caDn, i18n store, sonner, TanStack Query.
 */
import { useState, type CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  caWhitelistApi,
  type CaWhitelistData,
  type CaWhitelistKind,
  type CaWhitelistRow,
} from '../../api/caWhitelist.api';
import type { KnownCaRow } from '../../api/caBlacklist.api';
import { CA_WHITELIST_KEY } from '../../hooks/useAdmin';
import { useConfirm } from '../../hooks/useConfirm';
import { useI18n } from '../../stores/i18n.store';
import { certValidity, CERT_STATE_TONE } from '../../lib/certStatus';
import { formatDate } from '../../lib/dateUtils';
import { normalizeFingerprint } from '../../lib/fingerprint';
import { needsTotpStepUp } from '../../lib/authMode';
import { getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { StatusPill } from '../ui/StatusPill';
import { Icon } from '../ui/Icon';
import { CaFingerprint } from './CaFingerprint';
import { CaWhitelistAddForm } from './CaWhitelistAddForm';
import { StepUpConfirmDialog } from './StepUpConfirmDialog';
import { commonName } from './caDn';

export type CaKindFilter = 'ALL' | CaWhitelistKind;

const ENFORCE_VAR = 'CA_WHITELIST_ENFORCE=true';

interface CaWhitelistPanelProps {
  data: CaWhitelistData | undefined;
  isLoading: boolean;
  isError: boolean;
  knownCas: KnownCaRow[];
  query: string;
  kind: CaKindFilter;
}

/** Display label of an entry's source: "DSF 2.1.1" for the seeded defaults. */
function useSourceLabel() {
  const { t } = useI18n();
  return (source: string) =>
    source === 'manual'
      ? t('caSourceManual')
      : /^dsf-/i.test(source)
        ? `DSF ${source.slice(4)}`
        : source;
}

function matchesQuery(row: CaWhitelistRow, query: string, sourceLabel: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [commonName(row.subject_dn), row.subject_dn, sourceLabel, row.reason ?? '']
    .join('\n')
    .toLowerCase();
  if (haystack.includes(q)) return true;
  // A pasted fingerprint, with or without colons or spaces.
  if (/^[0-9a-f:\s]+$/i.test(q)) {
    const hex = normalizeFingerprint(q);
    return hex.length >= 4 && (row.fingerprint ?? '').toLowerCase().includes(hex);
  }
  return false;
}

export function CaWhitelistPanel({
  data,
  isLoading,
  isError,
  knownCas,
  query,
  kind,
}: CaWhitelistPanelProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const sourceLabel = useSourceLabel();
  const [removing, setRemoving] = useState<CaWhitelistRow | null>(null);
  const [removeCode, setRemoveCode] = useState('');

  const enforced = data?.enforced ?? false;
  const all = data?.whitelist ?? [];
  const visible = all.filter(
    (row) =>
      (kind === 'ALL' || row.kind === kind) && matchesQuery(row, query, sourceLabel(row.source)),
  );

  const removeMut = useMutation({
    mutationFn: (vars: { id: string; totpCode?: string }) =>
      caWhitelistApi.remove(vars.id, vars.totpCode),
    onSuccess: () => {
      setRemoving(null);
      setRemoveCode('');
      toast.success(t('caWhitelistRemovedToast'));
    },
    onError: (err: unknown) => {
      setRemoveCode('');
      toast.error(
        getErrorMessageForStepUp(err, t('caWhitelistRemoveFailed'), t('certStepUpFailedToast')),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CA_WHITELIST_KEY }),
  });

  function consequenceOf(row: CaWhitelistRow): string {
    if (row.kind === 'SERVER') return t('caWhitelistRemoveConsequenceServer');
    return enforced
      ? t('caWhitelistRemoveConsequenceEnforced')
      : t('caWhitelistRemoveConsequenceFlagged');
  }

  async function requestRemove(row: CaWhitelistRow) {
    if (needsTotpStepUp()) {
      setRemoveCode('');
      setRemoving(row);
      return;
    }
    const ok = await confirm({
      title: t('caWhitelistRemoveTitle'),
      message: <RemovalSummary row={row} />,
      consequence: consequenceOf(row),
      confirmLabel: t('caRemoveConfirm'),
      destructive: true,
    });
    if (ok) removeMut.mutate({ id: row.id });
  }

  const groups = (['CLIENT', 'SERVER'] as const)
    .filter((k) => kind === 'ALL' || kind === k)
    .map((k) => ({ kind: k, rows: visible.filter((row) => row.kind === k) }));

  return (
    <div className="space-y-6">
      <p className="text-sm text-[color:var(--text-muted)]">{t('caWhitelistIntro')}</p>

      {data && <EnforcementBanner enforced={enforced} />}

      <CaWhitelistAddForm knownCas={knownCas} />

      {isError ? (
        <p role="alert" className="text-sm text-danger-fg">
          {t('caWhitelistLoadFailed')}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-[color:var(--text-muted)]">{t('loading')}</p>
      ) : all.length === 0 ? (
        <p className="text-sm italic text-[color:var(--text-muted)]">{t('caWhitelistEmpty')}</p>
      ) : (
        <>
          <p aria-live="polite" className="text-xs font-medium text-[color:var(--text-muted)]">
            {t('caResultCount', { shown: visible.length, total: all.length })}
          </p>
          {groups.map((group) => (
            <section key={group.kind} aria-labelledby={`ca-group-${group.kind}`}>
              <h2
                id={`ca-group-${group.kind}`}
                className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-primary)]"
              >
                <Icon name={group.kind === 'CLIENT' ? 'badge' : 'dns'} size={18} />
                {group.kind === 'CLIENT' ? t('caKindClient') : t('caKindServer')}
                <span className="text-xs font-medium tabular-nums text-[color:var(--text-muted)]">
                  {group.rows.length}
                </span>
              </h2>
              <p className="mb-3 mt-0.5 text-xs text-[color:var(--text-muted)]">
                {group.kind === 'CLIENT' ? t('caKindClientHint') : t('caKindServerHint')}
              </p>
              {group.rows.length === 0 ? (
                <p className="text-sm italic text-[color:var(--text-muted)]">{t('caNoMatches')}</p>
              ) : (
                <ul className="space-y-2">
                  {group.rows.map((row, i) => (
                    <WhitelistItem
                      key={row.id}
                      row={row}
                      index={i}
                      sourceLabel={sourceLabel(row.source)}
                      onRemove={() => requestRemove(row)}
                      removeDisabled={removeMut.isPending}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}

      <StepUpConfirmDialog
        open={removing !== null}
        title={t('caWhitelistRemoveTitle')}
        message={removing && <RemovalSummary row={removing} />}
        consequence={removing ? consequenceOf(removing) : undefined}
        confirmLabel={t('caRemoveConfirm')}
        destructive
        pending={removeMut.isPending}
        totpCode={removeCode}
        onTotpCodeChange={setRemoveCode}
        onConfirm={(totpCode) => removing && removeMut.mutate({ id: removing.id, totpCode })}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function EnforcementBanner({ enforced }: { enforced: boolean }) {
  const { t } = useI18n();
  const [before, after] = t('caWhitelistNotEnforcedHint').split('{var}');
  return (
    <div
      data-testid="ca-whitelist-enforcement"
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
        enforced
          ? 'border-success-border bg-success-surface text-success-fg'
          : 'border-warning-border bg-warning-surface text-warning-fg'
      }`}
    >
      <Icon name={enforced ? 'verified_user' : 'gpp_maybe'} size={22} className="shrink-0" />
      <p>
        <strong className="font-semibold">
          {enforced ? t('caWhitelistEnforced') : t('caWhitelistNotEnforced')}:
        </strong>{' '}
        {enforced ? (
          t('caWhitelistEnforcedHint')
        ) : (
          <>
            {before}
            <code className="rounded bg-[color:var(--bg-card)] px-1 py-px font-mono text-xs">
              {ENFORCE_VAR}
            </code>
            {after}
          </>
        )}
      </p>
    </div>
  );
}

function ExpiryPill({ notAfter }: { notAfter: string }) {
  const { t, lang } = useI18n();
  const { state } = certValidity(notAfter);
  const date = formatDate(notAfter, lang);
  if (!date) return null;
  const label =
    state === 'expired'
      ? t('caExpired', { date })
      : state === 'valid'
        ? t('caValidUntil', { date })
        : t('caExpiresOn', { date });
  const icon = state === 'expired' ? 'error' : state === 'valid' ? 'event_available' : 'schedule';
  return (
    <StatusPill tone={CERT_STATE_TONE[state]} icon={icon}>
      {label}
    </StatusPill>
  );
}

function WhitelistItem({
  row,
  index,
  sourceLabel,
  onRemove,
  removeDisabled,
}: {
  row: CaWhitelistRow;
  index: number;
  sourceLabel: string;
  onRemove: () => void;
  removeDisabled: boolean;
}) {
  const { t, lang } = useI18n();
  const name = commonName(row.subject_dn);
  const manual = row.source === 'manual';
  return (
    <li
      data-testid="ca-whitelist-row"
      style={{ '--stagger-index': index } as CSSProperties}
      className="animate-list-item-in rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-[color:var(--text-primary)]">
            {name}
          </p>
          <p className="mt-0.5 break-all font-mono text-xs text-[color:var(--text-muted)]">
            {row.subject_dn}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusPill tone={manual ? 'neutral' : 'info'} icon={manual ? 'person' : 'verified'}>
            {sourceLabel}
          </StatusPill>
          <button
            type="button"
            onClick={onRemove}
            disabled={removeDisabled}
            aria-label={t('caRemoveFromWhitelistAria', { name })}
            title={t('caRemoveFromWhitelistAria', { name })}
            className="press-effect rounded-lg p-1.5 text-[color:var(--text-muted)] hover:bg-danger-surface hover:text-danger-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-50"
          >
            <Icon name="delete" size={18} />
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {row.not_after && <ExpiryPill notAfter={row.not_after} />}
        {row.fingerprint && <CaFingerprint value={row.fingerprint} />}
      </div>
      {manual && (
        <p className="mt-2 text-xs text-[color:var(--text-muted)]">
          {t('caAddedByOn', { by: row.added_by, date: formatDate(row.added_at, lang) })}
          {row.reason ? ` · ${row.reason}` : ''}
        </p>
      )}
    </li>
  );
}

function RemovalSummary({ row }: { row: CaWhitelistRow }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <p className="font-semibold text-[color:var(--text-primary)]">
        {commonName(row.subject_dn)}{' '}
        <span className="font-normal text-[color:var(--text-muted)]">
          ({row.kind === 'CLIENT' ? t('caKindClientOption') : t('caKindServerOption')})
        </span>
      </p>
      <p className="break-all font-mono text-xs">{row.subject_dn}</p>
    </div>
  );
}
