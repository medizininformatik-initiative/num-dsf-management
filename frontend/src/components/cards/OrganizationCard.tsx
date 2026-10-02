/**
 * OrganizationCard.tsx – the organization summary on the canvas. Name and
 * email are editable in place: a pencil Button per field opens an input
 * (Enter or the check Button saves, Escape or the close Button cancels),
 * validated with organizationSchema, with an inline error, a pending state
 * and a guard against double submission. A failed request shows EntityCard's
 * retry state; the "Set up" empty state only appears when the API reports
 * that no organization exists.
 * Dependencies: useOrganization, useUpdateOrganization, useContacts,
 * useApprovalStatus, useModals, EntityCard, Button, Icon, StatusPill,
 * organizationSchema, i18n store, sonner.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { ZodTypeAny } from 'zod';
import { toast } from 'sonner';
import { useOrganization, useUpdateOrganization } from '../../hooks/useOrganization';
import { useContacts } from '../../hooks/useContacts';
import { useApprovalStatus } from '../../hooks/useApproval';
import { useModals } from '../../hooks/useModals';
import { organizationSchema } from '../../schemas/organization.schema';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import type { StatusTone } from '../../lib/statusColors';
import { EntityCard } from './EntityCard';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';

interface Props {
  instanceId: string;
}

/** The organization as GET /organization returns it (null when none exists). */
interface OrganizationRow {
  identifier: string;
  name: string;
  email: string;
  /** MySQL BOOLEAN, so 0/1 from the API. */
  active: boolean | number;
  address_line?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country_code?: string | null;
  client_cert_thumbprint?: string | null;
}

interface ContactSummary {
  id: string;
  name?: string | null;
  email: string;
}

type EditableField = 'name' | 'email';

const ACCENT = '#4d41df';

/** Approval status → pill; `none` when there is no request, unknown statuses count as drafts. */
const APPROVAL_PILL: Record<string, { tone: StatusTone; icon?: string; label: TranslationKey }> = {
  APPROVED: { tone: 'success', icon: 'check_circle', label: 'approved' },
  PENDING: { tone: 'warning', icon: 'schedule', label: 'pending' },
  REJECTED: { tone: 'danger', icon: 'cancel', label: 'rejected' },
  DRAFT: { tone: 'neutral', icon: 'edit_note', label: 'orgCardApprovalDraft' },
  none: { tone: 'neutral', label: 'orgCardApprovalNone' },
};

function openOrganizationModal() {
  useModals.getState().openModal('org-edit');
}

