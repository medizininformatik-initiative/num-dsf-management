/**
 * OrganizationModal.tsx — edit modal for the organization record (identity, address, cert thumbprint).
 * React Hook Form + organizationSchema; thumbprint changes require a TOTP code, saved via the cross-user guard.
 * The "active" switch is a labelled role="switch"; unsaved input asks before the dialog is dismissed.
 * Dependencies: Modal, FormField, Icon, useOrganization, useCrossUserGuard, i18n store, authMode.
 */
import { useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { FormField, fieldHintClass, inputClass, ModalFooter } from './FormField';
import { Icon } from '../ui/Icon';
import { organizationSchema, OrganizationFormData } from '../../schemas/organization.schema';
import { useUpdateOrganization } from '../../hooks/useOrganization';
import { useCrossUserGuard } from '../../hooks/useCrossUserGuard';
import { useI18n } from '../../stores/i18n.store';
import { getErrorCode, getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { needsTotpStepUp } from '../../lib/authMode';

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  defaultValues?: Partial<OrganizationFormData>;
}

export function OrganizationModal({ open, onClose, instanceId, defaultValues }: Props) {
  const { t } = useI18n();
  const { mutateAsync, isPending } = useUpdateOrganization(instanceId);
  const guard = useCrossUserGuard();
  const [totpCode, setTotpCode] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<z.input<typeof organizationSchema>, unknown, OrganizationFormData>({
    resolver: zodResolver(organizationSchema),
    defaultValues: { active: true, ...defaultValues },
  });
  const locked = !!defaultValues?.identifier;
  const activeId = useId();
  const activeHintId = useId();

  useEffect(() => {
    if (open && defaultValues) {
      reset({ active: true, ...defaultValues });
      setTotpCode('');
    }
  }, [open, defaultValues, reset]);

  async function onSubmit(data: OrganizationFormData) {
    try {
      await new Promise<void>((resolve, reject) => {
        guard(async () => {
          try {
            const payload = needsTotpStepUp() ? { ...data, totpCode } : data;
            await mutateAsync(payload);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      toast.success(t('orgModalSaveSuccess'));
      // No reset here: the content would change while the dialog animates
      // out; the next opening resets the form.
      onClose();
    } catch (err: unknown) {
      toast.error(
        getErrorCode(err) === 'THUMBPRINT_IN_USE'
          ? t('orgModalThumbprintInUse')
          : getErrorMessageForStepUp(err, t('orgModalSaveFailed'), t('certStepUpFailedToast')),
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('orgModalTitle')}
      subtitle={t('orgModalSubtitle')}
      isDirty={isDirty || totpCode !== ''}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label={t('orgModalFieldIdentifier')}
          required
          error={errors.identifier?.message}
          hint={locked ? t('identifierLockedHelp') : t('orgModalFieldIdentifierHint')}
        >
          {(control) => (
            <>
              <input
                {...register('identifier')}
                {...control}
                className={inputClass}
                placeholder={t('orgModalFieldIdentifierPlaceholder')}
                readOnly={locked}
                disabled={locked}
                title={locked ? t('identifierLockedHelp') : undefined}
                data-testid="org-identifier-input"
              />
              {locked && (
                <p className={`flex items-center gap-1 ${fieldHintClass}`}>
                  <Icon name="lock" size={14} />
                  <span>{t('identifierLocked')}</span>
                </p>
              )}
            </>
          )}
        </FormField>
        <FormField label={t('orgModalFieldName')} required error={errors.name?.message}>
          <input
            {...register('name')}
            className={inputClass}
            placeholder={t('orgModalFieldNamePlaceholder')}
          />
        </FormField>
        <FormField label={t('orgModalFieldEmail')} required error={errors.email?.message}>
          <input
            {...register('email')}
            type="email"
            className={inputClass}
            placeholder={t('orgModalFieldEmailPlaceholder')}
          />
        </FormField>
        <div className="flex items-center justify-between gap-4 rounded-control border border-[color:var(--border)] p-3">
          <div>
            <label
              htmlFor={activeId}
              className="block cursor-pointer text-sm font-semibold text-[color:var(--text-primary)]"
            >
              {t('orgModalActiveLabel')}
            </label>
            <p id={activeHintId} className={fieldHintClass}>
              {t('orgModalActiveHint')}
            </p>
          </div>
          <span className="relative inline-flex shrink-0 items-center">
            <input
              id={activeId}
              type="checkbox"
              role="switch"
              aria-describedby={activeHintId}
              {...register('active')}
              className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            />
            <span
              aria-hidden="true"
              className="h-6 w-10 rounded-full bg-[color:var(--border-strong)] transition-colors duration-short ease-standard after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-medium after:ease-spring-bouncy after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus-ring)] dark:peer-checked:bg-brand-400"
            />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t('orgModalFieldAddress')} error={errors.addressLine?.message}>
            <input
              {...register('addressLine')}
              className={inputClass}
              placeholder={t('orgModalFieldAddressPlaceholder')}
            />
          </FormField>
          <FormField label={t('orgModalFieldPostal')} error={errors.postalCode?.message}>
            <input
              {...register('postalCode')}
              className={inputClass}
              placeholder={t('orgModalFieldPostalPlaceholder')}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t('orgModalFieldCity')} error={errors.city?.message}>
            <input
              {...register('city')}
              className={inputClass}
              placeholder={t('orgModalFieldCityPlaceholder')}
            />
          </FormField>
          <FormField
            label={t('orgModalFieldCountry')}
            error={errors.countryCode?.message}
            hint={t('orgModalFieldCountryHint')}
          >
            <input
              {...register('countryCode')}
              className={inputClass}
              placeholder="DE"
              maxLength={2}
            />
          </FormField>
        </div>
        <FormField
          label={t('orgModalFieldThumbprint')}
          error={errors.clientCertThumbprint?.message}
          hint={t('orgModalFieldThumbprintHint')}
        >
          <input
            {...register('clientCertThumbprint')}
            className={`${inputClass} font-mono`}
            spellCheck={false}
            placeholder={t('orgModalFieldThumbprintPlaceholder')}
            maxLength={64}
          />
        </FormField>
        {needsTotpStepUp() &&
          watch('clientCertThumbprint') !== (defaultValues?.clientCertThumbprint ?? '') && (
            <FormField
              label={t('orgModalThumbprintTotpLabel')}
              hint={t('orgModalThumbprintTotpHint')}
            >
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className={`${inputClass} text-center font-mono tracking-[0.3em]`}
              />
            </FormField>
          )}
        <ModalFooter onCancel={onClose} loading={isPending} submitLabel={t('orgModalSaveBtn')} />
      </form>
    </Modal>
  );
}
