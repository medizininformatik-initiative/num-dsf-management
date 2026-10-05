/**
 * AuthSuccess.tsx – The success state of a sign-in step: a gradient ring
 * draws itself, the check mark follows and the badge pops on the bouncy
 * spring; the message is a polite status. AuthCheck is also used inline
 * (e.g. "two-factor authentication is active" above the backup codes).
 * Under Reduce Motion the drawing becomes a crossfade.
 * Dependencies: auth-motion.css, --tone-success-fg / --brand-* tokens.
 */
import { useId } from 'react';
import './auth-motion.css';

export function AuthCheck({ size = 72 }: { size?: number }) {
  const id = `auth-check-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className="animate-auth-success-in shrink-0"
      data-testid="auth-check"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--brand-violet)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-green)' }} />
        </linearGradient>
      </defs>
      <circle
        className="auth-check-circle"
        cx="24"
        cy="24"
        r="21"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="3"
        pathLength={1}
        transform="rotate(-90 24 24)"
      />
      <path
        className="auth-check-mark"
        d="M14.5 24.5 L21 31 L34 17.5"
        fill="none"
        stroke="var(--tone-success-fg)"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

export function AuthSuccess({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <AuthCheck />
      <p role="status" className="m-0 text-base font-semibold text-[color:var(--text-primary)]">
        {message}
      </p>
    </div>
  );
}
