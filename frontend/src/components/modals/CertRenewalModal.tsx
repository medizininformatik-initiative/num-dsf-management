/**
 * CertRenewalModal.tsx — guided certificate renewal in three steps under a
 * "Step n of 3" indicator: 1. choose the certificate to replace, 2. enter the
 * new PEM (drop, pick or paste) with the same server preview as the upload
 * dialog, 3. compare and confirm the swap. Steps slide in from the reading
 * direction (forward from the right, back from the left; a crossfade under
 * Reduce Motion) and focus moves to the step title. "Back" returns one step,
 * "Cancel" leaves the flow, and entered PEM text asks before the dialog is
 * dismissed. Upload error codes are mapped to translated messages.
 * Dependencies: Modal, FormField, PemInput, CertificatePreviewPanel,
 *               useCertificatePreview, Callout, StatusPill, Icon, useCertificates,
 *               useCrossUserGuard, lib (certStatus, dateUtils, fingerprint),
 *               CertRenewalModal.css.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { FormField, ModalFooter } from './FormField';
import { Callout } from './Callout';
import { PemInput } from './PemInput';
import { CertificatePreviewPanel, DistinguishedName } from './CertificatePreviewPanel';
import { useCertificatePreview, type CertificatePreviewState } from './useCertificatePreview';
import { certificateUploadError, certValidityLabel } from './certificateUpload';
import { StatusPill } from '../ui/StatusPill';
import { Icon } from '../ui/Icon';
import { certificateSchema, CertificateFormData } from '../../schemas/certificate.schema';
import { useCertificates, useRenewCertificate } from '../../hooks/useCertificates';
import { useCrossUserGuard } from '../../hooks/useCrossUserGuard';
import { useI18n } from '../../stores/i18n.store';
import { certValidity, CERT_STATE_TONE } from '../../lib/certStatus';
import { formatDate } from '../../lib/dateUtils';
import { fingerprintGroups } from '../../lib/fingerprint';
import type { ApiCertificate, CertificatePreview } from '../../api/entities.api';
import type { TranslationKey } from '../../i18n/en';
import './CertRenewalModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
}

type Step = 'select' | 'upload' | 'confirm';

const STEPS: readonly Step[] = ['select', 'upload', 'confirm'];

const STEP_TITLE: Record<Step, TranslationKey> = {
  select: 'formRenewalStepSelect',
  upload: 'formRenewalStepUpload',
  confirm: 'formRenewalStepConfirm',
};

const CHOICE =
  'press-effect flex w-full items-center justify-between gap-3 rounded-control border ' +
  'border-[color:var(--border)] p-3 text-left hover:border-[color:var(--border-strong)] ' +
  'hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';

function previewOf(state: CertificatePreviewState): CertificatePreview | undefined {
  if (state.kind === 'ready') return state.preview;
  if (state.kind === 'loading') return state.previous;
  return undefined;
}

export function CertRenewalModal({ open, onClose, instanceId }: Props) {
  const { t, lang } = useI18n();
  const { data } = useCertificates(instanceId);
  const certs: ApiCertificate[] = data ?? [];
  const renewMut = useRenewCertificate(instanceId);
  const guard = useCrossUserGuard();

  const [step, setStep] = useState<Step>('select');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    formState: { errors, isDirty },
  } = useForm<CertificateFormData>({
    resolver: zodResolver(certificateSchema),
    defaultValues: { pem: '' },
  });
  const pem = watch('pem') ?? '';
  const preview = useCertificatePreview(instanceId, pem);
  const selectedCert = certs.find((c) => c.id === selectedCertId);
  const stepIndex = STEPS.indexOf(step);

  // Every opening starts a fresh flow (resetting on close would flash the
  // first step while the dialog animates out).
  useEffect(() => {
    if (!open) return;
    navigated.current = false;
    setStep('select');
    setDirection('forward');
    setSelectedCertId(null);
    reset({ pem: '' });
  }, [open, reset]);

  // The control that moved on is gone; continue from the new step's title.
  useEffect(() => {
    if (navigated.current) headingRef.current?.focus();
  }, [step]);

  function goTo(next: Step) {
    setDirection(STEPS.indexOf(next) > stepIndex ? 'forward' : 'back');
    navigated.current = true;
    setStep(next);
  }

  async function handleConfirm() {
    if (!selectedCertId) return;
    try {
      await new Promise<void>((resolve, reject) => {
        guard(async () => {
          try {
            await renewMut.mutateAsync({ certId: selectedCertId, pem: getValues('pem') });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      toast.success(t('certRenewalSuccess'));
      onClose();
    } catch (err: unknown) {
      toast.error(certificateUploadError(err, t, t('certRenewalFailed')));
    }
  }

  // Soonest expiry first.
  const sortedCerts = [...certs].sort(
    (a, b) => new Date(a.valid_until).getTime() - new Date(b.valid_until).getTime(),
  );

  return (
    <Modal open={open} onClose={onClose} title={t('certRenewalTitle')} isDirty={isDirty}>
      <div aria-hidden="true" className="mb-3 flex gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors duration-medium ease-standard ${
              i <= stepIndex ? 'bg-primary dark:bg-brand-400' : 'bg-[color:var(--border-strong)]'
            }`}
          />
        ))}
      </div>
      {/* Clips the horizontal slide; the padding keeps focus rings visible. */}
      <div className="-mx-2 overflow-x-clip px-2">
        <div
          key={step}
          className={
            direction === 'forward' ? 'renewal-animate-step-forward' : 'renewal-animate-step-back'
          }
        >
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 outline-none"
          >
            <span className="text-sm font-semibold text-[color:var(--text-primary)]">
              {t(STEP_TITLE[step])}
            </span>
            <span className="text-xs text-[color:var(--text-muted)]">
              {t('formStepOf', { n: stepIndex + 1, total: STEPS.length })}
            </span>
          </h3>

          {step === 'select' && (
            <>
              <p className="mb-3 text-xs text-[color:var(--text-secondary)]">
                {t('certRenewalSelectHint')}
              </p>
              {sortedCerts.length === 0 ? (
                <p className="rounded-control border border-dashed border-[color:var(--border-strong)] p-3 text-center text-xs text-[color:var(--text-muted)]">
                  {t('certRenewalNoCerts')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {sortedCerts.map((cert, i) => {
                    const validity = certValidity(cert.valid_until);
                    return (
                      <li
                        key={cert.id}
                        className="animate-list-item-in"
                        style={{ '--stagger-index': i } as CSSProperties}
                      >
                        <button
                          type="button"
                          className={CHOICE}
                          onClick={() => {
                            setSelectedCertId(cert.id);
                            goTo('upload');
                          }}
                        >
                          <span className="min-w-0">
                            <span className="block break-words text-sm font-medium text-[color:var(--text-primary)]">
                              {cert.subject}
                            </span>
                            <span className="block text-xs text-[color:var(--text-muted)]">
                              {t('certRenewalValidUntil', {
                                date: formatDate(cert.valid_until, lang),
                              })}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <StatusPill tone={CERT_STATE_TONE[validity.state]}>
                              {certValidityLabel(validity, t)}
                            </StatusPill>
                            <Icon
                              name="chevron_right"
                              size={16}
                              className="text-[color:var(--text-muted)]"
                            />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <ModalFooter onCancel={onClose} hideSubmit />
            </>
          )}

          {step === 'upload' && selectedCert && (
            <form onSubmit={handleSubmit(() => goTo('confirm'))} className="space-y-4" noValidate>
              <p className="text-xs text-[color:var(--text-secondary)]">
                {t('certRenewalReplacingLabel')}{' '}
                <strong className="break-words font-semibold text-[color:var(--text-primary)]">
                  {selectedCert.subject}
                </strong>
              </p>
              <FormField
                label={t('formRenewalNewPemLabel')}
                required
                error={errors.pem?.message}
                hint={t('hintCertificatePem')}
              >
                {(control) => (
                  <PemInput
                    textareaProps={{
                      ...register('pem'),
                      ...control,
                      placeholder: t('certRenewalPastePlaceholder'),
                    }}
                    onFileText={(text) =>
                      setValue('pem', text, { shouldValidate: true, shouldDirty: true })
                    }
                    dropHint={t('certRenewalDropHint')}
                  />
                )}
              </FormField>
              <CertificatePreviewPanel result={preview} />
              <ModalFooter
                onBack={() => goTo('select')}
                backLabel={t('certRenewalBackBtn')}
                onCancel={onClose}
                disabled={preview.blocking}
                submitLabel={t('certRenewalReviewBtn')}
              />
            </form>
          )}

          {step === 'confirm' && selectedCert && (
            <>
              <p className="mb-4 text-xs text-[color:var(--text-secondary)]">
                {t('certRenewalConfirmHint')}
              </p>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-control border border-danger-border bg-danger-surface p-3">
                  <p className="text-xs font-semibold text-danger-fg">
                    {t('certRenewalRemovingLabel')}
                  </p>
                  <p className="mt-1 text-xs font-medium text-[color:var(--text-primary)]">
                    <DistinguishedName value={selectedCert.subject} />
                  </p>
                  <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
                    {t('certRenewalUntil', { date: formatDate(selectedCert.valid_until, lang) })}
                  </p>
                </div>
                <div className="rounded-control border border-success-border bg-success-surface p-3">
                  <p className="text-xs font-semibold text-success-fg">
                    {t('certRenewalAddingLabel')}
                  </p>
                  <NewCertificateSummary preview={previewOf(preview.state)} pem={pem} />
                </div>
              </div>
              <Callout tone="info" icon="info">
                {t('certRenewalApprovalHint')}
              </Callout>
              <ModalFooter
                onBack={() => goTo('upload')}
                backLabel={t('certRenewalBackBtn')}
                onCancel={onClose}
                onSubmit={handleConfirm}
                loading={renewMut.isPending}
                submitLabel={t('certRenewalConfirmBtn')}
              />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The incoming certificate: from the preview when available, else a PEM excerpt. */
function NewCertificateSummary({
  preview,
  pem,
}: {
  preview: CertificatePreview | undefined;
  pem: string;
}) {
  const { t, lang } = useI18n();
  if (!preview) {
    return (
      <p className="mt-1 break-all font-mono text-xs text-[color:var(--text-primary)]">
        {pem.trim().slice(0, 60)}…
      </p>
    );
  }
  return (
    <>
      <p className="mt-1 text-xs font-medium text-[color:var(--text-primary)]">
        <DistinguishedName value={preview.subject} />
      </p>
      <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
        {t('certRenewalUntil', { date: formatDate(preview.validUntil, lang) })}
      </p>
      <p className="mt-0.5 font-mono text-xs text-[color:var(--text-secondary)]">
        SHA-512 {fingerprintGroups(preview.thumbprintSha512).slice(0, 4).join(' ')} …
      </p>
    </>
  );
}
