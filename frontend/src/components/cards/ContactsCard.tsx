/**
 * ContactsCard.tsx — entity card listing organization contacts: name, email, translated type
 * badges and the email-verification state. A click anywhere on a row opens the contact
 * editor; the row's named edit button is the keyboard path to the same action. Rows stagger
 * in and carry data-entity-row="contacts:<id>"; the body shows a skeleton or an error with
 * retry while the query loads or fails. Supports add/edit (useModals), resend-verification,
 * and confirmed, cross-user-guarded deletion.
 * Dependencies: useContacts, useOrganization, entities api, confirmDelete, parseJsonArray,
 * EntityCard, FkLink, StatusPill, Button, Icon, sonner.
 */
import { useState, type CSSProperties, type MouseEvent } from 'react';
import { useContacts, useDeleteContact } from '../../hooks/useContacts';
import { EntityCard } from './EntityCard';
import { FkLink } from './FkLink';
import { Details, DetailsToggle } from './CardDetails';
import { useCardDetails } from '../../hooks/useCardDetails';
import { useOrganization } from '../../hooks/useOrganization';
import { useModals } from '../../hooks/useModals';
import { parseJsonArray } from '../../lib/parseJsonArray';
import { api } from '../../api/entities.api';
import { toast } from 'sonner';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import { useConfirmDelete } from '../../lib/confirmDelete';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/** Contact types that receive the certificate expiry reminders. */
const REMINDER_TYPES = ['SECURITY', 'DSF_ADMIN'];

const CONTACT_TYPE: Record<string, { label: TranslationKey; icon: string }> = {
  MEDIC: { label: 'contactCardTypeMedic', icon: 'stethoscope' },
  DSF_ADMIN: { label: 'contactCardTypeDsfAdmin', icon: 'admin_panel_settings' },
  SECURITY: { label: 'contactCardTypeSecurity', icon: 'shield' },
};

interface ContactRow {
  id: string;
  name?: string;
  email: string;
  email_validated?: boolean;
  types: unknown;
}

function openEditor(id: string) {
  useModals.getState().openModal('contact-edit', id);
}

export function ContactsCard({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useContacts(instanceId);
  const contacts: ContactRow[] = data ?? [];
  const { data: org } = useOrganization(instanceId);
  const deleteMut = useDeleteContact(instanceId);
  const confirmDelete = useConfirmDelete();
  const [resendingId, setResendingId] = useState<string | null>(null);
  const details = useCardDetails();

  function requestDelete(c: ContactRow) {
    const name = c.name || c.email;
    const reminders = parseJsonArray(c.types).some((type) => REMINDER_TYPES.includes(type));
    void confirmDelete({
      label: name,
      title: t('contactCardDeleteTitle'),
      message: t('contactCardDeleteMessage', { name }),
      consequence:
        contacts.length === 1
          ? t('contactCardDeleteLastContact')
          : reminders
            ? t('contactCardDeleteReminders')
            : undefined,
      confirmLabel: t('delete'),
      remove: () => deleteMut.mutateAsync(c.id),
    });
  }

  async function resendVerification(c: ContactRow) {
    setResendingId(c.id);
    try {
      await api(instanceId).resendVerification(c.id);
      toast.success(t('contactVerificationSent'));
    } catch {
      toast.error(t('contactVerificationFailed'));
    } finally {
      setResendingId(null);
    }
  }

  function handleRowClick(e: MouseEvent<HTMLLIElement>, c: ContactRow) {
    // Nested controls keep their own action, and selecting text does not open the editor.
    if ((e.target as Element).closest('button, a')) return;
    if (window.getSelection()?.toString()) return;
    openEditor(c.id);
  }

  return (
    <EntityCard
      id="contacts"
      title={t('contacts')}
      borderColor="#9b59b6"
      icon="contact_phone"
      status={isLoading ? 'loading' : isError && !data ? 'error' : 'ready'}
      onRetry={() => void refetch()}
      onAdd={() => useModals.getState().openModal('contact-add')}
    >
      {org && (
        <FkLink label={t('organization')} targetEntity="organization" value={org.identifier} />
      )}

      {contacts.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {contacts.map((c, index) => {
            const name = c.name || c.email;
            return (
              <li
                key={c.id}
                data-entity-row={`contacts:${c.id}`}
                onClick={(e) => handleRowClick(e, c)}
                className="hover-lift animate-list-item-in flex cursor-pointer items-start gap-3 rounded-control bg-[color:var(--bg-hover)] p-3.5"
                style={{ '--stagger-index': index } as CSSProperties}
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-border bg-neutral-surface text-xs font-semibold text-neutral-fg"
                >
                  {name[0]?.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--text-primary)]">
                    <span className="truncate">{name}</span>
                    {!details.detailed && !c.email_validated && (
                      // The simplified view hides the pills but never the problem.
                      <Icon
                        name="mark_email_unread"
                        size={16}
                        label={t('contactCardEmailUnverified')}
                        title={t('contactCardEmailUnverified')}
                        className="shrink-0 text-warning-fg"
                      />
                    )}
                  </p>
                  <Details show={details.detailed && !!c.name}>
                    <p className="truncate text-xs text-[color:var(--text-muted)]">{c.email}</p>
                  </Details>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {parseJsonArray(c.types).map((type) => (
                      <StatusPill key={type} tone="neutral" icon={CONTACT_TYPE[type]?.icon}>
                        {CONTACT_TYPE[type] ? t(CONTACT_TYPE[type].label) : type}
                      </StatusPill>
                    ))}
                    {details.detailed &&
                      (c.email_validated ? (
                        <StatusPill tone="success" icon="mark_email_read">
                          {t('contactCardEmailVerified')}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="warning" icon="mark_email_unread">
                          {t('contactCardEmailUnverified')}
                        </StatusPill>
                      ))}
                  </div>
                  <Details show={details.detailed && !c.email_validated}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={resendingId === c.id}
                      onClick={() => void resendVerification(c)}
                      className="-ml-2 mt-1 text-[color:var(--primary)]"
                    >
                      <Icon name="forward_to_inbox" size={16} />
                      {t('contactResendVerification')}
                    </Button>
                  </Details>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('contactCardEditAria', { name })}
                    onClick={() => openEditor(c.id)}
                    className="h-8 w-8 !px-0"
                  >
                    <Icon name="edit" size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('contactCardDeleteAria', { name })}
                    onClick={() => requestDelete(c)}
                    className="h-8 w-8 !px-0 text-danger-fg hover:!bg-danger-surface hover:!text-danger-fg"
                  >
                    <Icon name="delete" size={16} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-4 text-center text-xs text-[color:var(--text-muted)]">
          {t('emptyContactsHint')}
        </p>
      )}
      <DetailsToggle details={details} />
    </EntityCard>
  );
}
