/**
 * ActivityFeed.tsx – "Recent activity" button with a popover listing the
 * latest audit entries of the active instance: resource and operation as
 * translated labels, relative times. AppPage docks it at the end of the
 * footer bar on the canvas route, so it never overlaps the cards or the status
 * panel. The popover grows from the button on thin glass and leaves faster;
 * focus moves into it, Escape returns to the button, an outside click or
 * focus leaving closes it. Entries are fetched only while it is open.
 * Dependencies: TanStack Query, entities.api, canvas.store, i18n.store,
 * lib/dateUtils, layout/usePopover, layout/Popover, ui/Icon, ui/Button.
 */
import { useId, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/entities.api';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import { relTime } from '../../lib/dateUtils';
import { usePopover } from '../layout/usePopover';
import { PopoverPanel } from '../layout/Popover';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';

interface OperationMeta {
  icon: string;
  className: string;
  label?: TranslationKey;
}

const MUTED = 'text-[color:var(--text-muted)]';

// Audit operations and resource types as written by backend audit.service.ts.
const OPERATIONS: Record<string, OperationMeta> = {
  CREATE: { icon: 'add_circle', className: 'text-success-fg', label: 'shellOpCreate' },
  UPDATE: { icon: 'edit', className: 'text-brand-700 dark:text-brand-400', label: 'shellOpUpdate' },
  DELETE: { icon: 'remove_circle', className: 'text-danger-fg', label: 'shellOpDelete' },
  APPROVE: { icon: 'check_circle', className: 'text-success-fg', label: 'shellOpApprove' },
  REJECT: { icon: 'cancel', className: 'text-danger-fg', label: 'shellOpReject' },
  LOGIN: { icon: 'login', className: 'text-info-fg', label: 'shellOpLogin' },
  LOGOUT: { icon: 'logout', className: MUTED, label: 'shellOpLogout' },
  OTP_REQUEST: { icon: 'mail', className: MUTED, label: 'shellOpOtpRequest' },
  OTP_VERIFY: { icon: 'mark_email_read', className: 'text-info-fg', label: 'shellOpOtpVerify' },
  TOTP_SETUP: { icon: 'qr_code_2', className: 'text-info-fg', label: 'shellOpTotpSetup' },
  TOTP_VERIFY: { icon: 'password', className: 'text-info-fg', label: 'shellOpTotpVerify' },
  FAILED_LOGIN: { icon: 'gpp_bad', className: 'text-danger-fg', label: 'shellOpFailedLogin' },
};
const UNKNOWN_OPERATION: OperationMeta = { icon: 'info', className: MUTED };

const RESOURCES: Record<string, TranslationKey> = {
  ORGANIZATION: 'shellEntityOrganization',
  CONTACT: 'shellEntityContact',
  ENDPOINT: 'shellEntityEndpoint',
  CERTIFICATE: 'shellEntityCertificate',
  MEMBERSHIP: 'shellEntityMembership',
  AUTH: 'shellEntityAuth',
  APPROVAL: 'shellEntityApproval',
  MARKETPLACE: 'shellEntityMarketplace',
};

interface AuditEntry {
  id: string;
  timestamp: string;
  operation: string;
  resource_type: string;
}

export function ActivityFeed() {
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const { t } = useI18n();
  const popover = usePopover();
  const panelId = useId();
  const titleId = useId();

  const { data } = useQuery({
    queryKey: ['activity-feed', activeInstanceId],
    queryFn: async () => {
      if (!activeInstanceId) return [];
      const res = await api(activeInstanceId).getAuditLog('limit=8&page=1');
      return (res.data?.data as AuditEntry[]) || [];
    },
    enabled: !!activeInstanceId && popover.open,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const entries: AuditEntry[] = data || [];

  return (
    <div {...popover.rootProps} className="relative">
      <Button
        ref={popover.triggerRef}
        variant="ghost"
        size="sm"
        onClick={popover.toggle}
        aria-expanded={popover.open}
        aria-controls={panelId}
        className="min-h-0 gap-1.5 px-2 py-0.5"
      >
        <Icon name="history" size={16} />
        {t('recentActivity')}
      </Button>

      <PopoverPanel
        ref={popover.panelRef}
        id={panelId}
        open={popover.open}
        origin="bottom-right"
        role="region"
        aria-labelledby={titleId}
        className="bottom-full right-0 mb-2 w-[300px] overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] px-3.5 py-2.5">
          <h2 id={titleId} className="text-xs font-bold text-[color:var(--text-primary)]">
            {t('recentActivity')}
          </h2>
          <span className="text-[11px] text-[color:var(--text-muted)]">
            {t('activityEntryCount', { n: entries.length })}
          </span>
        </div>
        <div className="max-h-[260px] overflow-y-auto">
          {entries.length === 0 ? (
            <p className="px-4 py-4 text-center text-xs text-[color:var(--text-muted)]">
              {t('noActivityYet')}
            </p>
          ) : (
            <ul>
              {entries.map((log, i) => {
                const operation = OPERATIONS[log.operation] ?? UNKNOWN_OPERATION;
                const resource = RESOURCES[log.resource_type];
                return (
                  <li
                    key={log.id}
                    className="flex animate-list-item-in gap-2 border-b border-[color:var(--border)] px-3.5 py-2 last:border-b-0"
                    style={{ '--stagger-index': i } as CSSProperties}
                  >
                    <Icon
                      name={operation.icon}
                      size={16}
                      className={`mt-px shrink-0 ${operation.className}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[color:var(--text-primary)]">
                        <strong className="font-semibold">
                          {resource ? t(resource) : log.resource_type}
                        </strong>{' '}
                        {operation.label ? t(operation.label) : log.operation}
                      </p>
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        <time dateTime={log.timestamp}>{relTime(log.timestamp, t)}</time>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverPanel>
    </div>
  );
}
