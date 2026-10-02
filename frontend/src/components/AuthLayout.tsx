/**
 * AuthLayout.tsx – Shared layout for all auth pages: the aurora background,
 * IMI logo, the dsf. wordmark with the DSF environment badge (lib/environment,
 * the same indicator as the app chrome), a thick-glass card that scales in on
 * the spring curve without overshoot, the partner logos and the Impressum.
 * Every link has a visible keyboard focus ring.
 * Exports AUTH_INPUT_CLASS, the text-field style shared by the auth pages.
 * Dependencies: lib/environment, i18n store, .auth-aurora/.dsf-wordmark/
 * .glass-thick (src/index.css).
 */
import type { ReactNode } from 'react';
import { DSF_ENVIRONMENT, ENV_ACCENT } from '../lib/environment';
import { useI18n } from '../stores/i18n.store';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

/** Text fields on the auth cards: theme surface, accent border and ring on focus. */
export const AUTH_INPUT_CLASS =
  'w-full rounded-input border border-[color:var(--border)] bg-[color:var(--bg-input)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] transition-colors duration-short ease-standard hover:border-[color:var(--border-strong)] focus:border-[color:var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-50';

const LINK_FOCUS =
  'rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--focus-ring)]';

const PARTNER_LOGO = 'opacity-70 transition-opacity duration-short ease-standard hover:opacity-100';

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  const { t } = useI18n();
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[color:var(--bg-page)] px-4 py-8 font-sans">
      {/* Animated background — aurora blobs in IMI logo palette */}
      <div className="auth-aurora" aria-hidden="true">
        <span />
      </div>

      <header className="relative z-[1] mb-6 flex animate-fade-in flex-col items-center text-center">
        {/* IMI Logo — prominent, above card */}
        <a
          href="https://www.medizin.uni-muenster.de/imi/das-institut.html"
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_FOCUS}
        >
          <img
            src="/logos/IMI-Logo-grad-eng.png"
            alt="Institute of Medical Informatics"
            className="block h-20"
          />
        </a>

        {/* App title + environment */}
        <span className="dsf-wordmark mt-6 select-none text-4xl font-extrabold tracking-tight">
          dsf.
        </span>
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className="text-[13px] text-[color:var(--text-muted)]">Allow List Management</span>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white"
            style={{ backgroundColor: ENV_ACCENT }}
          >
            {DSF_ENVIRONMENT}
          </span>
        </div>
      </header>

      {/* Card */}
      <main className="glass-thick relative z-[1] w-full max-w-md animate-scale-in rounded-2xl p-8">
        <h1 className="mb-1 text-xl font-semibold text-[color:var(--text-primary)]">{title}</h1>
        {subtitle && <p className="mb-6 text-sm text-[color:var(--text-secondary)]">{subtitle}</p>}
        {children}
      </main>

      <footer className="relative z-[1] mt-11 flex w-full max-w-[560px] animate-fade-in flex-col items-center">
        {/* Partner Logos — single row with divider */}
        <div className="mb-6 flex w-full items-center gap-3.5">
          <div className="h-px flex-1 bg-[color:var(--border)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
            {t('authPartnersLabel')}
          </span>
          <div className="h-px flex-1 bg-[color:var(--border)]" />
        </div>

        {/* Partner row — uniform heights, muted until hover */}
        <div className="flex w-full flex-wrap items-center justify-around gap-7">
          <img
            src="/logos/Logo UKM Münster.PNG"
            alt="UKM Münster"
            className={`h-10 ${PARTNER_LOGO}`}
          />
          <a
            href="https://medic.uni-muenster.de/"
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_FOCUS}
          >
            <img
              src="/logos/Logo_MeDIC_RGB_1000pxl_WEB_transp.png"
              alt="MeDIC"
              className={`h-9 ${PARTNER_LOGO}`}
            />
          </a>
          <img
            src="/logos/NUM-LOGO-POS-DE-RGB_neu.png"
            alt="NUM"
            className={`h-[34px] ${PARTNER_LOGO}`}
          />
          <img
            src="/logos/HHN_logo.png"
            alt="Hochschule Heilbronn"
            className={`h-9 ${PARTNER_LOGO}`}
          />
        </div>

        {/* Impressum + Footer */}
        <p className="mb-1 mt-6 text-[11px] text-[color:var(--text-muted)]">
          {t('footerAffiliation')}
        </p>
        <a
          href="https://medic.uni-muenster.de/impressum/"
          target="_blank"
          rel="noopener noreferrer"
          className={`text-[11px] text-[color:var(--text-muted)] underline hover:text-[color:var(--text-primary)] ${LINK_FOCUS}`}
        >
          Impressum
        </a>
      </footer>
    </div>
  );
}
