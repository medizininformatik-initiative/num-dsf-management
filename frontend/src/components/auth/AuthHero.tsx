/**
 * AuthHero.tsx – The brand block above the sign-in card and on the session
 * loading screen: the BrandMark ("DSF Management Tool") at hero size with the
 * product line and the DSF environment badge (lib/environment, the same
 * indicator as the app chrome). The BrandMark plays its intro once per page
 * load; later auth steps show it settled, so it does not replay per step.
 * Dependencies: layout/BrandMark, lib/environment, authMotion,
 * auth-motion.css.
 */
import { useEffect, useState } from 'react';
import { BrandMark } from '../layout/BrandMark';
import { DSF_ENVIRONMENT, ENV_ACCENT } from '../../lib/environment';
import { brandIntroPending, markBrandIntroPlayed } from './authMotion';
import './auth-motion.css';

/** Enlarges BrandMark's name line (its own class sets 13 px). */
const HERO_NAME =
  'items-start [&>span:first-child]:text-[26px] [&>span:first-child]:font-bold [&>span:first-child]:leading-tight';

export function AuthHero({ className = '' }: { className?: string }) {
  const [intro] = useState(brandIntroPending);
  useEffect(() => markBrandIntroPlayed(), []);

  return (
    <div
      className={`flex justify-center ${intro ? 'animate-auth-rise' : 'auth-brand--settled'} ${className}`}
    >
      <BrandMark size={56} className="gap-3.5" nameClassName={HERO_NAME}>
        <span className="mt-1.5 flex items-center gap-2">
          <span className="text-[13px] text-[color:var(--text-secondary)]">
            Allow List Management
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white"
            style={{ backgroundColor: ENV_ACCENT }}
          >
            {DSF_ENVIRONMENT}
          </span>
        </span>
      </BrandMark>
    </div>
  );
}
