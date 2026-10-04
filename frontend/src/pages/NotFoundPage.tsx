/**
 * NotFoundPage.tsx – 404 catch-all page
 * Dependencies: react-router-dom (Link)
 */
import { Link } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';
import { useI18n } from '../stores/i18n.store';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[color:var(--bg-page)] p-6 font-sans">
      <div className="glass flex max-w-md flex-col items-center rounded-3xl px-8 py-10 text-center">
        <Icon name="search_off" size={64} className="mb-5 text-[color:var(--text-muted)]" />
        <h1 className="mb-2 text-2xl font-semibold text-[color:var(--text-primary)]">
          {t('pageNotFound')}
        </h1>
        <p className="mb-8 text-sm text-[color:var(--text-secondary)]">{t('notFoundMessage')}</p>
        <Link to="/app" className="btn btn-primary btn-md press-effect no-underline">
          {t('notFoundBackBtn')}
        </Link>
      </div>
    </div>
  );
}
