/**
 * OtpPage.tsx – Step 2: Enter 6-digit OTP code
 * Email from router state. Auto-submit when 6 digits entered.
 * requiresTotpSetup=true → /totp-setup, else → /totp
 * Resending is possible after a countdown (a code was just sent); failures are
 * reported as they are, a rate limit (429) with its retry time, which then
 * drives the countdown. Errors are announced (role="alert").
 * Motion: the digit boxes pop in one after another; a rejected code shakes
 * the row gently and marks the boxes invalid (the shake is skipped under
 * Reduce Motion, the marking stays).
 * Dependencies: AuthLayout, auth/authMotion, authApi (+ error helpers),
 * i18n store, Button, Icon.
 */
import {
  useState,
  useRef,
  useEffect,
  type CSSProperties,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { shakeElement } from '../components/auth/authMotion';
import {
  authApi,
  formatWait,
  isRateLimited,
  isTransportError,
  retryAfterSeconds,
} from '../api/auth.api';
import { useI18n } from '../stores/i18n.store';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

/** Seconds before another code may be requested. */
export const RESEND_COOLDOWN_S = 30;

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function OtpPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email || '';

  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // The login page has just sent a code, so the first resend waits too.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!email) navigate('/login', { replace: true });
    inputRefs.current[0]?.focus();
  }, [email, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function handleDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError('');

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    if (next.every(Boolean)) {
      submitCode(next.join(''));
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(''));
      submitCode(pasted);
    }
  }

  async function submitCode(code: string) {
    setLoading(true);
    setError('');
    try {
      const res = await authApi.verifyOtp(email, code);
      const { tempToken, requiresTotpSetup } = res.data.data;
      if (requiresTotpSetup) {
        navigate('/totp-setup', { state: { tempToken, email } });
      } else {
        navigate('/totp', { state: { tempToken, email } });
      }
    } catch (err: unknown) {
      const wait = retryAfterSeconds(err);
      setError(
        isRateLimited(err)
          ? wait != null
            ? t('authTooManyAttempts', { time: formatWait(wait) })
            : t('authTooManyAttemptsNoTime')
          : isTransportError(err)
            ? t('loginOtpRequestFailed')
            : t('otpInvalidCode'),
      );
      setDigits(Array(6).fill(''));
      shakeElement(groupRef.current);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setNotice(null);
    try {
      await authApi.requestOtp(email);
      setNotice({ tone: 'success', text: t('otpResent') });
      setCooldown(RESEND_COOLDOWN_S);
      setDigits(Array(6).fill(''));
      inputRefs.current[0]?.focus();
    } catch (err: unknown) {
      if (isRateLimited(err)) {
        const wait = retryAfterSeconds(err);
        setNotice({
          tone: 'error',
          text:
            wait != null
              ? t('otpResendRateLimited', { time: formatWait(wait) })
              : t('otpResendRateLimitedNoTime'),
        });
        setCooldown(wait ?? RESEND_COOLDOWN_S);
      } else {
        setNotice({ tone: 'error', text: t('otpResendFailed') });
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout title={t('otpTitle')} subtitle={t('otpSubtitle', { email })} step={1}>
      <div className="space-y-5">
        {/* 6 Digit-Inputs */}
        <div
          ref={groupRef}
          className="flex justify-between gap-2"
          role="group"
          aria-label={t('otpCodeAria')}
          onPaste={handlePaste}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              aria-label={t('otpDigitAria', { n: i + 1 })}
              value={d}
              onChange={(e) => handleDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={loading}
              aria-invalid={error ? true : undefined}
              style={{ '--stagger-index': i } as CSSProperties}
              className={`animate-auth-digit-in h-14 w-12 rounded-input border-[1.5px] text-center text-xl font-semibold text-[color:var(--text-primary)] transition-colors duration-short ease-standard focus:border-[color:var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-50 ${
                d
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-surface)]'
                  : error
                    ? 'border-danger-border bg-[color:var(--bg-input)]'
                    : 'border-[color:var(--border)] bg-[color:var(--bg-input)]'
              }`}
            />
          ))}
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start justify-center gap-1.5 text-xs text-danger-fg"
          >
            <Icon name="error" size={16} className="shrink-0" />
            {error}
          </p>
        )}

        {loading && (
          <p role="status" className="text-center text-xs text-[color:var(--text-muted)]">
            {t('otpVerifying')}
          </p>
        )}

        {/* Resend */}
        <div className="flex flex-col items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResend}
            disabled={cooldown > 0 || resending}
            className="tabular-nums"
          >
            {resending
              ? t('otpResending')
              : cooldown > 0
                ? t('otpResendIn', { time: formatCountdown(cooldown) })
                : t('otpResend')}
          </Button>
          {notice && (
            <p
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={`text-center text-xs ${notice.tone === 'error' ? 'text-danger-fg' : 'text-success-fg'}`}
            >
              {notice.text}
            </p>
          )}
        </div>

        {/* Back */}
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
            {t('otpDifferentEmail')}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
