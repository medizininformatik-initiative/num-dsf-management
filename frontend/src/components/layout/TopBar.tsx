/**
 * TopBar.tsx – Canvas top bar on the chrome glass material, as tall as the
 * sidebar header (56 px): search, theme and language toggles, notifications
 * and the instance actions with one primary CTA. The product name and the environment live in the sidebar header only (no
 * duplicate title or environment badge here). The approval CTA follows the
 * active instance's latest request: while one is PENDING it turns into a
 * "Request running" pill that opens the running request (with its withdraw
 * action) instead of a second submit. The download action is an accent
 * outlined button with a visible label from sm up (icon only on phones), so it
 * stays distinct from the filled submit CTA but is hard to overlook. While a
 * newer allow-list version exists than the site has obtained, it shimmers softly
 * and carries a red dot with a hint (nothing while loading or up to date).
 * The "Report incident" button is there on every route, for every user.
 * With nothing changed since the last approval the CTA turns secondary (still clickable).
 * Dependencies: SearchBar, NotificationCenter, ReportIncidentButton, Button,
 * Icon, canvas.store, useApproval, useAllowListFreshness, theme.store,
 * i18n.store
 */
import { SearchBar } from './SearchBar';
import { NotificationCenter } from './NotificationCenter';
import { ReportIncidentButton } from '../incidents/ReportIncidentButton';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { useApprovalStatus, type ApprovalStatus } from '../../hooks/useApproval';
import { useAllowListFreshness } from '../../hooks/useAllowListFreshness';
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
  const unchanged = approval?.changedSinceApproval === false;
  const { data: freshness } = useAllowListFreshness(showInstanceActions ? activeInstanceId : null);
  const newVersion = freshness?.outdated ? freshness.currentVersion : null;
  const nudgeHint = newVersion === null ? '' : t('allowListNewHint', { n: newVersion });

  return (
    <div className="glass-chrome relative z-40 flex h-14 flex-shrink-0 items-center justify-between gap-3 px-4 xl:px-6">
      <div className="min-w-0" />

      {showInstanceActions && (
        <div className="hidden lg:block">
          <SearchBar />
        </div>
      )}

      <div className="flex flex-shrink-0 items-center gap-1.5">
        <ReportIncidentButton />
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          className="h-8 w-8 !px-0"
          aria-label={t('ariaToggleTheme')}
          title={dark ? t('lightMode') : t('darkMode')}
        >
          <Icon name={dark ? 'light_mode' : 'dark_mode'} size={18} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLang(lang === 'en' ? 'de' : 'en')}
          className="px-2"
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
              className={`ml-1 border-[color:var(--accent)] bg-[color:var(--accent-surface)] font-semibold text-[color:var(--accent)]${
                nudgeHint ? ' download-nudge' : ''
              }`}
              title={nudgeHint || t('downloadAllowList')}
              data-testid="topbar-download"
              data-nudge={nudgeHint ? 'true' : undefined}
            >
              <Icon name="download" size={14} />
              <span className="sr-only sm:not-sr-only">{t('downloadAllowList')}</span>
              {nudgeHint && (
                <>
                  <span className="sr-only"> – {nudgeHint}</span>
                  <span
                    aria-hidden="true"
                    data-testid="topbar-download-dot"
                    className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[color:var(--bg-card)] bg-danger-fg"
                  />
                </>
              )}
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
              <Button
                variant={unchanged ? 'secondary' : 'primary'}
                size="sm"
                onClick={onApproval}
                title={unchanged ? t('approvalNoChangesHint') : undefined}
              >
                <Icon name="send" size={14} />
                <span className="sr-only sm:not-sr-only">{t('sendForApproval')}</span>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
