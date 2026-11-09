/**
 * AuthLayout.tsx – Shared layout for all sign-in screens: the drifting
 * IMI-gradient ambient background, the BrandMark hero with the environment
 * badge, a thick-glass card and a calm footer (IMI and partner logos, the
 * Impressum). Every link has a visible keyboard focus ring.
 * Motion: the first card of a page load enters on the bouncy spring; every
 * later step keeps the card and slides its content in reading direction
 * (forward from the end side, back from the start side) while the card's
 * height animates from the previous step's height. `step` orders the screens
 * (email 0, code 1, TOTP 2+); `success` swaps the content for the check
 * morph. Under Reduce Motion all of it is a plain crossfade.
 * Exports AUTH_INPUT_CLASS, the text-field style shared by the auth pages.
 * Dependencies: auth/AuthAmbient, auth/AuthHero, auth/AuthSuccess,
 * auth/authMotion, i18n store, .glass-thick (src/index.css).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../stores/i18n.store';
import { AuthAmbient } from './auth/AuthAmbient';
import { AuthHero } from './auth/AuthHero';
import { AuthSuccess } from './auth/AuthSuccess';
import {
  directionFor,
  previousCardHeight,
  rememberCardHeight,
  rememberStep,
  type StepDirection,
} from './auth/authMotion';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Position of this screen in the sign-in flow; drives the slide direction. */
  step?: number;
  /** When set, the card shows the success check with this message. */
  success?: string;
}

/** Text fields on the auth cards: theme surface, accent border and ring on focus. */
export const AUTH_INPUT_CLASS =
  'w-full rounded-input border border-[color:var(--border)] bg-[color:var(--bg-input)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] transition-colors duration-short ease-standard hover:border-[color:var(--border-strong)] focus:border-[color:var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus-ring)] aria-[invalid=true]:border-danger-border disabled:opacity-50';

const LINK_FOCUS =
  'rounded-small focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--focus-ring)]';

const PARTNER_LOGO =
  'opacity-60 grayscale transition-[opacity,filter] duration-short ease-standard hover:opacity-100 hover:grayscale-0';

const STEP_CLASS: Record<StepDirection, string> = {
  intro: '',
  forward: 'animate-auth-step-forward',
  back: 'animate-auth-step-back',
};

/** Card height follows its content, starting from the previous step's height. */
function useCardHeight() {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(previousCardHeight);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      setHeight(undefined);
      return;
    }
    const measure = () => {
      const h = el.offsetHeight;
      if (h <= 0) return;
      rememberCardHeight(h);
      setHeight(h);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { innerRef, height };
}

export function AuthLayout({ children, title, subtitle, step = 0, success }: AuthLayoutProps) {
  const { t } = useI18n();
  const [view, setView] = useState(() => ({ step, dir: directionFor(step) }));
  // Same instance, new step (TotpSetupPage switches steps without a route).
  if (view.step !== step) setView({ step, dir: step >= view.step ? 'forward' : 'back' });
  const [cardIntro] = useState(() => view.dir === 'intro');
  const { innerRef, height } = useCardHeight();

  useEffect(() => rememberStep(step), [step]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[color:var(--bg-page)] px-4 py-10 font-sans">
      <AuthAmbient />

      <header className="relative z-[1] mb-8">
        <AuthHero />
      </header>

      <main
        className={`glass-thick auth-card relative z-[1] w-full max-w-md rounded-card ${cardIntro ? 'animate-auth-card-in' : ''}`}
        style={height !== undefined ? { height } : undefined}
      >
        <div ref={innerRef} className="p-8">
          <div key={success ? 'success' : view.step} className={STEP_CLASS[view.dir]}>
            {success ? (
              <AuthSuccess message={success} />
            ) : (
              <>
                <h1 className="mb-1 text-xl font-semibold text-[color:var(--text-primary)]">
                  {title}
                </h1>
                {subtitle && (
                  <p className="mb-6 text-sm text-[color:var(--text-secondary)]">{subtitle}</p>
                )}
                {children}
              </>
            )}
          </div>
        </div>
      </main>

      <footer
        className={`relative z-[1] mt-12 flex w-full max-w-[560px] flex-col items-center ${cardIntro ? 'animate-auth-rise' : ''}`}
        style={{ ['--auth-delay' as string]: '320ms' }}
      >
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
          {t('authPartnersLabel')}
        </p>

        {/* One calm row: IMI first, partners small and muted until hover. */}
        <div className="flex w-full flex-wrap items-center justify-center gap-x-7 gap-y-4">
          <a
            href="https://www.medizin.uni-muenster.de/imi/das-institut.html"
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_FOCUS}
          >
            <img
              src="/logos/IMI-Logo-grad-eng.png"
              alt="Institute of Medical Informatics"
              className="block h-9 opacity-90 transition-opacity duration-short ease-standard hover:opacity-100"
            />
          </a>
          <img
            src="/logos/Logo UKM Münster.PNG"
            alt="UKM Münster"
            className={`h-7 ${PARTNER_LOGO}`}
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
              className={`h-6 ${PARTNER_LOGO}`}
            />
          </a>
          <img
            src="/logos/NUM-LOGO-POS-DE-RGB_neu.png"
            alt="NUM"
            className={`h-6 ${PARTNER_LOGO}`}
          />
          <img
            src="/logos/HHN_logo.png"
            alt="Hochschule Heilbronn"
            className={`h-6 ${PARTNER_LOGO}`}
          />
        </div>

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
