/**
 * AppFooter.tsx – Persistent footer shown across the app shell.
 * Affiliation + bundle-verification disclaimer link, and an optional trailing
 * slot (AppPage docks the canvas ActivityFeed there, so the feed never floats
 * over cards or panels).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../stores/i18n.store';

export function AppFooter({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <footer className="glass-chrome flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b-0 border-t px-6 py-2 text-[11px] text-[color:var(--text-secondary)]">
      <a
        href="https://www.medizin.uni-muenster.de/imi/das-institut.html"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center' }}
      >
        <img
          src="/logos/IMI-Logo-grad-eng.png"
          alt="IMI"
          // Size via inline style, not the height attr — Tailwind preflight's
          // `img { height: auto }` overrides the attribute and the wide logo
          // would otherwise fill the footer width.
          style={{ display: 'block', height: '16px', width: 'auto', opacity: 0.7 }}
        />
      </a>
      <span>{t('footerAffiliation')}</span>
      <span aria-hidden="true" className="hidden text-[color:var(--text-muted)] sm:inline">
        ·
      </span>
      <Link
        to="/app/legal"
        className="rounded-small text-[color:var(--text-secondary)] underline transition-colors duration-short ease-standard hover:text-[color:var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        {t('bundleDisclaimerLinkLabel')}
      </Link>
      {/* Negative block margins let a compact button sit in the padding, so
          the bar keeps its height on every route. */}
      {children && <div style={{ margin: '-5px 0 -5px auto' }}>{children}</div>}
    </footer>
  );
}
