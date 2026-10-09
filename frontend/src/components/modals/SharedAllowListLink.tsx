/**
 * SharedAllowListLink.tsx — primary "Link for downloadAllowList" of the download dialog:
 * https://<portal>/fhir/Bundle/mine, the same address for every site (the DSF client
 * certificate identifies the organization and its endpoint). A copy button writes exactly
 * that address; the per-endpoint link below it is for sites with several endpoints.
 * Dependencies: Button, Icon, i18n store.
 */
import { useId } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

export function SharedAllowListLink({
  url,
  onCopy,
}: {
  url: string;
  onCopy: (text: string) => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  return (
    <section className="glass-thin rounded-2xl p-4" aria-labelledby={`${uid}-shared`}>
      <h3 id={`${uid}-shared`} className="text-sm font-bold text-[color:var(--text-primary)]">
        {t('dlSharedLinkTitle')}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
        {t('dlSharedLinkHelp')}
      </p>
      <div className="mt-3 flex items-start gap-2">
        <code
          className="min-w-0 flex-1 break-all rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-3 font-mono text-xs text-[color:var(--text-primary)]"
          data-testid="shared-link"
        >
          {url}
        </code>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onCopy(url)}
          aria-label={t('dlSharedLinkCopy')}
          data-testid="copy-shared-link"
        >
          <Icon name="content_copy" size={16} />
          {t('dlCopyLink')}
        </Button>
      </div>
    </section>
  );
}
