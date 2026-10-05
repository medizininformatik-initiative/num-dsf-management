/**
 * CertStatusPage.tsx — shown by AuthBootstrap in the cert deployment variant
 * while client-certificate sign-in runs and when it cannot complete. There is
 * no OTP fallback in this variant, so this screen explains the state and
 * offers a reload. It uses the sign-in layout (ambient background, BrandMark
 * hero, glass card). Checking: a certificate badge with expanding rings and a
 * scan line (static under Reduce Motion) above a polite status; a failure is
 * announced as an alert with a Retry button.
 * Dependencies: AuthLayout, Button, Icon, ../stores/i18n.store, ../lib/authMode
 */
import { useI18n } from '../stores/i18n.store';
import type { TranslationKey } from '../i18n/en';
import { reauthRedirect } from '../lib/authMode';
import { AuthLayout } from '../components/AuthLayout';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

const CODE_KEY: Record<string, TranslationKey> = {
  NO_CLIENT_CERT: 'certStatusNoCert',
  CERT_NOT_REGISTERED: 'certStatusNotRegistered',
  NO_INSTANCE: 'certStatusNoInstance',
  NO_USER: 'certStatusNoInstance',
  ACCOUNT_LOCKED: 'certStatusLocked',
};

/** Decorative: a certificate badge being read, rings pulsing outwards. */
function CertCheckingVisual() {
  return (
    <div className="flex justify-center py-2" aria-hidden="true" data-testid="cert-checking">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="auth-cert-ring" />
        <span className="auth-cert-ring" />
        <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[color:var(--border)] bg-[color:var(--accent-surface)]">
          <Icon name="badge" size={32} className="text-[color:var(--accent-solid)]" />
          <span className="auth-cert-scan" />
        </span>
      </div>
    </div>
  );
}

export function CertStatusPage({ code }: { code: string | null }) {
  const { t } = useI18n();
  const checking = code === null;
  const messageKey: TranslationKey = checking
    ? 'certStatusChecking'
    : (CODE_KEY[code] ?? 'certStatusGeneric');

  return (
    <AuthLayout title={t('certStatusTitle')} step={checking ? 0 : 1}>
      <div className="space-y-5">
        {checking && <CertCheckingVisual />}
        <p
          role={checking ? 'status' : 'alert'}
          className={`flex items-start gap-2 text-sm leading-6 text-[color:var(--text-secondary)] ${checking ? 'justify-center text-center' : ''}`}
        >
          {!checking && (
            <Icon name="gpp_bad" size={20} className="mt-0.5 shrink-0 text-danger-fg" />
          )}
          {t(messageKey)}
        </p>
        {checking && (
          <p className="text-center text-xs text-[color:var(--text-muted)]">
            {t('certStatusCheckingHint')}
          </p>
        )}
        {!checking && (
          <Button className="w-full" onClick={() => reauthRedirect()}>
            <Icon name="refresh" size={18} />
            {t('certStatusRetry')}
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}
