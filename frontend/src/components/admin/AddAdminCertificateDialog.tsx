/**
 * AddAdminCertificateDialog.tsx – hand in an admin login certificate, for the
 * caller's own account (successor) or REQUEST one for a colleague (recovery;
 * four-eyes: a third admin from another site must approve). Paste or
 * drop the PEM; a debounced server preview shows subject, issuer, validity and
 * the SHA-512 fingerprint before anything is stored. Private keys are never
 * sent. Saving needs the TOTP step-up code in OTP sessions (cert sessions
 * confirm through the client certificate). Failures keep the dialog open and
 * show a translated reason.
 * Dependencies: Modal, PemInput, FormField, TotpCodeField, adminCertificatesApi,
 * certificateUpload helpers, lib/certStatus, lib/authMode, i18n store.
 */
import { useEffect, useId, useState } from 'react';
import { isStepUpCodeComplete } from '../../lib/stepUpCode';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Modal } from '../modals/Modal';
import { FormField } from '../modals/FormField';
import { PemInput } from '../modals/PemInput';
import { containsPrivateKey, looksLikeCertificate } from '../modals/certificateUpload';
import { TotpCodeField } from './TotpCodeField';
import { FIELD_CLASS, LABEL_CLASS } from './fieldClasses';
import { Button } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import {
  adminCertificatesApi,
  type AdminCertificatePreview,
} from '../../api/adminCertificates.api';
import { certValidity, CERT_STATE_TONE } from '../../lib/certStatus';
import { formatDate } from '../../lib/dateUtils';
import { fingerprintGroups } from '../../lib/fingerprint';
import { needsTotpStepUp } from '../../lib/authMode';
import { getErrorCode, getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';

export const ADMIN_CERT_PREVIEW_DEBOUNCE_MS = 400;

const ERROR_KEY: Record<string, TranslationKey> = {
  PRIVATE_KEY_REJECTED: 'adminCertErr_PRIVATE_KEY_REJECTED',
  INVALID_PEM: 'adminCertErr_INVALID_PEM',
  CERTIFICATE_EXPIRED: 'adminCertErr_CERTIFICATE_EXPIRED',
  CERTIFICATE_NOT_YET_VALID: 'adminCertErr_CERTIFICATE_NOT_YET_VALID',
  CA_BLACKLISTED: 'adminCertErr_CA_BLACKLISTED',
  CA_NOT_WHITELISTED: 'adminCertErr_CA_NOT_WHITELISTED',
  ADMIN_CERTIFICATE_IN_USE: 'adminCertErr_ADMIN_CERTIFICATE_IN_USE',
  ORG_LOGIN_CERTIFICATE_IN_USE: 'adminCertErr_ORG_LOGIN_CERTIFICATE_IN_USE',
  NOT_AN_ADMIN: 'adminCertErr_NOT_AN_ADMIN',
  USE_SELF_SERVICE: 'adminCertErr_USE_SELF_SERVICE',
  REQUEST_ALREADY_PENDING: 'adminCertErr_REQUEST_ALREADY_PENDING',
  CA_CERTIFICATE_REJECTED: 'adminCertErr_CA_CERTIFICATE_REJECTED',
  CERT_BLOCKED: 'adminCertErr_CERT_BLOCKED',
};

export interface AddAdminCertificateDialogProps {
  open: boolean;
  onClose: () => void;
  /** E-mail of the colleague to register for; omit for the caller's own account. */
  forEmail?: string;
}

export function AddAdminCertificateDialog({
  open,
  onClose,
  forEmail,
}: AddAdminCertificateDialogProps) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const labelId = useId();
  const [pem, setPem] = useState('');
  const [label, setLabel] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [preview, setPreview] = useState<AdminCertificatePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const stepUp = needsTotpStepUp();
  const text = pem.trim();
  const privateKey = containsPrivateKey(text);
  const candidate = looksLikeCertificate(text) && !privateKey;

  useEffect(() => {
    if (open) {
      setPem('');
      setLabel('');
      setTotpCode('');
      setPreview(null);
      setPreviewError(null);
    }
  }, [open]);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!candidate) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      adminCertificatesApi
        .preview(text)
        .then((p) => !cancelled && setPreview(p))
        .catch((err: unknown) => {
          if (cancelled) return;
          const key = ERROR_KEY[getErrorCode(err) ?? ''];
          setPreviewError(key ? t(key) : t('adminCertErr_INVALID_PEM'));
        });
    }, ADMIN_CERT_PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // t changes identity with the language only
  }, [candidate, text, t]);

  const save = useMutation({
    mutationFn: async (code: string | undefined): Promise<unknown> =>
      forEmail
        ? await adminCertificatesApi.addFor(forEmail, text, label.trim() || null, code)
        : await adminCertificatesApi.addMine(text, label.trim() || null, code),
    onSuccess: () => {
      // For a colleague this only opens a four-eyes request.
      toast.success(forEmail ? t('adminCertRequestedToast') : t('adminCertAddedToast'));
      qc.invalidateQueries({ queryKey: ['admin', 'certificates'] });
      onClose();
    },
    onError: (err: unknown) => {
      setTotpCode('');
      const key = ERROR_KEY[getErrorCode(err) ?? ''];
      toast.error(
        key
          ? t(key)
          : getErrorMessageForStepUp(err, t('genericActionFailed'), t('certStepUpFailedToast')),
      );
    },
  });

  const validity = preview ? certValidity(preview.validUntil) : null;
  const blocked =
    privateKey ||
    !!previewError ||
    !preview ||
    preview.issuerBlacklisted ||
    (preview.whitelistEnforced && !preview.issuerTrusted) ||
    validity?.state === 'expired';
  const canSave = !save.isPending && !blocked && (!stepUp || isStepUpCodeComplete(totpCode));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={forEmail ? t('adminCertRequestTitle') : t('adminCertAddTitle')}
      subtitle={forEmail}
      width="max-w-xl"
      isDirty={text !== ''}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save.mutate(stepUp ? totpCode : undefined);
        }}
      >
        <p className="text-sm text-[color:var(--text-secondary)]">
          {forEmail ? t('adminCertRequestIntro') : t('adminCertAddIntro')}
        </p>
        <FormField label={t('certModalFieldPem')} required hint={t('hintCertificatePem')}>
          {(control) => (
            <PemInput
              textareaProps={{ ...control, value: pem, onChange: (e) => setPem(e.target.value) }}
              onFileText={setPem}
              dropHint={t('certModalDropHint')}
            />
          )}
        </FormField>

        {privateKey && (
          <p role="alert" className="text-sm font-medium text-danger-fg">
            {t('adminCertErr_PRIVATE_KEY_REJECTED')}
          </p>
        )}
        {previewError && (
          <p role="alert" className="text-sm font-medium text-danger-fg">
            {previewError}
          </p>
        )}
        {preview && validity && (
          <dl
            className="space-y-2 rounded-control border border-[color:var(--border)] p-3 text-xs"
            aria-label={t('formCertPreviewTitle')}
          >
            <div>
              <dt className="text-2xs font-semibold text-[color:var(--text-secondary)]">
                {t('formCertPreviewSubject')}
              </dt>
              <dd className="break-all text-[color:var(--text-primary)]">{preview.subject}</dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold text-[color:var(--text-secondary)]">
                {t('formCertPreviewIssuer')}
              </dt>
              <dd className="break-all text-[color:var(--text-primary)]">{preview.issuerDn}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-2xs font-semibold text-[color:var(--text-secondary)]">
                {t('formCertPreviewValidUntil')}
              </dt>
              <dd className="flex items-center gap-2 text-[color:var(--text-primary)]">
                {formatDate(preview.validUntil, lang)}
                <StatusPill tone={CERT_STATE_TONE[validity.state]}>
                  {validity.state === 'expired'
                    ? t('formCertExpired')
                    : t('formCertDaysLeft', { n: validity.days })}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold text-[color:var(--text-secondary)]">
                {t('certCardDsfThumbprintLabel')}
              </dt>
              <dd className="break-all font-mono text-2xs text-[color:var(--text-primary)]">
                {fingerprintGroups(preview.thumbprintSha512).join(' ')}
              </dd>
            </div>
            {preview.issuerBlacklisted && (
              <p role="alert" className="font-medium text-danger-fg">
                {t('adminCertErr_CA_BLACKLISTED')}
              </p>
            )}
            {!preview.issuerBlacklisted && preview.whitelistEnforced && !preview.issuerTrusted && (
              <p role="alert" className="font-medium text-danger-fg">
                {t('adminCertErr_CA_NOT_WHITELISTED')}
              </p>
            )}
            {validity.state === 'expired' && (
              <p role="alert" className="font-medium text-danger-fg">
                {t('adminCertErr_CERTIFICATE_EXPIRED')}
              </p>
            )}
          </dl>
        )}

        <div>
          <label htmlFor={labelId} className={LABEL_CLASS}>
            {t('adminCertLabelField')}
          </label>
          <input
            id={labelId}
            type="text"
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('adminCertLabelPlaceholder')}
            className={FIELD_CLASS}
          />
        </div>

        {stepUp && (
          <TotpCodeField
            label={t('totpCodeLabel')}
            value={totpCode}
            onChange={setTotpCode}
            hint={t('totpDigitsRequired')}
          />
        )}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={!canSave} aria-busy={save.isPending || undefined}>
            {forEmail ? t('adminCertRequestSubmit') : t('adminCertAddSubmit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
