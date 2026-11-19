/**
 * MarketplaceAddModal.tsx – Modal for adding a new marketplace process entry.
 * Unsaved input asks before the dialog is dismissed.
 * Dependencies: Modal, FormField, useAddMarketplace, marketplace.schema, i18n.store, sonner
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { FormField, inputClass, ModalFooter } from './FormField';
import { Select } from '../ui/Select';
import { marketplaceAddFormSchema, MarketplaceAddForm } from '../../schemas/marketplace.schema';
import { useAddMarketplace } from '../../hooks/useMarketplace';
import { useI18n } from '../../stores/i18n.store';
import { getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { needsTotpStepUp } from '../../lib/authMode';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MarketplaceAddModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const addMut = useAddMarketplace();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<z.input<typeof marketplaceAddFormSchema>, unknown, MarketplaceAddForm>({
    resolver: zodResolver(marketplaceAddFormSchema),
    defaultValues: { gitUrl: '', status: 'APPROVED', totpCode: '' },
  });

  // Reset when the dialog closes, not when it opens: an effect on open runs
  // after the form is already on screen and wipes whatever was typed first.
  useEffect(() => {
    if (!open) reset({ gitUrl: '', status: 'APPROVED', totpCode: '' });
  }, [open, reset]);

  async function onSubmit(data: MarketplaceAddForm) {
    try {
      const body = needsTotpStepUp() ? data : { gitUrl: data.gitUrl, status: data.status };
      await addMut.mutateAsync(body);
      toast.success(t('formMarketplaceAddSuccess'));
      onClose();
    } catch (err: unknown) {
      const msg = getErrorMessageForStepUp(
        err,
        t('genericActionFailed'),
        t('certStepUpFailedToast'),
      );
      toast.error(msg);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('marketplaceAdd')} isDirty={isDirty}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField label={t('marketplaceFieldGitUrl')} required error={errors.gitUrl?.message}>
          <input
            {...register('gitUrl')}
            type="url"
            spellCheck={false}
            className={inputClass}
            placeholder="https://github.com/owner/repo"
          />
        </FormField>

        <FormField label={t('marketplaceFieldStatus')} required error={errors.status?.message}>
          <Select {...register('status')}>
            <option value="APPROVED">{t('marketplaceStatusApproved')}</option>
            <option value="EXPERIMENTAL">{t('marketplaceStatusExperimental')}</option>
            <option value="DEPRECATED">{t('marketplaceStatusDeprecated')}</option>
          </Select>
        </FormField>

        {needsTotpStepUp() && (
          <FormField label={t('totpCodeLabel')} required error={errors.totpCode?.message}>
            <input
              {...register('totpCode')}
              className={`${inputClass} text-center font-mono tracking-[0.3em]`}
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
            />
          </FormField>
        )}

        <ModalFooter
          onCancel={onClose}
          loading={addMut.isPending}
          submitLabel={t('marketplaceAdd')}
        />
      </form>
    </Modal>
  );
}
