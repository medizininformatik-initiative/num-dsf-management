/**
 * CertificateModal.tsx — modal to add a certificate: paste the PEM, drop a
 * file on the drop zone or pick one (.pem, .crt, .cer). A debounced server
 * preview shows what would be registered (subject, expiry, DSF fingerprint,
 * issuer checks); Save is disabled while the preview reports a state the
 * upload would refuse. Validates via certificateSchema (rejects private keys),
 * submits through the cross-user guard and maps upload error codes to
 * translated messages. Unsaved input asks before the dialog is dismissed.
 * Dependencies: Modal, FormField, PemInput, CertificatePreviewPanel,
 *               useCertificatePreview, useCertificates, useCrossUserGuard.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { FormField, ModalFooter } from './FormField';
import { Callout } from './Callout';
import { PemInput } from './PemInput';
import { CertificatePreviewPanel } from './CertificatePreviewPanel';
import { useCertificatePreview } from './useCertificatePreview';
import { certificateUploadError } from './certificateUpload';
import { certificateSchema, CertificateFormData } from '../../schemas/certificate.schema';
import { useCreateCertificate } from '../../hooks/useCertificates';
import { useCrossUserGuard } from '../../hooks/useCrossUserGuard';
import { useI18n } from '../../stores/i18n.store';

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
}

export function CertificateModal({ open, onClose, instanceId }: Props) {
  const { t } = useI18n();
  const { mutateAsync, isPending } = useCreateCertificate(instanceId);
  const guard = useCrossUserGuard();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<CertificateFormData>({
    resolver: zodResolver(certificateSchema),
    defaultValues: { pem: '' },
  });
  const preview = useCertificatePreview(instanceId, watch('pem') ?? '');

  useEffect(() => {
    if (open) reset({ pem: '' });
  }, [open, reset]);

  async function onSubmit(data: CertificateFormData) {
    try {
      await new Promise<void>((resolve, reject) => {
        guard(async () => {
          try {
            await mutateAsync(data.pem);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      toast.success(t('certModalSaveSuccess'));
      // No reset here: the content would change while the dialog animates
      // out; the next opening resets the form.
      onClose();
    } catch (err: unknown) {
      toast.error(certificateUploadError(err, t, t('certModalSaveFailed')));
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('certModalTitle')} isDirty={isDirty}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Callout tone="warning" icon="key_off" title={t('certModalPrivateKeyWarningTitle')}>
          {t('certModalPrivateKeyWarningBody')}
        </Callout>
        <FormField
          label={t('certModalFieldPem')}
          required
          error={errors.pem?.message}
          hint={t('hintCertificatePem')}
        >
          {(control) => (
            <PemInput
              textareaProps={{ ...register('pem'), ...control }}
              onFileText={(text) =>
                setValue('pem', text, { shouldValidate: true, shouldDirty: true })
              }
              dropHint={t('certModalDropHint')}
            />
          )}
        </FormField>
        <CertificatePreviewPanel result={preview} />
        <ModalFooter
          onCancel={onClose}
          loading={isPending}
          disabled={preview.blocking}
          submitLabel={t('certModalSaveBtn')}
        />
      </form>
    </Modal>
  );
}
