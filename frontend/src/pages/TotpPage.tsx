/**
 * TotpPage.tsx – Step 3b: TOTP code for subsequent logins
 * Accepts both 6-digit TOTP codes and 8-character backup codes.
 * Errors are announced (role="alert"); a rate limit (429) is reported with
 * its retry time instead of as a wrong code. A wrong code shakes the field
 * gently; success shows the check morph, then redirects to /app.
 * Dependencies: AuthLayout, auth/useSignIn, auth/authMotion, authApi (+ error
 * helpers), i18n store, Button, Icon.
 */
import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthLayout, AUTH_INPUT_CLASS } from '../components/AuthLayout';
import { useSignIn } from '../components/auth/useSignIn';
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

export function TotpPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = useSignIn();
  const inputRef = useRef<HTMLInputElement>(null);

  const { tempToken } = (location.state as { tempToken?: string } | null) || {};

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [useBackup, setUseBackup] = useState(false);

  useEffect(() => {
    if (!tempToken) navigate('/login', { replace: true });
  }, [tempToken, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().replace(/\s/g, '');
    if (!trimmed || !tempToken) return;
    setLoading(true);
    setError('');

    try {
      const res = await authApi.verifyTotp(tempToken, trimmed);
      signIn.complete(res.data.data.accessToken);
    } catch (err: unknown) {
      const wait = retryAfterSeconds(err);
      setError(
        isRateLimited(err)
          ? wait != null
            ? t('authTooManyAttempts', { time: formatWait(wait) })
            : t('authTooManyAttemptsNoTime')
          : isTransportError(err)
            ? t('loginOtpRequestFailed')
            : t('totpInvalidCode'),
      );
      setCode('');
      shakeElement(inputRef.current);
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  const required = useBackup ? 8 : 6;

  return (
    <AuthLayout
      title={t('totpTitle')}
      subtitle={useBackup ? t('totpSubtitleBackup') : t('totpSubtitleApp')}
      step={2}
      success={signIn.success ? t('authSignedIn') : undefined}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="totp-code"
            className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]"
          >
            {useBackup ? t('totpLabelBackup') : t('totpLabelApp')}
          </label>
          <input
            ref={inputRef}
            id="totp-code"
            type="text"
            inputMode={useBackup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            maxLength={required}
            autoFocus
            value={code}
            onChange={(e) =>
              setCode(useBackup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))
            }
            placeholder={useBackup ? 'XXXXXXXX' : '000000'}
            aria-invalid={error ? true : undefined}
            className={`${AUTH_INPUT_CLASS} text-center font-mono text-2xl tracking-widest`}
          />
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-danger-fg">
            <Icon name="error" size={14} className="mt-px shrink-0" />
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={loading || code.length < required}>
          {loading ? t('totpVerifying') : t('totpSignIn')}
        </Button>

        <div className="flex flex-col items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setUseBackup(!useBackup);
              setCode('');
              setError('');
            }}
          >
            {useBackup ? t('totpUseApp') : t('totpUseBackup')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
            {t('totpStartOver')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
