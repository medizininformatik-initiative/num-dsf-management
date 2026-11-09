/**
 * EndpointModal.tsx — add/edit modal for a FHIR endpoint and its outgoing IP
 * addresses. A new endpoint starts without IP rows; "Add IP address" appends
 * one and focuses it. Every row shows its own validation error (aria-invalid,
 * aria-describedby), has a named remove button, rises in when added and
 * collapses out when removed (usePresence), with focus moving to a
 * neighbouring row. React Hook Form + endpointSchema; create/update through
 * useEndpoints behind the cross-user guard; unsaved input asks before the
 * dialog is dismissed.
 * Dependencies: Modal, FormField, Button, Icon, usePresence, useEndpoints,
 *               useCrossUserGuard, i18n store.
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useForm, useFieldArray, type UseFormRegister } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Modal } from './Modal';
import {
  FieldError,
  FormField,
  checkboxClass,
  fieldHintClass,
  fieldLabelClass,
  inputClass,
  ModalFooter,
} from './FormField';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { endpointSchema, EndpointFormData } from '../../schemas/endpoint.schema';
import { useCreateEndpoint, useUpdateEndpoint, useEndpoints } from '../../hooks/useEndpoints';
import { useCrossUserGuard } from '../../hooks/useCrossUserGuard';
import { usePresence } from '../../hooks/usePresence';
import { exitMs } from '../../lib/motion';
import { useI18n } from '../../stores/i18n.store';
import { getErrorMessage } from '../../lib/getErrorMessage';

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  endpointId?: string;
  defaultValues?: Partial<EndpointFormData>;
}

interface EndpointRow {
  identifier: string;
  name?: string | null;
  address: string;
  ipAddresses?: { ip: string; isFhir?: unknown; isBpe?: unknown }[];
}

const ROW_EXIT_MS = exitMs('short');
const EMPTY_IP = { ip: '', isFhir: false, isBpe: false };

interface IpAddressRowProps {
  index: number;
  register: UseFormRegister<EndpointFormData>;
  error?: string;
  leaving: boolean;
  onRemove: () => void;
  onExited: () => void;
}

function IpAddressRow({ index, register, error, leaving, onRemove, onExited }: IpAddressRowProps) {
  const { t } = useI18n();
  const { mounted, state } = usePresence(!leaving, ROW_EXIT_MS);
  const errorId = useId();
  const n = index + 1;

  useEffect(() => {
    if (!mounted) onExited();
  }, [mounted, onExited]);

  if (!mounted) return null;
  return (
    // The grid row collapses to 0fr while the row fades out, so the rows below
    // slide up instead of jumping.
    <li
      data-state={state}
      className="grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-short-exit ease-exit data-[state=closed]:grid-rows-[0fr] data-[state=closed]:opacity-0"
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className="animate-list-item-in pb-3"
          style={{ '--stagger-index': index } as CSSProperties}
        >
          <div
            className={`space-y-2 rounded-control border p-3 ${
              error ? 'border-danger-border' : 'border-[color:var(--border)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                {...register(`ipAddresses.${index}.ip`)}
                aria-label={t('formIpRowLabel', { n })}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                className={`${inputClass} flex-1 font-mono`}
                placeholder={t('endpointModalIpPlaceholder')}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 px-0 hover:text-danger-fg"
                aria-label={t('formIpRemove', { n })}
                title={t('formIpRemove', { n })}
                onClick={onRemove}
              >
                <Icon name="delete" size={18} />
              </Button>
            </div>
            {error && <FieldError id={errorId} error={error} />}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[color:var(--text-secondary)]">
                <input
                  type="checkbox"
                  {...register(`ipAddresses.${index}.isFhir`)}
                  className={checkboxClass}
                />
                <span className="font-semibold text-[color:var(--text-primary)]">
                  {t('endpointModalFhirLabel')}
                </span>
                <span>{t('endpointModalFhirDesc')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[color:var(--text-secondary)]">
                <input
                  type="checkbox"
                  {...register(`ipAddresses.${index}.isBpe`)}
                  className={checkboxClass}
                />
                <span className="font-semibold text-[color:var(--text-primary)]">
                  {t('endpointModalBpeLabel')}
                </span>
                <span>{t('endpointModalBpeDesc')}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function LockedNote() {
  const { t } = useI18n();
  return (
    <p className={`flex items-center gap-1 ${fieldHintClass}`}>
      <Icon name="lock" size={14} />
      <span>{t('identifierLocked')}</span>
    </p>
  );
}

export function EndpointModal({ open, onClose, instanceId, endpointId, defaultValues }: Props) {
  const { t } = useI18n();
  const createMut = useCreateEndpoint(instanceId);
  const updateMut = useUpdateEndpoint(instanceId);
  const isPending = createMut.isPending || updateMut.isPending;
  const guard = useCrossUserGuard();
  const {
    register,
    handleSubmit,
    control,
    reset,
    setFocus,
    formState: { errors, isDirty },
  } = useForm<EndpointFormData>({
    resolver: zodResolver(endpointSchema),
    defaultValues: { ipAddresses: [], ...defaultValues },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'ipAddresses' });
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const ipLabelId = useId();
  const ipHintId = useId();

  const { data: endpoints = [] } = useEndpoints(instanceId);

  useEffect(() => {
    if (open && endpointId) {
      const ep = (endpoints as EndpointRow[]).find((e) => e.identifier === endpointId);
      if (ep) {
        reset({
          identifier: ep.identifier,
          name: ep.name || '',
          address: ep.address,
          ipAddresses: (ep.ipAddresses || []).map((ip) => ({
            ip: ip.ip,
            isFhir: !!ip.isFhir,
            isBpe: !!ip.isBpe,
          })),
        });
      }
    } else if (open && !endpointId) {
      reset({ identifier: '', name: '', address: '', ipAddresses: [] });
    }
    if (open) setLeaving(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpointId, reset]);

  function startRemove(id: string) {
    const visible = fields.filter((f) => f.id === id || !leaving.has(f.id));
    const pos = visible.findIndex((f) => f.id === id);
    const neighbour = visible[pos + 1] ?? visible[pos - 1];
    if (neighbour) setFocus(`ipAddresses.${fields.indexOf(neighbour)}.ip`);
    else addButtonRef.current?.focus();
    setLeaving((prev) => new Set(prev).add(id));
  }

  const finishRemove = useCallback(
    (id: string) => {
      const index = fieldsRef.current.findIndex((f) => f.id === id);
      if (index >= 0) remove(index);
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [remove],
  );

  async function onSubmit(data: EndpointFormData) {
    try {
      if (endpointId) {
        await new Promise<void>((resolve, reject) => {
          guard(async () => {
            try {
              await updateMut.mutateAsync({ id: endpointId, data });
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
        toast.success(t('endpointModalUpdateSuccess'));
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
        toast.success(t('endpointModalAddSuccess'));
      }
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('endpointModalSaveFailed')));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={endpointId ? t('endpointModalTitleEdit') : t('endpointModalTitleAdd')}
      isDirty={isDirty}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label={t('endpointModalFieldName')}
          error={errors.name?.message}
          hint={t('endpointModalFieldNameHint')}
        >
          <input
            {...register('name')}
            className={inputClass}
            placeholder={t('endpointModalFieldNamePlaceholder')}
          />
        </FormField>
        <FormField
          label={t('endpointModalFieldIdentifier')}
          required
          error={errors.identifier?.message}
          hint={endpointId ? t('identifierLockedHelp') : t('hintEndpointIdentifier')}
        >
          {(controlProps) => (
            <>
              <input
                {...register('identifier')}
                {...controlProps}
                className={inputClass}
                placeholder={t('endpointModalFieldIdentifierPlaceholder')}
                readOnly={!!endpointId}
                disabled={!!endpointId}
                title={endpointId ? t('identifierLockedHelp') : undefined}
                data-testid="endpoint-identifier-input"
              />
              {endpointId && <LockedNote />}
            </>
          )}
        </FormField>
        <FormField
          label={t('endpointModalFieldAddress')}
          required
          infoKey="glossaryFhirEndpoint"
          error={errors.address?.message}
          hint={t('endpointModalFieldAddressHint')}
        >
          <input
            {...register('address')}
            type="url"
            className={inputClass}
            placeholder={t('endpointModalFieldAddressPlaceholder')}
          />
        </FormField>
        <div
          role="group"
          aria-labelledby={ipLabelId}
          aria-describedby={ipHintId}
          className="space-y-2"
        >
          <div className="flex items-center justify-between gap-3">
            <span id={ipLabelId} className={fieldLabelClass}>
              {t('endpointModalIpLabel')}
            </span>
            <Button
              ref={addButtonRef}
              variant="secondary"
              size="sm"
              onClick={() => append(EMPTY_IP)}
            >
              <Icon name="add" size={14} />
              {t('endpointModalAddIp')}
            </Button>
          </div>
          <div id={ipHintId} className={`space-y-0.5 ${fieldHintClass}`}>
            <p>{t('endpointModalIpHint')}</p>
            <p>{t('hintEndpointIp')}</p>
          </div>
          {fields.length === 0 ? (
            <p className="rounded-control border border-dashed border-[color:var(--border-strong)] p-3 text-center text-xs text-[color:var(--text-muted)]">
              {t('formIpEmpty')}
            </p>
          ) : (
            <ul className="pt-1">
              {fields.map((field, index) => (
                <IpAddressRow
                  key={field.id}
                  index={index}
                  register={register}
                  error={errors.ipAddresses?.[index]?.ip?.message}
                  leaving={leaving.has(field.id)}
                  onRemove={() => startRemove(field.id)}
                  onExited={() => finishRemove(field.id)}
                />
              ))}
            </ul>
          )}
        </div>
        <ModalFooter
          onCancel={onClose}
          loading={isPending}
          submitLabel={endpointId ? t('endpointModalUpdateBtn') : t('endpointModalAddBtn')}
        />
      </form>
    </Modal>
  );
}
