/**
 * MembershipsCard.tsx — entity card listing memberships: parent organization, roles and the
 * endpoint each membership is bound to, as a foreign key to that endpoint's row. Rows stagger
 * in and carry data-entity-row="memberships:<id>"; the body shows a skeleton or an error with
 * retry while the query loads or fails. Supports add/edit (useModals) and confirmed
 * cross-user-guarded deletion.
 * Dependencies: useMemberships, useOrganization, confirmDelete, parseJsonArray, EntityCard,
 * FkLink, StatusPill, Button, Icon.
 */
import type { CSSProperties } from 'react';
import { useMemberships, useDeleteMembership } from '../../hooks/useMemberships';
import { useOrganization } from '../../hooks/useOrganization';
import { EntityCard } from './EntityCard';
import { FkLink } from './FkLink';
import { parseJsonArray } from '../../lib/parseJsonArray';
import { useModals } from '../../hooks/useModals';
import { useI18n } from '../../stores/i18n.store';
import { useConfirmDelete } from '../../lib/confirmDelete';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface MembershipRow {
  id: string;
  parent_organization: string;
  /** Identifier (FQDN) of the endpoint this membership is bound to. */
  endpoint_id?: string;
  roles: unknown;
}

export function MembershipsCard({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useMemberships(instanceId);
  const memberships: MembershipRow[] = data ?? [];
  const { data: org } = useOrganization(instanceId);
  const deleteMut = useDeleteMembership(instanceId);
  const confirmDelete = useConfirmDelete();

  function requestDelete(ms: MembershipRow) {
    const parent = ms.parent_organization;
    void confirmDelete({
      label: t('membershipCardLabel', { parent }),
      title: t('membershipCardDeleteTitle'),
      message: t('membershipCardDeleteMessage', {
        parent,
        roles: parseJsonArray(ms.roles).join(', '),
      }),
      consequence: t('membershipCardDeleteConsequence', { parent }),
      confirmLabel: t('delete'),
      remove: () => deleteMut.mutateAsync(ms.id),
    });
  }

  return (
    <EntityCard
      id="memberships"
      title={t('memberships')}
      borderColor="#4a90d9"
      icon="groups"
      status={isLoading ? 'loading' : isError && !data ? 'error' : 'ready'}
      onRetry={() => void refetch()}
      onAdd={() => useModals.getState().openModal('membership-add')}
    >
      {org && (
        <FkLink
          label={t('membershipCardFkOrganization')}
          targetEntity="organization"
          value={org.identifier}
        />
      )}

      {memberships.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {memberships.map((ms, index) => {
            const parent = ms.parent_organization;
            return (
              <li
                key={ms.id}
                data-entity-row={`memberships:${ms.id}`}
                className="hover-lift animate-list-item-in flex items-start gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-hover)] p-3"
                style={{ '--stagger-index': index } as CSSProperties}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[color:var(--text-primary)]">
                    {parent}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {parseJsonArray(ms.roles).map((role) => (
                      <StatusPill key={role} tone="info">
                        {role}
                      </StatusPill>
                    ))}
                  </div>
                  {ms.endpoint_id && (
                    <div className="mt-2">
                      <FkLink
                        label={t('membershipCardFkEndpoint')}
                        targetEntity="endpoints"
                        value={ms.endpoint_id}
                        targetKey={ms.endpoint_id}
                      />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('membershipCardEditAria', { parent })}
                    onClick={() => useModals.getState().openModal('membership-edit', ms.id)}
                    className="h-8 w-8 !px-0"
                  >
                    <Icon name="edit" size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('membershipCardDeleteAria', { parent })}
                    onClick={() => requestDelete(ms)}
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
          {t('emptyMembershipsHint')}
        </p>
      )}
    </EntityCard>
  );
}
