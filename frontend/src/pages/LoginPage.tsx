/**
 * LoginPage.tsx – Step 1: Enter email address
 * Checks against backend whitelist. Always gives generic feedback.
 * On success: navigate to /otp with email in router state.
 * Errors are announced (role="alert"); the client-certificate sign-in is the
 * secondary action below.
 * Dependencies: AuthLayout, authApi, auth store, i18n store, Button, Icon.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { AuthLayout, AUTH_INPUT_CLASS } from '../components/AuthLayout';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../stores/auth.store';
import { useI18n } from '../stores/i18n.store';
import { getErrorMessage } from '../lib/getErrorMessage';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

function FormError({ children }: { children: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-danger-fg">
      <Icon name="error" size={16} className="shrink-0" />
      {children}
    </p>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [certLoading, setCertLoading] = useState(false);
  const [certError, setCertError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');

    try {
      await authApi.requestOtp(email.trim().toLowerCase());
      navigate('/otp', { state: { email: email.trim().toLowerCase() } });
    } catch (err: unknown) {
      // No-enumeration: a whitelisted or non-whitelisted email both return 200
      // and proceed to /otp. Only a genuine transport failure (no response) or
      // a 5xx means the request never reached/was processed by the server —
      // surface that and stay on the page. Any other server response navigates.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const transportOrServerError = status == null || status >= 500;
      if (transportOrServerError) {
        setError(getErrorMessage(err, t('loginOtpRequestFailed')));
      } else {
        navigate('/otp', { state: { email: email.trim().toLowerCase() } });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCertLogin() {
    setCertLoading(true);
    setCertError('');
    try {
      const res = await authApi.clientCertLogin();
      const { accessToken } = res.data.data;
      const decoded = jwtDecode<{ sub: string; email: string }>(accessToken);
      setTokens(accessToken, { id: decoded.sub, email: decoded.email });
      navigate('/app', { replace: true });
    } catch (err: unknown) {
      setCertError(getErrorMessage(err, t('loginCertFailed')));
    } finally {
      setCertLoading(false);
    }
  }

  return (
    <AuthLayout title={t('signIn')} subtitle={t('loginSubtitle')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]"
          >
            {t('loginEmailLabel')}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('loginEmailPlaceholder')}
            className={AUTH_INPUT_CLASS}
          />
        </div>

        {error && <FormError>{error}</FormError>}

        <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
          {loading ? t('loginSendingBtn') : t('loginSendBtn')}
        </Button>
      </form>

      <div className="mt-5 space-y-2 border-t border-[color:var(--border)] pt-4">
        <p className="text-center text-xs text-[color:var(--text-muted)]">{t('loginCertHint')}</p>
        {certError && <FormError>{certError}</FormError>}
        <Button
          variant="secondary"
          className="w-full"
          disabled={certLoading}
          onClick={handleCertLogin}
        >
          <Icon name="badge" size={18} />
          {certLoading ? t('loginCertSigningIn') : t('loginCertBtn')}
        </Button>
      </div>
    </AuthLayout>
  );
}
