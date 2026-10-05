/**
 * TopBar.tsx – Canvas top bar on the chrome glass material, as tall as the
 * sidebar header (56 px): history navigation, search, theme and language
 * toggles, notifications and the instance actions with one primary CTA. The
 * product name and the environment live in the sidebar header only (no
 * duplicate title or environment badge here). The approval CTA follows the
 * active instance's latest request: while one is PENDING it is disabled and
 * reads "Waiting for approval". Fits a 1024 px wide bar: below xl the
 * download action shows its icon only.
 * Dependencies: SearchBar, NotificationCenter, Button, Icon, canvas.store,
 * useApproval, theme.store, i18n.store
 */
import { useNavigate } from 'react-router-dom';
import { SearchBar } from './SearchBar';
import { NotificationCenter } from './NotificationCenter';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
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
  const navigate = useNavigate();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const { data } = useApprovalStatus(showInstanceActions ? activeInstanceId : null);
  const approval: ApprovalStatus | null | undefined = data;
  const pending = approval?.status === 'PENDING';

  return (
    <div className="glass-chrome relative z-40 flex h-14 flex-shrink-0 items-center justify-between gap-3 px-4 xl:px-6">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="hidden px-1.5 sm:inline-flex"
          title={t('ariaGoBack')}
          aria-label={t('ariaGoBack')}
        >
          <Icon name="arrow_back" size={20} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(1)}
          className="hidden px-1.5 sm:inline-flex"
          title={t('ariaGoForward')}
          aria-label={t('ariaGoForward')}
        >
          <Icon name="arrow_forward" size={20} />
        </Button>
      </div>

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
              className="ml-1"
              title={t('downloadAllowList')}
            >
              <Icon name="download" size={16} />
              <span className="sr-only xl:not-sr-only">{t('downloadAllowList')}</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onApproval}
              disabled={pending}
              title={pending ? t('approvalPendingBlocked') : undefined}
            >
              <Icon name={pending ? 'hourglass_top' : 'send'} size={16} />
              <span className="sr-only sm:not-sr-only">
                {pending ? t('approvalWaitingLabel') : t('sendForApproval')}
              </span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
