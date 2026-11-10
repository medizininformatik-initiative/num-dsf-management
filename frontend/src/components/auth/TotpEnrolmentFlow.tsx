/**
 * TotpEnrolmentFlow.tsx – sets up the authenticator app of the signed-in user:
 * (optional intro explaining who needs TOTP and what the TAN list is) → QR code
 * with the secret as text and a field for the first code → the TAN list
 * (TanListPanel), after which onFinished runs. `currentCode` is the TOTP code
 * or TAN that authorises a re-setup of an already enrolled account.
 * Dependencies: meTotp.api, TanListPanel, Button, i18n store, lib/getErrorMessage.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { meTotpApi } from '../../api/meTotp.api';
import { getErrorCode } from '../../lib/getErrorMessage';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { AUTH_INPUT_CLASS } from '../AuthLayout';
import { TanListPanel } from './TanListPanel';

interface TotpEnrolmentFlowProps {
  /** Show the explanation (who needs TOTP, what the TAN list is) before the start button. */
  showIntro?: boolean;
  /** TOTP code or TAN that authorises replacing the secret of an enrolled account. */
  currentCode?: string;
  email?: string;
  continueLabel: string;
  onFinished: () => void;
}

export function TotpEnrolmentFlow({
  showIntro = false,
  currentCode,
  email,
  continueLabel,
  onFinished,
}: TotpEnrolmentFlowProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<'intro' | 'scan' | 'tans'>(showIntro ? 'intro' : 'scan');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [tans, setTans] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setLoading(true);
    setError('');
    try {
      const setup = await meTotpApi.setup(currentCode);
      setQrCodeUrl(setup.qrCodeUrl);
      setSecret(setup.secret);
      setStep('scan');
    } catch (err) {
      setError(
        getErrorCode(err) === 'TOTP_INVALID'
          ? t('totpInvalidCodeOrTan')
          : t('totpEnrolStartFailed'),
      );
    } finally {
      setLoading(false);
    }
  }

  // Without an intro the setup starts as soon as the flow is shown.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (showIntro || autoStarted.current) return;
    autoStarted.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showIntro]);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      setTans(await meTotpApi.confirm(code));
      setStep('tans');
    } catch {
      setError(t('totpConfirmInvalidCode'));
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'tans')
    return (
      <TanListPanel
        codes={tans}
        email={email}
        continueLabel={continueLabel}
        onContinue={onFinished}
      />
    );

  if (step === 'intro')
    return (
      <div className="space-y-4">
        <p className="text-sm text-[color:var(--text-secondary)]">{t('totpEnrolWhoWhat')}</p>
        <p className="text-sm text-[color:var(--text-secondary)]">{t('totpEnrolTanIntro')}</p>
        {error && <ErrorText>{error}</ErrorText>}
        <Button className="w-full" disabled={loading} onClick={() => void start()}>
          {t('totpEnrolStartBtn')}
        </Button>
      </div>
    );

  return (
    <form onSubmit={confirm} className="space-y-4">
      {loading && !qrCodeUrl && (
        <p role="status" className="py-8 text-center text-sm text-[color:var(--text-muted)]">
          {t('totpSetupLoadingQr')}
        </p>
      )}
      {qrCodeUrl && (
        <div className="flex flex-col items-center gap-3">
          {/* Always white: authenticator apps need a light quiet zone around the code. */}
          <div
            className="rounded-control border border-[color:var(--border)] p-3"
            style={{ background: '#fff' }}
          >
            <img src={qrCodeUrl} alt={t('totpSetupQrAlt')} width={180} height={180} />
          </div>
          <p className="text-center text-xs text-[color:var(--text-muted)]">
            {t('totpEnrolSecretLabel')}{' '}
            <code className="font-mono text-[color:var(--text-primary)]">{secret}</code>
          </p>
          <p className="text-center text-xs text-[color:var(--text-muted)]">
            {t('totpSetupQrHint')}
          </p>
        </div>
      )}
      {qrCodeUrl && (
        <div>
          <label
            htmlFor="totp-enrol-code"
            className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]"
          >
            {t('totpConfirmLabel')}
          </label>
          <input
            id="totp-enrol-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            aria-invalid={error ? true : undefined}
            className={`${AUTH_INPUT_CLASS} text-center font-mono text-2xl tracking-widest`}
          />
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {qrCodeUrl && (
        <Button type="submit" className="w-full" disabled={code.length !== 6 || loading}>
          {loading ? t('totpConfirmVerifying') : t('totpConfirmCompleteBtn')}
        </Button>
      )}
    </form>
  );
}

function ErrorText({ children }: { children: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-danger-fg">
      <Icon name="error" size={14} className="mt-px shrink-0" />
      {children}
    </p>
  );
}
