/**
 * EndpointsCard.tsx — entity card listing FHIR endpoints with their IP addresses. The FHIR/BPE
 * flags ("F"/"B") carry screen-reader text and a visible legend. Rows stagger in and carry
 * data-entity-row="endpoints:<identifier>" so membership foreign keys can target them; the body
 * shows a skeleton or an error with retry while the query loads or fails. Supports add/edit
 * (useModals), confirmed cross-user-guarded deletion (naming the memberships deleted with the
 * endpoint), and an IP-diff badge.
 * Dependencies: useEndpoints, useMemberships, useOrganization, confirmDelete, EntityCard,
 * FkLink, IpDiffBadge, Button, Icon.
 */
import type { CSSProperties } from 'react';
import { useEndpoints, useDeleteEndpoint } from '../../hooks/useEndpoints';
import { useMemberships } from '../../hooks/useMemberships';
import { useOrganization } from '../../hooks/useOrganization';
import { EntityCard } from './EntityCard';
import { FkLink } from './FkLink';
import { Details, DetailsToggle } from './CardDetails';
import { useCardDetails } from '../../hooks/useCardDetails';
import { useModals } from '../../hooks/useModals';
import { IpDiffBadge } from './IpDiffBadge';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import { useConfirmDelete } from '../../lib/confirmDelete';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface EndpointIpRow {
  id: string;
  ip: string;
  isFhir?: boolean;
  isBpe?: boolean;
}

interface EndpointRow {
  identifier: string;
  name?: string;
  address: string;
  ipAddresses?: EndpointIpRow[];
}

type IpFlagKind = 'fhir' | 'bpe';

const IP_FLAG: Record<IpFlagKind, { letter: string; label: TranslationKey; className: string }> = {
  fhir: {
    letter: 'F',
    label: 'endpointCardFlagFhir',
    className: 'border-info-border bg-info-surface text-info-fg',
  },
  bpe: {
    letter: 'B',
    label: 'endpointCardFlagBpe',
    className: 'border-neutral-border bg-neutral-surface text-neutral-fg',
  },
};

