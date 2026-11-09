/**
 * NotificationCenter.tsx – Bell button with the unread count and a popover
 * listing the notification history (newest first). The popover grows from the
 * bell on thin glass and leaves faster; focus moves into it on open, Escape
 * returns to the bell, an outside click or focus leaving closes it.
 * Dependencies: notification.store, i18n.store, lib/dateUtils, usePopover,
 * PopoverPanel, ui/Icon, ui/Button.
 */
import { useId, type CSSProperties } from 'react';
import { useNotificationStore } from '../../stores/notification.store';
import { useI18n } from '../../stores/i18n.store';
import { relTime } from '../../lib/dateUtils';
import { usePopover } from './usePopover';
import { PopoverPanel } from './Popover';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';

const TYPE_ICON: Record<string, { icon: string; className: string }> = {
  success: { icon: 'check_circle', className: 'text-success-fg' },
  error: { icon: 'error', className: 'text-danger-fg' },
  info: { icon: 'info', className: 'text-info-fg' },
};

export function NotificationCenter() {
  const { notifications, unread, markAllRead, clear } = useNotificationStore();
  const { t } = useI18n();
  const popover = usePopover();
  const panelId = useId();
  const titleId = useId();

  function handleToggle() {
    if (!popover.open) markAllRead();
    popover.toggle();
  }

  return (
    <div {...popover.rootProps} className="relative">
      <button
        ref={popover.triggerRef}
        type="button"
        onClick={handleToggle}
        aria-label={
          unread > 0 ? t('shellNotificationsUnread', { n: unread }) : t('ariaNotifications')
        }
        aria-expanded={popover.open}
        aria-controls={panelId}
        className="press-effect relative rounded-control p-1.5 text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon name="notifications" size={20} className="block" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-700 px-1 text-[11px] font-bold leading-none text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <PopoverPanel
        ref={popover.panelRef}
        id={panelId}
        open={popover.open}
        origin="top-right"
        role="region"
        aria-labelledby={titleId}
        className="right-0 top-full mt-2 w-80 overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] py-2 pl-4 pr-2">
          <h2 id={titleId} className="text-[13px] font-bold text-[color:var(--text-primary)]">
            {t('notifications')}
          </h2>
          {notifications.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              aria-label={t('ariaClearNotifications')}
              className="min-h-0 px-2 py-1 text-[11px]"
            >
              {t('clearAll')}
            </Button>
          )}
        </div>
        <div className="max-h-[340px] overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-6 py-6 text-center text-xs text-[color:var(--text-muted)]">
              {t('noNotificationsYet')}
            </p>
          ) : (
            <ul>
              {notifications.map((n, i) => {
                const { icon, className } = TYPE_ICON[n.type] ?? TYPE_ICON.info;
                return (
                  <li
                    key={n.id}
                    className="flex animate-list-item-in gap-2.5 border-b border-[color:var(--border)] px-4 py-2.5 last:border-b-0"
                    style={{ '--stagger-index': i } as CSSProperties}
                  >
                    <Icon name={icon} size={18} className={`mt-px shrink-0 ${className}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-snug text-[color:var(--text-primary)]">
                        {n.message}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
                        {relTime(new Date(n.timestamp).toISOString(), t)}
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
