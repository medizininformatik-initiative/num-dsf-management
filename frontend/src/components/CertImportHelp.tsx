/**
 * CertImportHelp.tsx — collapsible help on the certificate sign-in page for a browser that
 * presented no certificate: build a .p12 from the site's DSF client certificate and key (they
 * stay on the site's machine, never uploaded), import it per browser and restart the browser.
 * Dependencies: stores/i18n.store, cards/CertificateFingerprint (CopyButton)
 */
import { useI18n } from '../stores/i18n.store';
import { CopyButton } from './cards/CertificateFingerprint';

export const P12_COMMAND =
  'openssl pkcs12 -export -legacy -in client.crt -inkey client.key -certfile ca-chain.pem -name "DSF client" -out dsf-client.p12';

export function CertImportHelp() {
  const { t } = useI18n();
  return (
    <details
      className="rounded-control border border-[color:var(--border)] p-3 text-sm text-[color:var(--text-secondary)]"
      data-testid="cert-import-help"
    >
      <summary className="cursor-pointer font-semibold text-[color:var(--text-primary)]">
        {t('certHelpSummary')}
      </summary>
      <div className="mt-3 space-y-3 leading-6">
        <p>{t('certHelpCreate')}</p>
        <div className="flex items-start gap-1">
          <code className="mono-id min-w-0 flex-1 break-all rounded-control bg-[color:var(--bg-hover)] p-2 text-xs">
            {P12_COMMAND}
          </code>
          <CopyButton
            value={P12_COMMAND}
            label={t('certHelpCopyCommand')}
            copiedMessage={t('certHelpCommandCopied')}
          />
        </div>
        <p className="text-xs text-[color:var(--text-muted)]">{t('certHelpLegacyNote')}</p>
        <p className="font-semibold text-[color:var(--text-primary)]">{t('certHelpImportTitle')}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('certHelpWindows')}</li>
          <li>{t('certHelpMac')}</li>
          <li>{t('certHelpFirefox')}</li>
          <li>{t('certHelpLinux')}</li>
        </ul>
        <p>{t('certHelpRestart')}</p>
      </div>
    </details>
  );
}
