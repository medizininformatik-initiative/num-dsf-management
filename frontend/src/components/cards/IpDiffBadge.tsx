/**
 * IpDiffBadge.tsx – Shows the endpoint IP changes since the last approved approval request:
 * added IPs as success chips, removed ones as struck-through danger chips, each group a
 * labelled list. Renders nothing without an approved request, without a change, or when the
 * approved IPs are unknown (approved_ips null).
 * Dependencies: useApprovalHistory, useEndpoints, i18n store, Icon.
 */
import { useApprovalHistory, type ApprovalRequest } from '../../hooks/useApproval';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';

interface Props {
  instanceId: string;
  /** Only a warning pill that says there are changes (the simplified view). */
  compact?: boolean;
}

interface EndpointIpRow {
  ip: string;
}

interface EndpointRow {
  ipAddresses?: EndpointIpRow[];
}

const CHIP = 'mono-id rounded-small border px-2 py-0.5 text-2xs';

export function IpDiffBadge({ instanceId, compact = false }: Props) {
  const { t } = useI18n();
  const { data: history = [] } = useApprovalHistory(instanceId);
  const { data: endpoints = [] } = useEndpoints(instanceId);

  // Find last APPROVED request
  const lastApproved = history.find((r: ApprovalRequest) => r.status === 'APPROVED');
  if (!lastApproved) return null;

  // Get current IPs
  const currentIps = new Set<string>();
  endpoints.forEach((ep: EndpointRow) => {
    (ep.ipAddresses || []).forEach((ip: EndpointIpRow) => currentIps.add(ip.ip));
  });

  // The baseline is unknown (no readable snapshot): showing a diff would be false.
  if (!lastApproved.approved_ips) return null;
  const previousIps = new Set<string>(lastApproved.approved_ips);

  const added = [...currentIps].filter((ip) => !previousIps.has(ip));
  const removed = [...previousIps].filter((ip) => !currentIps.has(ip));

  if (added.length === 0 && removed.length === 0) return null;

  if (compact) {
    return (
      <StatusPill tone="warning" icon="difference" className="mt-2 self-start">
        {t('ipDiffCompact')}
      </StatusPill>
    );
  }

  return (
    <div className="mt-2 animate-fade-in rounded-control bg-[color:var(--bg-hover)] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon name="difference" size={14} className="text-warning-fg" />
        <span className="text-xs font-semibold text-[color:var(--text-secondary)]">
          {t('ipDiffTitle')}
        </span>
      </div>
      {added.length > 0 && (
        <ul aria-label={t('ipDiffAdded')} className="mb-1 flex flex-wrap gap-1">
          {added.map((ip) => (
            <li
              key={ip}
              className={`${CHIP} border-success-border bg-success-surface text-success-fg`}
            >
              + {ip}
            </li>
          ))}
        </ul>
      )}
      {removed.length > 0 && (
        <ul aria-label={t('ipDiffRemoved')} className="flex flex-wrap gap-1">
          {removed.map((ip) => (
            <li
              key={ip}
              className={`${CHIP} border-danger-border bg-danger-surface text-danger-fg line-through`}
            >
              − {ip}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
