/**
 * TopBar.tsx – Canvas top bar on the chrome glass material, as tall as the
 * sidebar header (56 px): search, theme and language toggles, notifications
 * and the instance actions with one primary CTA. The product name and the environment live in the sidebar header only (no
 * duplicate title or environment badge here). The approval CTA follows the
 * active instance's latest request: while one is PENDING it turns into a
 * "Request running" pill that opens the running request (with its withdraw
 * action) instead of a second submit. The download action is an accent
 * outlined button with a visible label from sm up (icon only on phones), so it
 * stays distinct from the filled submit CTA but is hard to overlook.
 * Dependencies: SearchBar, NotificationCenter, Button, Icon, canvas.store,
 * useApproval, theme.store, i18n.store
 */
import { SearchBar } from './SearchBar';
import { NotificationCenter } from './NotificationCenter';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { useApprovalStatus, type ApprovalStatus } from '../../hooks/useApproval';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import { useThemeStore } from '../../stores/theme.store';

export function TopBar({
  onDownload,
  onApproval,
  showInstanceActions = false,
}: {
  onDownload: () => void;
  onApproval: () => void;
  showInstanceActions?: boolean;
}) {
  const { t, lang, setLang } = useI18n();
  const { dark, toggleTheme } = useThemeStore();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const { data } = useApprovalStatus(showInstanceActions ? activeInstanceId : null);
  const approval: ApprovalStatus | null | undefined = data;
  const pending = approval?.status === 'PENDING';

  return (
    <div className="glass-chrome relative z-40 flex h-14 flex-shrink-0 items-center justify-between gap-3 px-4 xl:px-6">
      <div className="min-w-0" />

      {showInstanceActions && (
        <div className="hidden lg:block">
          <SearchBar />
        </div>
      )}

      <div className="flex flex-shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          className="px-1.5"
          aria-label={t('ariaToggleTheme')}
          title={dark ? t('lightMode') : t('darkMode')}
        >
          <Icon name={dark ? 'light_mode' : 'dark_mode'} size={20} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLang(lang === 'en' ? 'de' : 'en')}
          className="px-2 font-bold"
          aria-label={t('ariaToggleLanguage')}
          title={lang === 'en' ? 'Deutsch' : 'English'}
        >
          {lang.toUpperCase()}
        </Button>

        <NotificationCenter />
        {showInstanceActions && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={onDownload}
              className="ml-1 border-[color:var(--accent)] bg-[color:var(--accent-surface)] font-semibold text-[color:var(--accent)]"
              title={t('downloadAllowList')}
              data-testid="topbar-download"
            >
              <Icon name="download" size={16} />
              <span className="sr-only sm:not-sr-only">{t('downloadAllowList')}</span>
            </Button>
            {pending ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onApproval}
                title={t('approvalRunningHint')}
                aria-label={`${t('approvalRunningLabel')}: ${t('approvalRunningHint')}`}
              >
                <StatusPill tone="warning" icon="hourglass_top">
                  {t('approvalRunningLabel')}
                </StatusPill>
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={onApproval}>
                <Icon name="send" size={16} />
                <span className="sr-only sm:not-sr-only">{t('sendForApproval')}</span>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
