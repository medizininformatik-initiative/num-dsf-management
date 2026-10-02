/**
 * CertStatusPage.tsx — shown by AuthBootstrap in the cert deployment variant
 * when client-certificate sign-in cannot complete. There is no OTP fallback in
 * this variant, so this screen explains the state and offers a reload. It uses
 * the sign-in layout (glass card, environment badge); the checking state is a
 * polite status with a spinner, a failure is announced as an alert.
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

export function CertStatusPage({ code }: { code: string | null }) {
  const { t } = useI18n();
  const checking = code === null;
  const messageKey: TranslationKey = checking
    ? 'certStatusChecking'
    : (CODE_KEY[code] ?? 'certStatusGeneric');

  return (
    <AuthLayout title={t('certStatusTitle')}>
      <div className="space-y-5">
        <p
          role={checking ? 'status' : 'alert'}
          className="flex items-start gap-2 text-sm leading-6 text-[color:var(--text-secondary)]"
        >
          <Icon
            name={checking ? 'progress_activity' : 'gpp_bad'}
            size={20}
            className={`mt-0.5 shrink-0 ${checking ? 'animate-spin text-[color:var(--text-muted)]' : 'text-danger-fg'}`}
          />
          {t(messageKey)}
        </p>
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
