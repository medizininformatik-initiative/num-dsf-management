/**
 * TotpSetupPage.tsx – Step 3a: TOTP setup on very first login
 * Shows QR code to scan with authenticator app.
 * After confirmation: show backup codes + continue to AppPage.
 * The backup codes are never shown again, so they can be copied or downloaded
 * as a .txt file, and Continue stays disabled until the user confirms they
 * stored them. Errors are announced (role="alert").
 * Dependencies: AuthLayout, authApi, auth store, i18n store, lib/environment,
 * lib/dateUtils, Button, Icon, sonner.
 */
import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { toast } from 'sonner';
import { AuthLayout, AUTH_INPUT_CLASS } from '../components/AuthLayout';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../stores/auth.store';
import { useI18n } from '../stores/i18n.store';
import { DSF_ENVIRONMENT } from '../lib/environment';
import { formatDateTime } from '../lib/dateUtils';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

export const BACKUP_CODES_FILENAME = 'dsf-backup-codes.txt';

function ErrorText({ children, center }: { children: string; center?: boolean }) {
  return (
    <p
      role="alert"
      className={`flex items-start gap-1.5 text-xs text-danger-fg ${center ? 'justify-center' : ''}`}
    >
      <Icon name="error" size={16} className="shrink-0" />
      {children}
    </p>
  );
}

export function TotpSetupPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const setTokens = useAuthStore((s) => s.setTokens);

  const { tempToken, email } =
    (location.state as { tempToken?: string; email?: string } | null) || {};

  const [step, setStep] = useState<'qr' | 'confirm' | 'backup'>('qr');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [stored, setStored] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tempToken) {
      navigate('/login', { replace: true });
      return;
    }
    setLoading(true);
    authApi
      .setupTotp(tempToken)
      .then((res) => {
        setQrCodeUrl(res.data.data.qrCodeUrl);
        setStep('qr');
      })
      .catch(() => setError(t('totpSetupSessionExpired')))
      .finally(() => setLoading(false));
  }, [tempToken, navigate, t]);

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || !tempToken) return;
    setLoading(true);
    setError('');
    try {
      const res = await authApi.confirmTotp(tempToken, code);
      const { accessToken, backupCodes: codes } = res.data.data;
      setBackupCodes(codes);
      const decoded = jwtDecode<{ sub: string; email: string }>(accessToken);
      setTokens(accessToken, { id: decoded.sub, email: decoded.email });
      setStep('backup');
    } catch {
      setError(t('totpConfirmInvalidCode'));
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success(t('totpBackupCopied'));
    } catch {
      toast.error(t('totpBackupCopyFailed'));
    }
  }

  function downloadCodes() {
    const lines = [t('totpBackupFileTitle', { env: DSF_ENVIRONMENT })];
    if (email) lines.push(t('totpBackupFileAccount', { email }));
    lines.push(
      t('totpBackupFileCreated', { date: formatDateTime(new Date().toISOString(), lang) }),
      '',
      ...backupCodes,
      '',
      t('totpBackupFileNote'),
    );
    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = BACKUP_CODES_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser a moment to start the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // QR code step
  if (step === 'qr')
    return (
      <AuthLayout title={t('totpSetupTitle')} subtitle={t('totpSetupSubtitle')}>
        <div className="space-y-5">
          {loading && (
            <p role="status" className="py-8 text-center text-sm text-[color:var(--text-muted)]">
              {t('totpSetupLoadingQr')}
            </p>
          )}
          {qrCodeUrl && (
            <div className="flex flex-col items-center gap-4">
              {/* Always white: authenticator apps need a light quiet zone around the code. */}
              <div
                className="animate-scale-in rounded-xl border border-[color:var(--border)] p-3"
                style={{ background: '#fff' }}
              >
                <img src={qrCodeUrl} alt={t('totpSetupQrAlt')} width={200} height={200} />
              </div>
              <p className="text-center text-xs text-[color:var(--text-muted)]">
                {t('totpSetupQrHint')}
              </p>
              <Button className="w-full" onClick={() => setStep('confirm')}>
                {t('totpSetupScannedBtn')}
              </Button>
            </div>
          )}
          {error && <ErrorText center>{error}</ErrorText>}
        </div>
      </AuthLayout>
    );

  // TOTP confirm step
  if (step === 'confirm')
    return (
      <AuthLayout title={t('totpConfirmTitle')} subtitle={t('totpConfirmSubtitle')}>
        <form onSubmit={handleConfirm} className="space-y-4">
          <div>
            <label
              htmlFor="totp-setup-code"
              className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]"
            >
              {t('totpConfirmLabel')}
            </label>
            <input
              id="totp-setup-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className={`${AUTH_INPUT_CLASS} text-center font-mono text-2xl tracking-widest`}
            />
          </div>

          {error && <ErrorText>{error}</ErrorText>}

          <Button type="submit" className="w-full" disabled={code.length !== 6 || loading}>
            {loading ? t('totpConfirmVerifying') : t('totpConfirmCompleteBtn')}
          </Button>

          <div className="text-center">
            <Button variant="ghost" size="sm" onClick={() => setStep('qr')}>
              {t('totpConfirmBackToQr')}
            </Button>
          </div>
        </form>
      </AuthLayout>
    );

  // Backup codes step
  return (
    <AuthLayout title={t('totpBackupTitle')} subtitle={t('totpBackupSubtitle')}>
      <div className="space-y-5">
        <ul
          aria-label={t('totpBackupCodesAria')}
          className="grid grid-cols-2 gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-hover)] p-4"
        >
          {backupCodes.map((c, i) => (
            <li key={i}>
              <code className="block rounded-md border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2 py-1 text-center font-mono text-sm tracking-widest text-[color:var(--text-primary)]">
                {c}
              </code>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={copyCodes}>
            <Icon name="content_copy" size={16} />
            {t('totpBackupCopyAll')}
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" onClick={downloadCodes}>
            <Icon name="download" size={16} />
            {t('totpBackupDownload')}
          </Button>
        </div>

        <div className="flex gap-2 rounded-lg border border-warning-border bg-warning-surface p-3 text-xs text-warning-fg">
          <Icon name="warning" size={18} className="shrink-0" />
          <p>{t('totpBackupWarning')}</p>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[color:var(--text-primary)]">
          <input
            type="checkbox"
            checked={stored}
            onChange={(e) => setStored(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
          />
          {t('totpBackupStoredConfirm')}
        </label>

        <Button
          className="w-full"
          disabled={!stored}
          onClick={() => navigate('/app', { replace: true })}
        >
          {t('totpBackupContinueBtn')}
        </Button>
      </div>
    </AuthLayout>
  );
}
