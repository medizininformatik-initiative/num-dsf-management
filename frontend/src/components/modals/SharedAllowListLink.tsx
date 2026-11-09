/**
 * SharedAllowListLink.tsx — secondary hint under the DSF web UI variant of the
 * download dialog: https://<portal>/fhir/Bundle/mine, the same address for every
 * site (the DSF client certificate identifies the organization and its
 * endpoint), which works for sites with exactly one FHIR endpoint. A copy
 * button writes exactly that address.
 * Dependencies: Button, Icon, i18n store.
 */
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
  return (
    <div className="mt-4 border-t border-[color:var(--border)] pt-3">
      <p className="text-xs leading-relaxed text-[color:var(--text-muted)]">
        {t('dsfTaskSharedHint')}
      </p>
      <div className="mt-2 flex items-start gap-2">
        <code
          className="min-w-0 flex-1 break-all rounded-control border border-[color:var(--border)] bg-[color:var(--bg-card)] px-3 py-2 font-mono text-2xs text-[color:var(--text-primary)]"
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
          <Icon name="content_copy" size={14} />
          {t('dlCopyLink')}
        </Button>
      </div>
    </div>
  );
}
