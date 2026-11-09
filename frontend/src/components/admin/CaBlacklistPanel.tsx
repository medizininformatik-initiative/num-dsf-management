/**
 * CaBlacklistPanel.tsx – the CA blacklist tab of the admin CA page: the add
 * form (subject DN with suggestions from the known Mozilla CAs, reason and,
 * in OTP sessions, the TOTP step-up code) and the blacklisted CAs, each
 * removable after a confirmation (useConfirm, or the step-up dialog with the
 * TOTP code in OTP sessions). A CA on the whitelist cannot be blacklisted
 * (409 CA_WHITELISTED); that refusal is explained inline with a shortcut to
 * the entry in the whitelist.
 * Dependencies: caBlacklist.api, useAdmin keys, useConfirm, lib/authMode,
 * lib/dateUtils, lib/getErrorMessage, Button, Icon, CaFingerprint,
 * StepUpConfirmDialog, TotpCodeField, fieldClasses, caDn, i18n store, sonner,
 * TanStack Query.
 */
import { useId, useState, type CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { caBlacklistApi, type CaBlacklistRow, type KnownCaRow } from '../../api/caBlacklist.api';
import { CA_BLACKLIST_KEY } from '../../hooks/useAdmin';
import { useConfirm } from '../../hooks/useConfirm';
import { useI18n } from '../../stores/i18n.store';
import { needsTotpStepUp } from '../../lib/authMode';
import { formatDate } from '../../lib/dateUtils';
import { getErrorCode, getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { CaFingerprint } from './CaFingerprint';
import { StepUpConfirmDialog } from './StepUpConfirmDialog';
import { TotpCodeField } from './TotpCodeField';
import { FIELD_CLASS, LABEL_CLASS } from './fieldClasses';
import { commonName } from './caDn';

interface CaBlacklistPanelProps {
  blacklist: CaBlacklistRow[];
  knownCas: KnownCaRow[];
  isLoading: boolean;
  isError: boolean;
  /** Switch to the whitelist tab, filtered to the given DN's CA. */
  onShowInWhitelist: (subjectDn: string) => void;
}

export function CaBlacklistPanel({
  blacklist,
  knownCas,
  isLoading,
  isError,
  onShowInWhitelist,
}: CaBlacklistPanelProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const formId = useId();
  const [subjectDn, setSubjectDn] = useState('');
  const [reason, setReason] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [whitelistedDn, setWhitelistedDn] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CaBlacklistRow | null>(null);
  const [removeCode, setRemoveCode] = useState('');

  const stepUp = needsTotpStepUp();
  const dn = subjectDn.trim();
  // Mirror the backend addSchema: subjectDn must be 3–500 chars.
  const subjectDnValid = dn.length >= 3 && dn.length <= 500;
  const totpValid = !stepUp || totpCode.length === 6;

  const addMut = useMutation({
    mutationFn: () =>
      caBlacklistApi
        .add({ subjectDn: dn, reason: reason.trim(), ...(stepUp ? { totpCode } : {}) })
        .then((r) => r.data),
    onSuccess: () => {
      setSubjectDn('');
      setReason('');
      setTotpCode('');
      toast.success(t('caBlacklistAddedToast'));
      qc.invalidateQueries({ queryKey: CA_BLACKLIST_KEY });
    },
    onError: (err: unknown) => {
      setTotpCode('');
      if (getErrorCode(err) === 'CA_WHITELISTED') {
        setWhitelistedDn(dn);
        return;
      }
      toast.error(
        getErrorMessageForStepUp(err, t('caBlacklistAddFailed'), t('certStepUpFailedToast')),
      );
    },
  });

  const removeMut = useMutation({
    mutationFn: (vars: { id: string; totpCode?: string }) =>
      caBlacklistApi.remove(vars.id, vars.totpCode),
    onSuccess: () => {
      setRemoving(null);
      setRemoveCode('');
      toast.success(t('caBlacklistRemovedToast'));
    },
    onError: (err: unknown) => {
      setRemoveCode('');
      toast.error(
        getErrorMessageForStepUp(err, t('caBlacklistRemoveFailed'), t('certStepUpFailedToast')),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CA_BLACKLIST_KEY }),
  });

  async function requestRemove(row: CaBlacklistRow) {
    if (stepUp) {
      setRemoveCode('');
      setRemoving(row);
      return;
    }
    const ok = await confirm({
      title: t('caBlacklistRemoveTitle'),
      message: <RemovalSummary row={row} />,
      consequence: t('caBlacklistRemoveConsequence'),
      confirmLabel: t('caRemoveConfirm'),
      destructive: true,
    });
    if (ok) removeMut.mutate({ id: row.id });
  }

  const canSubmit = subjectDnValid && totpValid && !addMut.isPending;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[color:var(--text-muted)]">{t('caBlacklistIntro')}</p>

      <section className="rounded-card border border-[color:var(--border)] bg-[color:var(--bg-card)] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-primary)]">
          <Icon name="block" size={20} className="text-danger-fg" />
          {t('caBlacklistAdd')}
        </h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) addMut.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor={`${formId}-dn`}>
                {t('caSubjectDn')}
              </label>
              <input
                id={`${formId}-dn`}
                className={`${FIELD_CLASS} font-mono`}
                value={subjectDn}
                onChange={(e) => {
                  setSubjectDn(e.target.value);
                  setWhitelistedDn(null);
                }}
                list={`${formId}-known`}
                placeholder={t('caSubjectDnPlaceholder')}
                maxLength={500}
                data-testid="ca-blacklist-subject-input"
              />
              <datalist id={`${formId}-known`}>
                {knownCas.map((c) => (
                  <option key={c.fingerprint} value={c.subject_dn} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor={`${formId}-reason`}>
                {t('caReason')}
              </label>
              <input
                id={`${formId}-reason`}
                className={FIELD_CLASS}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('caReasonPlaceholder')}
                maxLength={2000}
              />
            </div>
          </div>

          {whitelistedDn && (
            <div
              role="alert"
              className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-control border border-danger-border bg-danger-surface p-3 text-sm text-danger-fg"
            >
              <Icon name="gpp_bad" size={20} className="shrink-0" />
              <p className="min-w-0 flex-1">{t('caBlacklistWhitelisted')}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onShowInWhitelist(whitelistedDn)}
              >
                {t('caShowInWhitelist')}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-4">
            {stepUp ? (
              <TotpCodeField
                label={t('caBlacklistTotpLabel')}
                value={totpCode}
                onChange={setTotpCode}
                data-testid="ca-blacklist-totp-input"
              />
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!canSubmit} data-testid="ca-blacklist-add-btn">
              <Icon name="add" size={18} />
              {addMut.isPending ? t('caAdding') : t('caBlacklistAddBtn')}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${formId}-entries`}>
        <h2
          id={`${formId}-entries`}
          className="mb-3 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-primary)]"
        >
          {t('caBlacklistEntries')}
          {!isLoading && (
            <span className="text-xs font-medium tabular-nums text-[color:var(--text-muted)]">
              {blacklist.length}
            </span>
          )}
        </h2>
        {isError ? (
          <p role="alert" className="text-sm text-danger-fg">
            {t('caBlacklistLoadFailed')}
          </p>
        ) : isLoading ? (
          <p className="text-sm text-[color:var(--text-muted)]">{t('loading')}</p>
        ) : blacklist.length === 0 ? (
          <p className="flex items-center gap-2 rounded-card border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--text-muted)]">
            <Icon name="check_circle" size={20} className="text-success-fg" />
            {t('caBlacklistEmpty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {blacklist.map((row, i) => (
              <BlacklistItem
                key={row.id}
                row={row}
                index={i}
                onRemove={() => requestRemove(row)}
                removeDisabled={removeMut.isPending}
              />
            ))}
          </ul>
        )}
      </section>

      <StepUpConfirmDialog
        open={removing !== null}
        title={t('caBlacklistRemoveTitle')}
        message={removing && <RemovalSummary row={removing} />}
        consequence={t('caBlacklistRemoveConsequence')}
        confirmLabel={t('caRemoveConfirm')}
        destructive
        pending={removeMut.isPending}
        totpCode={removeCode}
        onTotpCodeChange={setRemoveCode}
        onConfirm={(code) => removing && removeMut.mutate({ id: removing.id, totpCode: code })}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function BlacklistItem({
  row,
  index,
  onRemove,
  removeDisabled,
}: {
  row: CaBlacklistRow;
  index: number;
  onRemove: () => void;
  removeDisabled: boolean;
}) {
  const { t, lang } = useI18n();
  const name = commonName(row.subject_dn);
  return (
    <li
      style={{ '--stagger-index': index } as CSSProperties}
      className="animate-list-item-in rounded-card border border-[color:var(--border)] bg-[color:var(--bg-card)] p-4"
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
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          aria-label={t('caRemoveFromBlacklistAria', { name })}
          title={t('caRemoveFromBlacklistAria', { name })}
          className="press-effect shrink-0 rounded-control p-1.5 text-[color:var(--text-muted)] hover:bg-danger-surface hover:text-danger-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-50"
        >
          <Icon name="delete" size={18} />
        </button>
      </div>
      {row.fingerprint && (
        <div className="mt-3">
          <CaFingerprint value={row.fingerprint} />
        </div>
      )}
      <p className="mt-2 text-xs text-[color:var(--text-muted)]">
        {t('caAddedByOn', { by: row.added_by, date: formatDate(row.added_at, lang) })}
        {row.reason ? ` · ${row.reason}` : ''}
      </p>
    </li>
  );
}

function RemovalSummary({ row }: { row: CaBlacklistRow }) {
  return (
    <div className="space-y-1">
      <p className="font-semibold text-[color:var(--text-primary)]">{commonName(row.subject_dn)}</p>
      <p className="break-all font-mono text-xs">{row.subject_dn}</p>
    </div>
  );
}
