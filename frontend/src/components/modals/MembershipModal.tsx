/**
 * MembershipModal.tsx — add/edit modal for a membership (parent org, endpoint, roles).
 * React Hook Form + membershipSchema; create/update through useMemberships behind the cross-user guard.
 * Roles are a labelled checkbox group with translated descriptions; unsaved input asks before the
 * dialog is dismissed.
 * Dependencies: Modal, FormField (FormField, FormFieldGroup, CheckboxCards), useMemberships,
 *               useEndpoints, useCrossUserGuard, i18n store.
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
  selectClass,
  ModalFooter,
  type CheckboxCardOption,
} from './FormField';
import { membershipSchema, MembershipFormData } from '../../schemas/membership.schema';
import { parseJsonArray } from '../../lib/parseJsonArray';
import {
  useCreateMembership,
  useUpdateMembership,
  useMemberships,
} from '../../hooks/useMemberships';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useCrossUserGuard } from '../../hooks/useCrossUserGuard';
import { useI18n } from '../../stores/i18n.store';
import { getErrorMessage } from '../../lib/getErrorMessage';
import type { TranslationKey } from '../../i18n/en';

const PARENT_ORGS = [
  'medizininformatik-initiative.de',
  'netzwerk-universitaetsmedizin.de',
  'eyematics.org',
  'dktk.dkfz.de',
];

type Role = MembershipFormData['roles'][number];

const ROLES: readonly { value: Role; desc: TranslationKey }[] = [
  { value: 'DIC', desc: 'formRoleDicDesc' },
  { value: 'HRP', desc: 'formRoleHrpDesc' },
  { value: 'DMS', desc: 'formRoleDmsDesc' },
  { value: 'AMS', desc: 'formRoleAmsDesc' },
];

interface EndpointOption {
  identifier: string;
  name?: string | null;
  address: string;
}

interface MembershipRow {
  id: string;
  parent_organization: string;
  endpoint_id?: string | null;
  roles: unknown;
}

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  membershipId?: string;
  defaultValues?: Partial<MembershipFormData>;
}

export function MembershipModal({ open, onClose, instanceId, membershipId, defaultValues }: Props) {
  const { t } = useI18n();
  const { data: endpoints = [] } = useEndpoints(instanceId);
  const createMut = useCreateMembership(instanceId);
  const updateMut = useUpdateMembership(instanceId);
  const isPending = createMut.isPending || updateMut.isPending;
  const guard = useCrossUserGuard();
  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<MembershipFormData>({
    resolver: zodResolver(membershipSchema),
    defaultValues: { roles: [], ...defaultValues },
  });
  const roleOptions: CheckboxCardOption<Role>[] = ROLES.map(({ value, desc }) => ({
    value,
    label: value,
    description: t(desc),
  }));

  const { data: memberships = [] } = useMemberships(instanceId);
  const currentParent = watch('parentOrganization');

  useEffect(() => {
    if (open && membershipId) {
      const ms = (memberships as MembershipRow[]).find((m) => m.id === membershipId);
      if (ms) {
        const roles = parseJsonArray(ms.roles) as MembershipFormData['roles'];
        reset({
          parentOrganization: ms.parent_organization,
          endpointId: ms.endpoint_id || '',
          roles,
        });
      }
    } else if (open && !membershipId) {
      reset({ parentOrganization: '', endpointId: '', roles: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, membershipId, reset]);

  async function onSubmit(data: MembershipFormData) {
    try {
      if (membershipId) {
        await new Promise<void>((resolve, reject) => {
          guard(async () => {
            try {
              await updateMut.mutateAsync({ id: membershipId, data });
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
        toast.success(t('membershipModalUpdateSuccess'));
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
        toast.success(t('membershipModalAddSuccess'));
      }
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('membershipModalSaveFailed')));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={membershipId ? t('membershipModalTitleEdit') : t('membershipModalTitleAdd')}
      isDirty={isDirty}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label={t('membershipModalFieldParent')}
          required
          error={errors.parentOrganization?.message}
          infoKey="glossaryParentOrg"
        >
          <select {...register('parentOrganization')} className={selectClass}>
            <option value="">{t('membershipModalFieldParentPlaceholder')}</option>
            {currentParent && !PARENT_ORGS.includes(currentParent) && (
              <option value={currentParent}>{currentParent}</option>
            )}
            {PARENT_ORGS.map((org) => (
              <option key={org} value={org}>
                {org}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label={t('membershipModalFieldEndpoint')}
          required
          error={errors.endpointId?.message}
          hint={t('membershipModalFieldEndpointHint')}
        >
          <select {...register('endpointId')} className={selectClass}>
            <option value="">{t('membershipModalFieldEndpointPlaceholder')}</option>
            {(endpoints as EndpointOption[]).map((ep) => (
              <option key={ep.identifier} value={ep.identifier}>
                {ep.name || ep.identifier} ({ep.address})
              </option>
            ))}
          </select>
        </FormField>
        <FormFieldGroup
          label={t('membershipModalFieldRoles')}
          required
          error={errors.roles?.message}
          infoKey="glossaryRoles"
        >
          <Controller
            name="roles"
            control={control}
            render={({ field }) => (
              <CheckboxCards
                options={roleOptions}
                value={field.value ?? []}
                onChange={field.onChange}
                firstInputRef={field.ref}
              />
            )}
          />
        </FormFieldGroup>
        <ModalFooter
          onCancel={onClose}
          loading={isPending}
          submitLabel={membershipId ? t('membershipModalUpdateBtn') : t('membershipModalAddBtn')}
        />
      </form>
    </Modal>
  );
}
