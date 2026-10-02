/**
 * ContactModal.tsx — add/edit modal for an organization contact (types, name, email, address).
 * React Hook Form + contactSchema; create/update through useContacts behind the cross-user guard.
 * Contact types are a labelled checkbox group with translated descriptions; unsaved input asks
 * before the dialog is dismissed.
 * Dependencies: Modal, FormField (FormField, FormFieldGroup, CheckboxCards), Callout, useContacts,
 *               useCrossUserGuard, i18n store.
 */
import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Modal } from './Modal';
import {
  CheckboxCards,
  FormField,
  FormFieldGroup,
  inputClass,
  ModalFooter,
  type CheckboxCardOption,
} from './FormField';
import { Callout } from './Callout';
import { contactSchema, ContactFormData } from '../../schemas/contact.schema';
import { parseJsonArray } from '../../lib/parseJsonArray';
import { useCreateContact, useUpdateContact, useContacts } from '../../hooks/useContacts';
import { useCrossUserGuard } from '../../hooks/useCrossUserGuard';
import { useI18n } from '../../stores/i18n.store';
import { getErrorMessage } from '../../lib/getErrorMessage';
import type { TranslationKey } from '../../i18n/en';

type ContactType = ContactFormData['types'][number];

const TYPES: readonly { value: ContactType; desc: TranslationKey }[] = [
  { value: 'MEDIC', desc: 'formContactTypeMedicDesc' },
  { value: 'DSF_ADMIN', desc: 'formContactTypeDsfAdminDesc' },
  { value: 'SECURITY', desc: 'formContactTypeSecurityDesc' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  contactId?: string;
  defaultValues?: Partial<ContactFormData>;
}

interface ContactRow {
  id: string;
  types: unknown;
  name?: string;
  email: string;
  phone?: string;
  address_line?: string;
  postal_code?: string;
  city?: string;
  country_code?: string;
}

export function ContactModal({ open, onClose, instanceId, contactId, defaultValues }: Props) {
  const { t } = useI18n();
  const createMut = useCreateContact(instanceId);
  const updateMut = useUpdateContact(instanceId);
  const isPending = createMut.isPending || updateMut.isPending;
  const guard = useCrossUserGuard();
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: { types: [], ...defaultValues },
  });
  const typeOptions: CheckboxCardOption<ContactType>[] = TYPES.map(({ value, desc }) => ({
    value,
    label: value,
    description: t(desc),
  }));

  const { data: contacts = [] } = useContacts(instanceId);

  useEffect(() => {
    if (open && contactId) {
      const c = contacts.find((ct: ContactRow) => ct.id === contactId);
      if (c) {
        const types = parseJsonArray(c.types) as ContactFormData['types'];
        reset({
          types,
          name: c.name || '',
          email: c.email,
          phone: c.phone || '',
          addressLine: c.address_line || '',
          postalCode: c.postal_code || '',
          city: c.city || '',
          countryCode: c.country_code || '',
        });
      }
    } else if (open && !contactId) {
      reset({
        types: [],
        name: '',
        email: '',
        phone: '',
        addressLine: '',
        postalCode: '',
        city: '',
        countryCode: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactId, reset]);

  async function onSubmit(data: ContactFormData) {
    try {
      if (contactId) {
        await new Promise<void>((resolve, reject) => {
          guard(async () => {
            try {
              await updateMut.mutateAsync({ id: contactId, data });
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
        toast.success(t('contactModalUpdateSuccess'));
      } else {
        await new Promise<void>((resolve, reject) => {
          guard(async () => {
            try {
              await createMut.mutateAsync(data);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
        toast.success(t('contactModalAddSuccess'));
      }
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('contactModalSaveFailed')));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contactId ? t('contactModalTitleEdit') : t('contactModalTitleAdd')}
      isDirty={isDirty}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Callout tone="info" icon="privacy_tip">
          {t('contactModalPrivacyNote')}
        </Callout>
        <FormFieldGroup label={t('contactModalFieldTypes')} required error={errors.types?.message}>
          <Controller
            name="types"
            control={control}
            render={({ field }) => (
              <CheckboxCards
                options={typeOptions}
                value={field.value ?? []}
                onChange={field.onChange}
                firstInputRef={field.ref}
              />
            )}
          />
        </FormFieldGroup>
        <FormField
          label={t('contactModalFieldName')}
          error={errors.name?.message}
          hint={t('contactModalFieldNameHint')}
        >
          <input
            {...register('name')}
            className={inputClass}
            placeholder={t('contactModalFieldNamePlaceholder')}
          />
        </FormField>
        <FormField
          label={t('contactModalFieldEmail')}
          required
          error={errors.email?.message}
          hint={t('contactModalFieldEmailHint')}
        >
          <input
            {...register('email')}
            type="email"
            className={inputClass}
            placeholder={t('contactModalFieldEmailPlaceholder')}
          />
        </FormField>
        <FormField label={t('contactModalFieldPhone')} error={errors.phone?.message}>
          <input
            {...register('phone')}
            type="tel"
            className={inputClass}
            placeholder={t('contactModalFieldPhonePlaceholder')}
          />
        </FormField>
        <FormField label={t('contactModalFieldAddress')} error={errors.addressLine?.message}>
          <input
            {...register('addressLine')}
            className={inputClass}
            placeholder={t('contactModalFieldAddressPlaceholder')}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={t('contactModalFieldPostal')} error={errors.postalCode?.message}>
            <input
              {...register('postalCode')}
              className={inputClass}
              placeholder={t('contactModalFieldPostalPlaceholder')}
            />
          </FormField>
          <FormField label={t('contactModalFieldCity')} error={errors.city?.message}>
            <input
              {...register('city')}
              className={inputClass}
              placeholder={t('contactModalFieldCityPlaceholder')}
            />
          </FormField>
        </div>
        <FormField label={t('contactModalFieldCountry')} error={errors.countryCode?.message}>
          <input
            {...register('countryCode')}
            className={inputClass}
            placeholder={t('contactModalFieldCountryPlaceholder')}
            maxLength={2}
          />
        </FormField>
        <ModalFooter
          onCancel={onClose}
          loading={isPending}
          submitLabel={contactId ? t('contactModalUpdateBtn') : t('contactModalAddBtn')}
        />
      </form>
    </Modal>
  );
}
