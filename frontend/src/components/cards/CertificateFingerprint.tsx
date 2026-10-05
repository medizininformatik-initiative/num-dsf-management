/**
 * CertificateFingerprint.tsx – A certificate thumbprint shown like certtool prints it: one
 * contiguous lower-case hex string (monospace, wrapping anywhere, selectable) with a copy
 * button that writes exactly that string. Optionally a description above and a copyable
 * command line below (the certtool recipe of the old allow-list tool). The copy button's
 * icon morphs into a check for 1.5 s (spring; a crossfade under Reduce Motion) and a toast
 * confirms, while a refused clipboard write shows an error toast instead.
 * Dependencies: lib/fingerprint, Button, Icon, i18n store, sonner.
 */
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { normalizeFingerprint } from '../../lib/fingerprint';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/** The old allow-list tool's recipe for the SHA-512 thumbprint. */
export const CERTTOOL_COMMAND =
  'certtool --fingerprint --hash=sha512 --infile=client_certificate.pem';

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
  /** Explanation shown between label and value. */
  description?: string;
  /** Command line that reproduces the value, shown as a copyable code line. */
  command?: { text: string; copyLabel: string; copiedMessage: string };
  className?: string;
}

export function CertificateFingerprint({
  label,
  hex,
  copyLabel,
  copiedMessage,
  description,
  command,
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
      {description && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--text-muted)]">
          {description}
        </p>
      )}
      <code
        data-testid="thumbprint-value"
        className="mono-id mt-1 block select-all break-all rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2 py-1.5 text-[11px] leading-5 text-[color:var(--text-primary)]"
      >
        {normalizeFingerprint(hex)}
      </code>
      {command && (
        <div className="mt-1.5 flex items-center gap-2">
          <code
            data-testid="thumbprint-command"
            className="mono-id min-w-0 flex-1 select-all break-all rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2 py-1.5 text-[11px] leading-5 text-[color:var(--text-primary)]"
          >
            {command.text}
          </code>
          <CopyButton
            value={command.text}
            label={command.copyLabel}
            copiedMessage={command.copiedMessage}
          />
        </div>
      )}
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
