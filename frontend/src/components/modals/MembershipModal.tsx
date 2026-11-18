/**
 * MembershipModal.tsx — add/edit modal for a membership (parent org, endpoint, roles).
 * React Hook Form + membershipSchema; create/update through useMemberships behind the cross-user guard.
 * The parent organization is chosen from the known Verbünde and the parents already in use, or
 * entered as a new identifier. Roles are a labelled checkbox group with translated descriptions; unsaved input asks before the
 * dialog is dismissed. Switching an existing membership to another endpoint shows
 * EndpointChangeWarning.
 * Dependencies: Modal, EndpointChangeWarning, FormField (FormField, FormFieldGroup, CheckboxCards), useMemberships,
 *               useEndpoints, useParentOrganizations, useCrossUserGuard, i18n store.
 */
import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { EndpointChangeWarning } from './EndpointChangeWarning';
import {
  CheckboxCards,
  FormField,
  FormFieldGroup,
  selectClass,
  inputClass,
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
import { useParentOrganizations } from '../../hooks/useParentOrganizations';
import type { ParentOrganizationOption } from '../../api/parentOrganizations.api';
import { useCrossUserGuard } from '../../hooks/useCrossUserGuard';
import { useI18n } from '../../stores/i18n.store';
import { getErrorMessage } from '../../lib/getErrorMessage';
import type { TranslationKey } from '../../i18n/en';

const OTHER = '__other__';

/** Shown when the parent-organization list cannot be loaded. */
const FALLBACK_PARENTS: ParentOrganizationOption[] = [
  {
    identifier: 'medizininformatik-initiative.de',
    name: 'Medizininformatik-Initiative',
    known: true,
    usedBy: 0,
  },
  {
    identifier: 'netzwerk-universitaetsmedizin.de',
    name: 'Netzwerk Universitätsmedizin',
    known: true,
    usedBy: 0,
  },
  { identifier: 'eyematics.org', name: 'Eyematics', known: true, usedBy: 0 },
  {
    identifier: 'dktk.dkfz.de',
    name: 'Deutsches Konsortium für Translationale Krebsforschung',
    known: true,
    usedBy: 0,
  },
];

function parentLabel(p: ParentOrganizationOption): string {
  return p.name === p.identifier ? p.identifier : `${p.name} (${p.identifier})`;
}

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
    setValue,
    formState: { errors, isDirty, isSubmitted, defaultValues: initialValues },
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
  const endpointChanged =
    !!membershipId && watch('endpointId') !== (initialValues?.endpointId ?? '');
  const parentsQuery = useParentOrganizations();
  const [customParent, setCustomParent] = useState(false);
  const parents = parentsQuery.isError ? FALLBACK_PARENTS : (parentsQuery.data ?? []);
  const knownParents = parents.filter((p) => p.known);
  const usedParents = parents.filter((p) => !p.known);
  const currentInList = parents.some((p) => p.identifier === currentParent);

  function onParentSelect(value: string) {
    setCustomParent(value === OTHER);
    setValue('parentOrganization', value === OTHER ? '' : value, {
      shouldDirty: true,
      shouldValidate: isSubmitted,
    });
  }

  useEffect(() => {
    if (open) setCustomParent(false);
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
          error={customParent ? undefined : errors.parentOrganization?.message}
          hint={parentsQuery.isError ? t('membershipParentLoadFailed') : undefined}
          infoKey="glossaryParentOrg"
        >
          <select
            value={customParent ? OTHER : (currentParent ?? '')}
            onChange={(e) => onParentSelect(e.target.value)}
            className={selectClass}
          >
            <option value="">
              {parentsQuery.isLoading
                ? t('membershipParentLoading')
                : t('membershipModalFieldParentPlaceholder')}
            </option>
            {currentParent && !currentInList && !customParent && (
              <option value={currentParent}>{currentParent}</option>
            )}
            {knownParents.length > 0 && (
              <optgroup label={t('membershipParentGroupKnown')}>
                {knownParents.map((p) => (
                  <option key={p.identifier} value={p.identifier}>
                    {parentLabel(p)}
                  </option>
                ))}
              </optgroup>
            )}
            {usedParents.length > 0 && (
              <optgroup label={t('membershipParentGroupUsed')}>
                {usedParents.map((p) => (
                  <option key={p.identifier} value={p.identifier}>
                    {parentLabel(p)}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={OTHER}>{t('membershipParentOther')}</option>
          </select>
        </FormField>
        {customParent && (
          <FormField
            label={t('membershipParentCustomLabel')}
            required
            error={errors.parentOrganization?.message}
            hint={t('membershipParentCustomHint')}
          >
            <input
              {...register('parentOrganization')}
              className={`${inputClass} font-mono`}
              placeholder={t('membershipParentCustomPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </FormField>
        )}
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
        {endpointChanged && <EndpointChangeWarning />}
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
