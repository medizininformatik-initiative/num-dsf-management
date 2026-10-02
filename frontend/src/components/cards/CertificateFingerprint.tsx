/**
 * CertificateFingerprint.tsx – A certificate fingerprint shown in full so a site can compare
 * it with its DSF configuration: a label, the hex in 4-character groups that wrap cleanly in
 * aligned columns (at most 8 per line; selecting the block copies the raw hex) and a copy
 * button. Copying writes the raw lower-case hex; the button's icon morphs into a check for
 * 1.5 s (spring; a crossfade under Reduce Motion) and a toast confirms, while a refused
 * clipboard write shows an error toast instead.
 * Dependencies: lib/fingerprint, Button, Icon, i18n store, sonner.
 */
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { fingerprintGroups, normalizeFingerprint } from '../../lib/fingerprint';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/** How long the copy button shows its check mark. */
export const COPIED_FEEDBACK_MS = 1500;

interface CertificateFingerprintProps {
  label: string;
  /** Fingerprint as hex, with or without separators. */
  hex: string;
  /** Accessible name of the copy button, e.g. "Copy DSF fingerprint". */
  copyLabel: string;
  /** Toast after a successful copy. */
  copiedMessage: string;
  className?: string;
}

export function CertificateFingerprint({
  label,
  hex,
  copyLabel,
  copiedMessage,
  className = '',
}: CertificateFingerprintProps) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={className}>
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="text-[11px] font-semibold text-[color:var(--text-secondary)]">
          {label}
        </span>
        <CopyButton
          value={normalizeFingerprint(hex)}
          label={copyLabel}
          copiedMessage={copiedMessage}
        />
      </div>
      {/* Room for 8 groups (4ch + 0.6ch gap each) plus padding and border. */}
      <code className="mono-id mt-1 block max-w-[calc(37ch+18px)] select-all rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2 py-1.5 text-[11px] leading-5 text-[color:var(--text-primary)]">
        {fingerprintGroups(hex).map((group, i) => (
          // Inline blocks wrap between groups and copy without separators.
          <span key={i} className="mr-[0.6ch] inline-block">
            {group}
          </span>
        ))}
      </code>
    </div>
  );
}

function CopyButton({
  value,
  label,
  copiedMessage,
}: {
  value: string;
  label: string;
  copiedMessage: string;
}) {
  const { t } = useI18n();
  // Timestamp of the last copy; a new copy restarts the feedback timer.
  const [copiedAt, setCopiedAt] = useState(0);
  const copied = copiedAt > 0;

  useEffect(() => {
    if (!copiedAt) return;
    const timer = setTimeout(() => setCopiedAt(0), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedAt(Date.now());
      toast.success(copiedMessage);
    } catch {
      toast.error(t('certCardCopyFailed'));
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      data-copied={copied}
      onClick={() => void copy()}
      className="relative h-8 w-8 shrink-0 !px-0"
    >
      <Icon
        name="content_copy"
        size={16}
        className={`absolute transition duration-short ease-spring ${
          copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100'
        }`}
      />
      <Icon
        name="check"
        size={18}
        className={`absolute text-success-fg transition duration-medium ease-spring-bouncy ${
          copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
        }`}
      />
    </Button>
  );
}
