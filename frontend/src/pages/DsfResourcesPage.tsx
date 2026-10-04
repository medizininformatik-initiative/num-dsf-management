/**
 * DsfResourcesPage.tsx — static reference page linking to the official DSF
 * resources on dsf.dev. Visible to all authenticated users. Every link is
 * external and opens in a new tab.
 * Dependencies: ../stores/i18n.store, ../lib/dsfResources
 */
import { useI18n } from '../stores/i18n.store';
import { Icon } from '../components/ui/Icon';
import { DSF_RESOURCES } from '../lib/dsfResources';

export function DsfResourcesPage() {
  const { t } = useI18n();

  return (
    <div className="flex-1 overflow-y-auto p-8 font-sans">
      <div className="mb-2 flex items-center gap-3">
        <Icon name="menu_book" size={28} className="text-[color:var(--primary)]" />
        <div>
          <h1 className="m-0 text-[22px] font-bold text-[color:var(--text-primary)]">
            {t('dsfResourcesTitle')}
          </h1>
          <p className="mt-0.5 text-[13px] text-[color:var(--text-secondary)]">
            {t('dsfResourcesSubtitle')}
          </p>
        </div>
      </div>

      <div className="my-5 h-px bg-[color:var(--border)]" />

      <p className="mb-6 text-[13px] text-[color:var(--text-secondary)]">
        {t('dsfResourcesIntro')}
      </p>

      {DSF_RESOURCES.map((cat) => (
        <section key={cat.headingKey} className="mb-7">
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[color:var(--text-primary)]">
            <span
              aria-hidden="true"
              className="h-[18px] w-1 rounded-sm bg-[color:var(--primary)]"
            />
            {t(cat.headingKey)}
          </h2>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]">
            {cat.links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-thin hover-lift press-effect flex items-center gap-3 rounded-xl px-3.5 py-3 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px] font-semibold text-[color:var(--text-primary)]">
                    {link.title}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[color:var(--text-secondary)]">
                    {t(link.descKey)}
                  </p>
                </div>
                <Icon
                  name="open_in_new"
                  size={18}
                  className="shrink-0 text-[color:var(--text-muted)]"
                />
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