export function OrganizationCard({ instanceId }: Props) {
  const { t } = useI18n();
  const orgQuery = useOrganization(instanceId);
  const org = orgQuery.data as OrganizationRow | null | undefined;
  const { data: contacts = [] } = useContacts(instanceId);
  const { data: approval } = useApprovalStatus(instanceId);
  const updateMut = useUpdateOrganization(instanceId);
  const sharedWithId = useId();

  const card = {
    id: 'organization',
    title: t('organization'),
    borderColor: ACCENT,
    icon: 'corporate_fare',
  };

  if (orgQuery.isError && !org) {
    return (
      <EntityCard {...card} status="error" onRetry={() => void orgQuery.refetch()}>
        {null}
      </EntityCard>
    );
  }
  if (org === undefined) {
    return (
      <EntityCard {...card} status="loading">
        {null}
      </EntityCard>
    );
  }
  if (org === null) {
    return (
      <EntityCard {...card} onAdd={openOrganizationModal} addLabel={t('orgCardSetup')}>
        <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs">
          <span className="entity-card-icon inline-flex h-10 w-10 items-center justify-center rounded-full text-[color:var(--card-accent)]">
            <Icon name="domain_add" size={22} />
          </span>
          <p className="text-[color:var(--text-secondary)]">{t('emptyOrganizationHint')}</p>
          <p className="text-[color:var(--text-muted)]">{t('orgCardSetupHint')}</p>
        </div>
      </EntityCard>
    );
  }

  const current = org;
  async function saveField(field: EditableField, next: string): Promise<boolean> {
    try {
      await updateMut.mutateAsync({
        identifier: current.identifier,
        name: field === 'name' ? next : current.name,
        email: field === 'email' ? next : current.email,
        active: !!current.active,
        addressLine: current.address_line || '',
        postalCode: current.postal_code || '',
        city: current.city || '',
        countryCode: current.country_code || '',
        clientCertThumbprint: current.client_cert_thumbprint || '',
      });
      toast.success(t('orgCardSaveToast'));
      return true;
    } catch {
      toast.error(t('orgCardSaveFailedToast'));
      return false;
    }
  }

  const approvalStatus: string = approval?.status ?? 'none';
  const approvalPill = APPROVAL_PILL[approvalStatus] ?? APPROVAL_PILL.DRAFT;
  const active = !!org.active;
  const sharedWith = (contacts as ContactSummary[]).slice(0, 5);

  return (
    <EntityCard {...card} onAdd={openOrganizationModal} addLabel={t('edit')}>
      {sharedWith.length > 0 && (
        <div className="mb-3">
          <p
            id={sharedWithId}
            className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]"
          >
            {t('orgCardSharedWith')}
          </p>
          <ul aria-labelledby={sharedWithId} className="flex gap-1">
            {sharedWith.map((c) => (
              <li
                key={c.id}
                title={c.name || c.email}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
              >
                <span aria-hidden="true">{(c.name || c.email)?.[0]?.toUpperCase()}</span>
                <span className="sr-only">{c.name || c.email}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="mb-3 divide-y divide-[color:var(--border)] text-xs">
        <Row label={t('orgCardIdentifier')}>
          <span className="font-mono text-primary dark:text-brand-400">{org.identifier}</span>
        </Row>
        <Row label={t('orgCardCity')}>{`${org.city || '—'} · ${org.country_code || '—'}`}</Row>
        <Row label={t('orgCardAddress')}>{org.address_line || '—'}</Row>
        <InlineField
          label={t('orgCardName')}
          value={org.name}
          schema={organizationSchema.shape.name}
          emphasis
          onSave={(next) => saveField('name', next)}
        />
        <InlineField
          label={t('orgCardEmail')}
          value={org.email}
          type="email"
          schema={organizationSchema.shape.email}
          onSave={(next) => saveField('email', next)}
        />
        <Row label={t('orgCardStatus')}>
          <StatusPill tone={active ? 'success' : 'danger'} icon={active ? 'check_circle' : 'block'}>
            {active ? t('orgCardActive') : t('orgCardInactive')}
          </StatusPill>
        </Row>
      </dl>

      {/* Pinned to the bottom when the grid stretches the card. */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[color:var(--border)] pt-3 text-xs">
        <span className="text-[color:var(--text-muted)]">{t('orgCardApproval')}</span>
        <StatusPill tone={approvalPill.tone} icon={approvalPill.icon}>
          {t(approvalPill.label)}
        </StatusPill>
      </div>
    </EntityCard>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[2.25rem] items-center justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[color:var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right text-[color:var(--text-primary)]">{children}</dd>
    </div>
  );
}

interface InlineFieldProps {
  label: string;
  value: string;
  schema: ZodTypeAny;
  type?: 'text' | 'email';
  emphasis?: boolean;
  /** Resolves true when the value was saved. */
  onSave: (next: string) => Promise<boolean>;
}

/** A field row that switches between its value with a pencil Button and an input. */
function InlineField({ label, value, schema, type = 'text', emphasis, onSave }: InlineFieldProps) {
  const { t } = useI18n();
  const uid = useId();
  const labelId = `${uid}-label`;
  const errorId = `${uid}-error`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Shows the saved value until the refetched organization catches up.
  const [saved, setSaved] = useState<string | null>(null);
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => setSaved(null), [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  const shown = saved ?? value;

  function validate(next: string): string | null {
    const result = schema.safeParse(next.trim());
    return result.success ? null : t(result.error.issues[0].message as TranslationKey);
  }

  function open() {
    setDraft(shown);
    setError(null);
    setEditing(true);
  }

  function close(restoreFocus: boolean) {
    returnFocus.current = restoreFocus;
    setError(null);
    setEditing(false);
  }

  async function save() {
    if (savingRef.current) return;
    const next = draft.trim();
    const problem = validate(next);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    if (next === shown) {
      close(true);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const ok = await onSave(next);
    savingRef.current = false;
    setSaving(false);
    if (ok) {
      setSaved(next);
      close(true);
    } else {
      inputRef.current?.focus();
    }
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setDraft(e.target.value);
    // After a failed attempt, the message follows the input.
    if (error) setError(validate(e.target.value));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!savingRef.current) close(true);
    }
  }

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    // Leaving an unchanged editor closes it; a changed value waits for save or cancel.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (!savingRef.current && draft.trim() === shown) close(false);
  }

  if (!editing) {
    return (
      <div className="flex min-h-[2.25rem] items-center justify-between gap-3 py-0.5">
        <dt id={labelId} className="shrink-0 text-[color:var(--text-muted)]">
          {label}
        </dt>
        <dd className="flex min-w-0 items-center justify-end gap-1">
          <span
            title={shown}
            className={`truncate text-[color:var(--text-primary)] ${emphasis ? 'font-semibold' : ''}`}
          >
            {shown}
          </span>
          <Button
            ref={editButtonRef}
            variant="ghost"
            size="sm"
            className="w-8 shrink-0 px-0"
            aria-label={t('orgCardEditFieldAria', { field: label })}
            onClick={open}
          >
            <Icon name="edit" size={16} />
          </Button>
        </dd>
      </div>
    );
  }

  return (
    <div
      className="flex items-start justify-between gap-3 py-1.5"
      onBlur={handleBlur}
      aria-busy={saving || undefined}
    >
      <dt id={labelId} className="shrink-0 pt-1.5 text-[color:var(--text-muted)]">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">
        <div className="flex items-center justify-end gap-1">
          <input
            ref={inputRef}
            type={type}
            value={draft}
            readOnly={saving}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-labelledby={labelId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="min-w-0 flex-1 rounded-input border border-[color:var(--border-strong)] bg-[color:var(--bg-input)] px-2 py-1.5 text-right text-xs text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus-ring)] aria-[invalid=true]:border-danger-fg"
          />
          <Button
            variant="ghost"
            size="sm"
            className="w-8 shrink-0 px-0"
            aria-label={t('orgCardSaveFieldAria', { field: label })}
            disabled={saving}
            onClick={() => void save()}
          >
            <Icon
              name={saving ? 'progress_activity' : 'check'}
              size={16}
              className={saving ? 'animate-spin' : undefined}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-8 shrink-0 px-0"
            aria-label={t('orgCardCancelFieldAria', { field: label })}
            disabled={saving}
            onClick={() => close(true)}
          >
            <Icon name="close" size={16} />
          </Button>
        </div>
        {error && (
          <p
            id={errorId}
            role="alert"
            className="mt-1 text-right text-[11px] font-medium text-danger-fg"
          >
            {error}
          </p>
        )}
        <span role="status" className="sr-only">
          {saving ? t('orgCardSaving') : ''}
        </span>
      </dd>
    </div>
  );
}
