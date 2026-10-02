/**
 * IpDiffBadge.tsx – Shows the endpoint IP changes since the last approved approval request:
 * added IPs as success chips, removed ones as struck-through danger chips, each group a
 * labelled list. Renders nothing without an approved request, without a change, or for an
 * unreadable snapshot.
 * Dependencies: useApprovalHistory, useEndpoints, i18n store, Icon.
 */
import { useApprovalHistory } from '../../hooks/useApproval';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

interface Props {
  instanceId: string;
}

interface ApprovalHistoryRow {
  status: string;
  snapshot_json: unknown;
}

interface EndpointIpRow {
  ip: string;
}

interface EndpointRow {
  ipAddresses?: EndpointIpRow[];
}

const CHIP = 'mono-id rounded-md border px-2 py-0.5 text-[11px]';

export function IpDiffBadge({ instanceId }: Props) {
  const { t } = useI18n();
  const { data: history = [] } = useApprovalHistory(instanceId);
  const { data: endpoints = [] } = useEndpoints(instanceId);

  // Find last APPROVED request
  const lastApproved = history.find((r: ApprovalHistoryRow) => r.status === 'APPROVED');
  if (!lastApproved) return null;

  // Get current IPs
  const currentIps = new Set<string>();
  endpoints.forEach((ep: EndpointRow) => {
    (ep.ipAddresses || []).forEach((ip: EndpointIpRow) => currentIps.add(ip.ip));
  });

  // Get previous IPs from snapshot
  const previousIps = new Set<string>();
  try {
    const snapshot: unknown =
      typeof lastApproved.snapshot_json === 'string'
        ? JSON.parse(lastApproved.snapshot_json)
        : lastApproved.snapshot_json;
    const snapshotEndpoints = (snapshot as { endpoints?: unknown })?.endpoints;
    if (Array.isArray(snapshotEndpoints)) {
      snapshotEndpoints.forEach((ep: unknown) => {
        const ips =
          (ep as { ipAddresses?: unknown })?.ipAddresses ?? (ep as { ips?: unknown })?.ips;
        if (Array.isArray(ips)) {
          ips.forEach((ip: unknown) => {
            const value = (ip as { ip?: unknown })?.ip;
            if (typeof value === 'string') previousIps.add(value);
          });
        }
      });
    }
  } catch {
    return null;
  }

  const added = [...currentIps].filter((ip) => !previousIps.has(ip));
  const removed = [...previousIps].filter((ip) => !currentIps.has(ip));

  if (added.length === 0 && removed.length === 0) return null;

  return (
    <div className="mt-2 animate-fade-in rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-hover)] px-3.5 py-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon name="difference" size={16} className="text-warning-fg" />
        <span className="text-[11px] font-bold text-[color:var(--text-secondary)]">
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
