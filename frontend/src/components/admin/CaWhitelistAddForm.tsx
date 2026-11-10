/**
 * CaWhitelistAddForm.tsx – collapsible form that adds a CA to the whitelist:
 * subject DN (suggestions from the known Mozilla CAs, whose SHA-256
 * fingerprint is filled in when picked), kind (client CA or server root), an
 * optional fingerprint (64 hex, colons allowed), a reason and, in OTP
 * sessions, the TOTP step-up code (certificate sessions need none). Mirrors the
 * backend validation; a duplicate is reported inline.
 * Dependencies: caWhitelist.api, caBlacklist.api (KnownCaRow), useAdmin keys,
 * lib/fingerprint, lib/authMode, lib/getErrorMessage, Button, Icon,
 * TotpCodeField, fieldClasses, i18n store, sonner, TanStack Query.
 */
import { useId, useState } from 'react';
import { isStepUpCodeComplete } from '../../lib/stepUpCode';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { caWhitelistApi, type CaWhitelistKind } from '../../api/caWhitelist.api';
import type { KnownCaRow } from '../../api/caBlacklist.api';
import { CA_WHITELIST_KEY } from '../../hooks/useAdmin';
import { useI18n } from '../../stores/i18n.store';
import { normalizeFingerprint } from '../../lib/fingerprint';
import { needsTotpStepUp } from '../../lib/authMode';
import { getErrorCode, getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { TotpCodeField } from './TotpCodeField';
import { FIELD_CLASS, HINT_CLASS, LABEL_CLASS } from './fieldClasses';

const KINDS: CaWhitelistKind[] = ['CLIENT', 'SERVER'];

export function CaWhitelistAddForm({ knownCas }: { knownCas: KnownCaRow[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const formId = useId();
  const listId = useId();
  const fingerprintErrorId = useId();
  const [open, setOpen] = useState(false);
  const [subjectDn, setSubjectDn] = useState('');
  const [kind, setKind] = useState<CaWhitelistKind>('CLIENT');
  const [fingerprint, setFingerprint] = useState('');
  const [fingerprintTouched, setFingerprintTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [conflict, setConflict] = useState(false);

  const stepUp = needsTotpStepUp();
  const dn = subjectDn.trim();
  const hex = normalizeFingerprint(fingerprint);
  // Mirror the backend schema: DN 3–500 characters, fingerprint absent or 64 hex.
  const dnValid = dn.length >= 3 && dn.length <= 500;
  const fingerprintValid =
    fingerprint.trim() === '' || (/^[0-9a-f:\s-]*$/i.test(fingerprint) && hex.length === 64);
  const totpValid = !stepUp || isStepUpCodeComplete(totpCode);

  const addMut = useMutation({
    mutationFn: () =>
      caWhitelistApi.add({
        subjectDn: dn,
        kind,
        ...(hex ? { fingerprint: hex } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(stepUp ? { totpCode } : {}),
      }),
    onSuccess: () => {
      setSubjectDn('');
      setFingerprint('');
      setFingerprintTouched(false);
      setReason('');
      setTotpCode('');
      toast.success(t('caWhitelistAddedToast'));
      qc.invalidateQueries({ queryKey: CA_WHITELIST_KEY });
    },
    onError: (err: unknown) => {
      setTotpCode('');
      if (getErrorCode(err) === 'CONFLICT') {
        setConflict(true);
        return;
      }
      toast.error(
        getErrorMessageForStepUp(err, t('caWhitelistAddFailed'), t('certStepUpFailedToast')),
      );
    },
  });

  function changeSubjectDn(value: string) {
    setSubjectDn(value);
    setConflict(false);
    // Picking a known CA also fills in its SHA-256 fingerprint.
    const known = knownCas.find((c) => c.subject_dn === value);
    if (known && fingerprint.trim() === '') setFingerprint(known.fingerprint);
  }

  const canSubmit = dnValid && fingerprintValid && totpValid && !addMut.isPending;
  const showFingerprintError = fingerprintTouched && !fingerprintValid;

  return (
    <section className="surface-card">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={formId}
          onClick={() => setOpen((v) => !v)}
          className={`press-effect flex w-full items-center gap-2 px-5 py-3 text-left text-base font-semibold text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${open ? 'rounded-t-card' : 'rounded-card'}`}
          data-testid="ca-whitelist-add-toggle"
        >
          <Icon name="add_circle" size={20} className="text-primary dark:text-brand-400" />
          <span className="flex-1">{t('caWhitelistAddTitle')}</span>
          <Icon
            name="expand_more"
            size={20}
            className={`text-[color:var(--text-muted)] transition-transform duration-short ease-standard ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      <form
        id={formId}
        hidden={!open}
        className="animate-fade-in space-y-4 border-t border-[color:var(--border)] p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) addMut.mutate();
        }}
      >
        <div>
          <label className={LABEL_CLASS} htmlFor={`${formId}-dn`}>
            {t('caSubjectDn')}
          </label>
          <input
            id={`${formId}-dn`}
            className={`${FIELD_CLASS} font-mono`}
            value={subjectDn}
            onChange={(e) => changeSubjectDn(e.target.value)}
            list={listId}
            placeholder={t('caSubjectDnPlaceholder')}
            maxLength={500}
            data-testid="ca-whitelist-subject-input"
          />
          <datalist id={listId}>
            {knownCas.map((c) => (
              <option key={c.fingerprint} value={c.subject_dn} />
            ))}
          </datalist>
        </div>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <fieldset>
            <legend className={LABEL_CLASS}>{t('caKindLabel')}</legend>
            <div className="inline-flex rounded-input border border-[color:var(--border)] bg-[color:var(--bg-hover)] p-0.5">
              {KINDS.map((k) => (
                <label
                  key={k}
                  className="cursor-pointer rounded-small px-3 py-1.5 text-sm font-medium text-[color:var(--text-secondary)] transition-colors duration-short ease-standard has-[:checked]:bg-[color:var(--bg-card)] has-[:checked]:text-[color:var(--text-primary)] has-[:checked]:shadow-card-elevated has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--focus-ring)]"
                >
                  <input
                    type="radio"
                    name={`${formId}-kind`}
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                    className="sr-only"
                  />
                  {k === 'CLIENT' ? t('caKindClientOption') : t('caKindServerOption')}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className={LABEL_CLASS} htmlFor={`${formId}-fp`}>
              {t('caFingerprintOptional')}
            </label>
            <input
              id={`${formId}-fp`}
              className={`${FIELD_CLASS} font-mono`}
              value={fingerprint}
              onChange={(e) => setFingerprint(e.target.value)}
              onBlur={() => setFingerprintTouched(true)}
              placeholder={t('caFingerprintPlaceholder')}
              aria-invalid={showFingerprintError || undefined}
              aria-describedby={showFingerprintError ? fingerprintErrorId : undefined}
              data-testid="ca-whitelist-fingerprint-input"
            />
            {showFingerprintError && (
              <span id={fingerprintErrorId} role="alert" className={`${HINT_CLASS} text-danger-fg`}>
                {t('caFingerprintInvalid')}
              </span>
            )}
          </div>
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
            placeholder={t('caWhitelistReasonPlaceholder')}
            maxLength={2000}
          />
        </div>

        {conflict && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-danger-fg">
            <Icon name="error" size={16} className="shrink-0" />
            {t('caWhitelistConflict')}
          </p>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4">
          {stepUp ? (
            <TotpCodeField
              label={t('caBlacklistTotpLabel')}
              value={totpCode}
              onChange={setTotpCode}
              data-testid="ca-whitelist-totp-input"
            />
          ) : (
            <span />
          )}
          <Button type="submit" disabled={!canSubmit} data-testid="ca-whitelist-add-btn">
            <Icon name="add" size={16} />
            {addMut.isPending ? t('caAdding') : t('caWhitelistAddBtn')}
          </Button>
        </div>
      </form>
    </section>
  );
}
