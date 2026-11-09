/**
 * CaFingerprint.tsx – a CA certificate's SHA-256 fingerprint shown in groups
 * of four for reading and comparing, with a copy button that copies the raw
 * value exactly as stored. The button briefly turns into a check mark and a
 * toast confirms the copy (or explains a refused clipboard).
 * Dependencies: lib/fingerprint, Icon, i18n store, sonner.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fingerprintGroups } from '../../lib/fingerprint';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

const COPIED_MS = 1500;

export function CaFingerprint({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t('caFingerprintCopied'));
    } catch {
      toast.error(t('caCopyFailed'));
    }
  }

  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-px shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
        {t('caFingerprintLabel')}
      </span>
      <code className="flex min-w-0 flex-wrap gap-x-1.5 font-mono text-xs leading-5 text-[color:var(--text-secondary)]">
        {fingerprintGroups(value).map((group, i) => (
          <span key={i}>{group.toUpperCase()}</span>
        ))}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={t('caCopyFingerprint')}
        title={t('caCopyFingerprint')}
        className="press-effect -my-1 shrink-0 rounded-control p-1 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon
          name={copied ? 'check' : 'content_copy'}
          size={16}
          className={copied ? 'text-success-fg' : undefined}
        />
      </button>
    </div>
  );
}
