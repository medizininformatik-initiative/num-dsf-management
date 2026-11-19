/**
 * PurgeAllowListSection.tsx — the "danger zone" of the download dialog: deletes the whole allow
 * list from the site's own DSF FHIR server (GET /fhir/Bundle/<endpoint>/purge returns only
 * conditional DELETEs). It is visually apart from the normal download, explains the consequences
 * and shows the purge URL and a curl command only after the user typed the endpoint identifier.
 * Dependencies: Button, Icon, i18n store.
 */
import { useId, useState } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useI18n } from '../../stores/i18n.store';

interface Props {
  /** Identifier of the selected endpoint: the phrase to type, and part of the URL. */
  endpointId: string;
  /** https://<portal>/fhir/Bundle/<endpoint>/purge */
  purgeUrl: string;
  onCopy: (text: string) => void;
}

const codeBox =
  'min-w-0 flex-1 break-all rounded-control border border-danger-border bg-[color:var(--bg-card)] px-3 py-2 font-mono text-2xs text-[color:var(--text-primary)]';

export function PurgeAllowListSection({ endpointId, purgeUrl, onCopy }: Props) {
  const { t } = useI18n();
  const uid = useId();
  const [typed, setTyped] = useState('');
  const unlocked = typed.trim() === endpointId;
  const shellQuote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`;
  const curl =
    'curl --cert client_certificate.pem --key client_certificate_private_key.pem ' +
    `-H "Accept: application/fhir+json" -o dsf-allow-list-purge.json ${shellQuote(purgeUrl)}`;

  const row = (value: string, label: string) => (
    <div className="flex items-start gap-2">
      <code className={codeBox}>{value}</code>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onCopy(value)}
        aria-label={t('downloadCopyValue', { label })}
      >
        <Icon name="content_copy" size={14} />
      </Button>
    </div>
  );

  return (
    <section
      aria-labelledby={`${uid}-title`}
      data-testid="purge-section"
      className="space-y-3 rounded-control border-2 border-danger-border bg-danger-surface p-3"
    >
      <h3
        id={`${uid}-title`}
        className="flex items-center gap-2 text-sm font-semibold text-danger-fg"
      >
        <Icon name="warning" size={18} />
        {t('purgeTitle')}
      </h3>
      <p className="text-xs leading-relaxed text-[color:var(--text-primary)]">{t('purgeBody')}</p>
      <div>
        <label
          htmlFor={`${uid}-confirm`}
          className="mb-1 block text-xs font-semibold text-[color:var(--text-secondary)]"
        >
          {t('purgeConfirmLabel', { phrase: endpointId })}
        </label>
        <input
          id={`${uid}-confirm`}
          type="text"
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full rounded-input border border-danger-border bg-[color:var(--bg-input)] px-3 py-2 font-mono text-xs text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
        />
      </div>
      {unlocked && (
        <div className="animate-fade-in space-y-3" data-testid="purge-unlocked">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-[color:var(--text-secondary)]">
              {t('purgeUrlLabel')}
            </p>
            {row(purgeUrl, t('purgeCopyUrl'))}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-[color:var(--text-secondary)]">
              {t('purgeCurlLabel')}
            </p>
            {row(curl, t('purgeCopyCurl'))}
          </div>
          <p className="text-xs text-[color:var(--text-muted)]">{t('purgeAfter')}</p>
        </div>
      )}
    </section>
  );
}
