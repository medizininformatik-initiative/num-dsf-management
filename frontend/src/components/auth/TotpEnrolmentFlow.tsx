/**
 * TotpEnrolmentFlow.tsx – sets up the authenticator app of the signed-in user:
 * (optional intro explaining who needs TOTP and what the TAN list is) → QR code
 * with the secret as text and a field for the first code → the TAN list
 * (TanListPanel), after which onFinished runs. `currentCode` is the TOTP code
 * or TAN that authorises a re-setup of an already enrolled account.
 * A failed confirmation is explained by its backend error code (wrong code,
 * code already used, setup expired, rate limited, anything else with the code
 * for support); only an expired setup offers "Restart setup", which creates a
 * NEW secret and QR code. The code field is cleared only when the typed code
 * is spent (wrong or used), never on a network or server error.
 * Dependencies: meTotp.api, TanListPanel, Button, i18n store, lib/getErrorMessage.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { meTotpApi } from '../../api/meTotp.api';
import { getErrorCode } from '../../lib/getErrorMessage';
import { confirmErrorKind, statusOf } from '../../lib/totpConfirmError';
import { NO_AUTOFILL } from '../../lib/noAutofill';
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
  const [supportCode, setSupportCode] = useState('');
  const [canRestart, setCanRestart] = useState(false);
  const [showCauses, setShowCauses] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const [alreadyEnrolled, setAlreadyEnrolled] = useState(false);

  function clearError() {
    setError('');
    setSupportCode('');
    setCanRestart(false);
    setShowCauses(false);
    setAlreadyEnrolled(false);
  }

  async function start(restart = false) {
    setLoading(true);
    clearError();
    try {
      const setup = restart
        ? await meTotpApi.setup(currentCode, true)
        : await meTotpApi.setup(currentCode);
      setQrCodeUrl(setup.qrCodeUrl);
      setSecret(setup.secret);
      setCode('');
      setRestarted(restart);
      setStep('scan');
    } catch (err) {
      const errCode = getErrorCode(err);
      if (errCode === 'TOTP_REQUIRED' && !currentCode) {
        // Already enrolled and no code to authorise a re-setup (forced page).
        setError(t('totpEnrolAlreadyDone'));
        setAlreadyEnrolled(true);
      } else {
        setError(
          errCode === 'TOTP_INVALID' ? t('totpInvalidCodeOrTan') : t('totpEnrolStartFailed'),
        );
      }
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
    clearError();
    try {
      setTans(await meTotpApi.confirm(code));
      setStep('tans');
    } catch (err) {
      const kind = confirmErrorKind(err);
      if (kind === 'invalid') {
        setError(t('totpConfirmInvalidCode'));
        setShowCauses(true);
        setCode('');
      } else if (kind === 'used') {
        setError(t('totpConfirmCodeUsed'));
        setCode('');
      } else if (kind === 'expired') {
        setError(t('totpEnrolExpired'));
        setCanRestart(true);
      } else if (kind === 'rate') {
        setError(t('totpConfirmRateLimited'));
      } else {
        setError(t('totpConfirmGeneric'));
        setSupportCode(getErrorCode(err) ?? statusOf(err) ?? 'NETWORK');
      }
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
        {alreadyEnrolled && (
          <Link to="/app" className="block text-sm font-medium underline">
            {t('totpEnrolToApp')}
          </Link>
        )}
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
          <p className="text-center text-xs font-medium text-[color:var(--text-secondary)]">
            {restarted ? t('totpEnrolRestarted') : t('totpEnrolOldEntryHint')}
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
            {...NO_AUTOFILL}
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
      {showCauses && <Note>{t('totpConfirmInvalidHint')}</Note>}
      {supportCode && <Note>{t('totpConfirmSupportCode', { code: supportCode })}</Note>}
      {canRestart && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={loading}
          onClick={() => void start(true)}
        >
          {t('totpEnrolRestartBtn')}
        </Button>
      )}
      {qrCodeUrl && (
        <Button type="submit" className="w-full" disabled={code.length !== 6 || loading}>
          {loading ? t('totpConfirmVerifying') : t('totpConfirmCompleteBtn')}
        </Button>
      )}
    </form>
  );
}

function Note({ children }: { children: string }) {
  return <p className="text-xs text-[color:var(--text-muted)]">{children}</p>;
}

function ErrorText({ children }: { children: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-danger-fg">
      <Icon name="error" size={14} className="mt-px shrink-0" />
      {children}
    </p>
  );
}