/** The visible flag letter; `labelled` adds the spelled-out meaning for screen readers. */
function IpFlag({ kind, labelled = true }: { kind: IpFlagKind; labelled?: boolean }) {
  const { t } = useI18n();
  const flag = IP_FLAG[kind];
  return (
    <span
      title={t(flag.label)}
      className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-small border px-0.5 text-2xs font-semibold leading-none ${flag.className}`}
    >
      <span aria-hidden="true">{flag.letter}</span>
      {labelled && <span className="sr-only">{t(flag.label)}</span>}
    </span>
  );
}

export function EndpointsCard({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useEndpoints(instanceId);
  const endpoints: EndpointRow[] = data ?? [];
  const { data: org } = useOrganization(instanceId);
  const { data: memberships = [] } = useMemberships(instanceId);
  const deleteMut = useDeleteEndpoint(instanceId);
  const confirmDelete = useConfirmDelete();
  const details = useCardDetails();

  const hasFlags = endpoints.some((ep) =>
    (ep.ipAddresses ?? []).some((ip) => ip.isFhir || ip.isBpe),
  );

  function requestDelete(ep: EndpointRow) {
    // Memberships reference the endpoint with ON DELETE CASCADE.
    const bound = memberships.filter(
      (m: { endpoint_id?: string }) => m.endpoint_id === ep.identifier,
    ).length;
    void confirmDelete({
      label: ep.name || ep.identifier,
      title: t('endpointCardDeleteTitle'),
      message: t('endpointCardDeleteMessage', {
        name: ep.name ? `${ep.name} (${ep.identifier})` : ep.identifier,
      }),
      consequence: `${
        bound === 0
          ? t('endpointCardDeleteConsequence')
          : bound === 1
            ? t('endpointCardDeleteMembershipsOne')
            : t('endpointCardDeleteMembershipsMany', { n: bound })
      } ${t('endpointDeleteWarning')}`,
      confirmLabel: t('delete'),
      remove: () => deleteMut.mutateAsync(ep.identifier),
    });
  }

  return (
    <EntityCard
      id="endpoints"
      title={t('endpoints')}
      borderColor="#3ecfb2"
      icon="hub"
      status={isLoading ? 'loading' : isError && !data ? 'error' : 'ready'}
      onRetry={() => void refetch()}
      onAdd={() => useModals.getState().openModal('endpoint-add')}
    >
      {org && (
        <FkLink
          label={t('endpointCardFkOrganization')}
          targetEntity="organization"
          value={org.identifier}
        />
      )}

      {endpoints.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {endpoints.map((ep, index) => {
            const name = ep.name || ep.identifier;
            const ips = ep.ipAddresses ?? [];
            const renderIps = (list: typeof ips) => {
              const chips = (
                <ul aria-label={t('endpointCardIpsLabel')} className="mt-2 flex flex-wrap gap-1">
                  {list.map((ip) => (
                    <li
                      key={ip.id}
                      className="inline-flex items-center gap-1 rounded-full bg-[color:var(--bg-card)] py-0.5 pl-2 pr-1 text-2xs text-[color:var(--text-secondary)]"
                    >
                      <span className="mono-id">{ip.ip}</span>
                      {ip.isFhir && <IpFlag kind="fhir" />}
                      {ip.isBpe && <IpFlag kind="bpe" />}
                    </li>
                  ))}
                </ul>
              );
              if (list.length <= 3) return chips;
              return (
                <details className="group/ips mt-1.5">
                  <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-control text-xs font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] [&::-webkit-details-marker]:hidden">
                    <Icon
                      name="chevron_right"
                      size={14}
                      className="transition-transform duration-short ease-spring group-open/ips:rotate-90"
                    />
                    {t('endpointCardIpsLabel')} ({list.length})
                  </summary>
                  {chips}
                </details>
              );
            };
            return (
              <li
                key={ep.identifier}
                data-entity-row={`endpoints:${ep.identifier}`}
                className="animate-list-item-in flex items-start gap-2 rounded-control bg-[color:var(--bg-hover)] p-3"
                style={{ '--stagger-index': index } as CSSProperties}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                    {name}
                  </p>
                  {ep.name && (
                    <p className="mono-id truncate text-xs text-[color:var(--text-muted)]">
                      {ep.identifier}
                    </p>
                  )}
                  <Details show={details.detailed}>
                    <p
                      title={ep.address}
                      className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]"
                    >
                      {ep.address}
                    </p>
                    {ips.length > 0 && renderIps(ips)}
                  </Details>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('endpointCardEditAria', { name })}
                    onClick={() => useModals.getState().openModal('endpoint-edit', ep.identifier)}
                    className="h-8 w-8 !px-0"
                  >
                    <Icon name="edit" size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('endpointCardDeleteAria', { name })}
                    onClick={() => requestDelete(ep)}
                    className="h-8 w-8 !px-0 hover:!bg-danger-surface hover:!text-danger-fg"
                  >
                    <Icon name="delete" size={18} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-4 text-center text-xs text-[color:var(--text-muted)]">
          {t('emptyEndpointsHint')}
        </p>
      )}

      <Details show={details.detailed && hasFlags}>
        {/* Visual key only: every flag already carries its meaning for screen readers. */}
        <p
          aria-hidden="true"
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-[color:var(--text-muted)]"
        >
          <span className="inline-flex items-center gap-1">
            <IpFlag kind="fhir" labelled={false} />
            {t('endpointCardFlagFhir')}
          </span>
          <span className="inline-flex items-center gap-1">
            <IpFlag kind="bpe" labelled={false} />
            {t('endpointCardFlagBpe')}
          </span>
        </p>
      </Details>
      <IpDiffBadge instanceId={instanceId} compact={!details.detailed} />
      <DetailsToggle details={details} />
    </EntityCard>
  );
}
