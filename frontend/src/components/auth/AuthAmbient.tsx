/**
 * AuthAmbient.tsx – The sign-in screens' ambient background: four large,
 * soft IMI-gradient blobs (magenta, violet, blue, green) drifting slowly
 * behind a calm centre veil. Transform-only animation (GPU-composited), paused
 * while the tab is hidden, static under Reduce Motion. A negative animation
 * delay from the shared time base keeps the drift continuous when the next
 * auth route mounts a fresh copy. Decorative (aria-hidden).
 * Dependencies: authMotion, auth-motion.css.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ambientElapsedS } from './authMotion';
import './auth-motion.css';

const BLOBS = ['magenta', 'violet', 'blue', 'green'] as const;

export function AuthAmbient() {
  const ref = useRef<HTMLDivElement>(null);
  const [offset] = useState(
    () => ({ '--auth-ambient-t': `-${ambientElapsedS()}s` }) as CSSProperties,
  );

  useEffect(() => {
    const sync = () => {
      const el = ref.current;
      if (!el) return;
      if (document.hidden) el.setAttribute('data-paused', '');
      else el.removeAttribute('data-paused');
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return (
    <div
      ref={ref}
      className="auth-ambient"
      style={offset}
      aria-hidden="true"
      data-testid="auth-ambient"
    >
      {BLOBS.map((b) => (
        <span key={b} className={`auth-ambient__blob auth-ambient__blob--${b}`} />
      ))}
      <span className="auth-ambient__veil" />
    </div>
  );
}
