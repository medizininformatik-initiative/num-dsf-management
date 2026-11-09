/**
 * LegalPage.tsx — Bundle-verification disclaimer + general legal notes.
 *
 * Routed at /app/legal. Linked from AppFooter; also surfaced from the
 * DownloadModal's acknowledgment checkbox. Strings live in i18n/{de,en}.ts
 * so the page tracks the active locale.
 */
import { useI18n } from '../stores/i18n.store';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';

export function LegalPage() {
  const { t } = useI18n();
  return (
    <div className="flex-1 overflow-y-auto">
      <AdminPageHeader title={t('legalPageTitle')} />
      <div className="p-6 sm:p-8">
        <section className="glass-thin space-y-4 rounded-card p-6 text-sm leading-relaxed text-[color:var(--text-secondary)]">
          <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
            {t('bundleDisclaimerHeading')}
          </h2>
          <p className="max-w-prose">{t('bundleDisclaimerBody')}</p>
        </section>
      </div>
    </div>
  );
}
