/**
 * CertificatePreviewPanel.tsx — shows what a certificate upload would
 * register, from useCertificatePreview: subject, expiry (date + validity
 * pill), the DSF fingerprint (SHA-512, grouped, with a copy button that
 * copies the raw value) and the issuer, marked "DSF-CA" when production DSF
 * instances accept it and warned about otherwise. Blocking states — a private
 * key, an unreadable PEM, a blacklisted or (when enforced) non-whitelisted
 * CA — are announced and explain why saving is disabled. The panel fades and
 * rises in, dims while a newer preview loads and fades out when the text no
 * longer looks like a certificate.
 * Dependencies: useCertificatePreview (types), Callout, Button, Icon,
 *               StatusPill, Skeleton, usePresence, lib (certStatus, dateUtils,
 *               fingerprint, motion), sonner, i18n store.
 */
import { Fragment, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useI18n } from '../../stores/i18n.store';
import { usePresence } from '../../hooks/usePresence';
import { exitMs } from '../../lib/motion';
import { certValidity, CERT_STATE_TONE } from '../../lib/certStatus';
import { formatDate } from '../../lib/dateUtils';
import { fingerprintGroups, normalizeFingerprint } from '../../lib/fingerprint';
import type { CertificatePreview } from '../../api/entities.api';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { Skeleton } from '../ui/Skeleton';
import { Callout } from './Callout';
import { certValidityLabel } from './certificateUpload';
import type { CertificatePreviewResult, CertificatePreviewState } from './useCertificatePreview';

const EXIT_MS = exitMs('short');
const PANEL = 'glass-thin rounded-xl p-4 shadow-none';

type VisibleState = Exclude<CertificatePreviewState, { kind: 'idle' }>;

/** A DN that wraps after its commas instead of mid-word (<wbr> is not copied). */
export function DistinguishedName({ value }: { value: string }) {
  const parts = value.split(',');
  return (
    <span className="break-words">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              ,<wbr />
            </>
          )}
        </Fragment>
      ))}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
        {label}
      </dt>
      <dd className="text-xs text-[color:var(--text-primary)]">{children}</dd>
    </div>
  );
}

function CopyFingerprintButton({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t('formCertFingerprintCopied'));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('formCertCopyFailed'));
    }
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0 px-2"
      aria-label={t('formCertCopyFingerprint')}
      title={t('formCertCopyFingerprint')}
      onClick={copy}
    >
      <Icon name={copied ? 'check' : 'content_copy'} size={18} />
    </Button>
  );
}

function PreviewCard({ preview, busy = false }: { preview: CertificatePreview; busy?: boolean }) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const validity = certValidity(preview.validUntil);
  const fingerprint = normalizeFingerprint(preview.thumbprintSha512);
  const notWhitelisted = !preview.issuerTrusted && preview.whitelistEnforced;
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className={`${PANEL} space-y-3 transition-opacity duration-short ease-standard ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2">
        <Icon name="verified_user" size={18} className="text-[color:var(--text-secondary)]" />
        <h3 id={titleId} className="text-sm font-semibold text-[color:var(--text-primary)]">
          {t('formCertPreviewTitle')}
        </h3>
        {busy && (
          <Icon
            name="progress_activity"
            size={16}
            className="ml-auto animate-spin text-[color:var(--text-muted)]"
            label={t('formCertPreviewChecking')}
          />
        )}
      </div>
      <dl className="space-y-3">
        <Row label={t('formCertPreviewSubject')}>
          <span className="font-medium">
            <DistinguishedName value={preview.subject} />
          </span>
        </Row>
        <Row label={t('formCertPreviewValidUntil')}>
          <span className="flex flex-wrap items-center gap-2">
            {formatDate(preview.validUntil, lang)}
            <StatusPill tone={CERT_STATE_TONE[validity.state]}>
              {certValidityLabel(validity, t)}
            </StatusPill>
          </span>
        </Row>
        <Row label={t('formCertPreviewFingerprint')}>
          <span className="flex items-start gap-2">
            <code className="grid flex-1 grid-cols-4 gap-x-2 gap-y-0.5 font-mono text-xs text-[color:var(--text-primary)] sm:grid-cols-8">
              {fingerprintGroups(fingerprint).map((group, i) => (
                <span key={i}>{group}</span>
              ))}
            </code>
            <CopyFingerprintButton value={fingerprint} />
          </span>
        </Row>
        <Row label={t('formCertPreviewIssuer')}>
          <span className="flex flex-wrap items-center gap-2">
            <DistinguishedName value={preview.issuerDn} />
            {preview.issuerTrusted && (
              <StatusPill tone="success" icon="verified">
                {t('formCertPreviewDsfCa')}
              </StatusPill>
            )}
          </span>
        </Row>
      </dl>
      {preview.issuerBlacklisted ? (
        <Callout role="alert" tone="danger" icon="block" title={t('formCertBlacklistedTitle')}>
          {t('formCertBlacklistedBody')}
        </Callout>
      ) : notWhitelisted ? (
        <Callout role="alert" tone="danger" icon="block" title={t('formCertNotWhitelistedTitle')}>
          {t('formCertNotWhitelistedBody')}
        </Callout>
      ) : (
        !preview.issuerTrusted && (
          <Callout tone="warning" icon="warning" title={t('formCertUntrustedTitle')}>
            {t('formCertUntrustedBody')}
          </Callout>
        )
      )}
    </section>
  );
}

function PanelBody({ state }: { state: VisibleState }) {
  const { t } = useI18n();
  switch (state.kind) {
    case 'privateKey':
      return (
        <Callout role="alert" tone="danger" icon="key_off" title={t('formCertPrivateKeyTitle')}>
          {t('formCertPrivateKeyBody')}
        </Callout>
      );
    case 'invalid':
      return (
        <Callout role="alert" tone="danger" icon="error" title={t('formCertInvalidTitle')}>
          {t('formCertInvalidBody')}
        </Callout>
      );
    case 'unavailable':
      return (
        <Callout
          role="status"
          tone="neutral"
          icon="cloud_off"
          title={t('formCertUnavailableTitle')}
        >
          {t('formCertUnavailableBody')}
        </Callout>
      );
    case 'loading':
      if (state.previous) return <PreviewCard preview={state.previous} busy />;
      return (
        <div role="status" className={`${PANEL} space-y-3`}>
          <p className="flex items-center gap-2 text-xs text-[color:var(--text-secondary)]">
            <Icon name="progress_activity" size={16} className="animate-spin" />
            {t('formCertPreviewChecking')}
          </p>
          <Skeleton lines={3} />
        </div>
      );
    case 'ready':
      return <PreviewCard preview={state.preview} />;
  }
}

export function CertificatePreviewPanel({ result }: { result: CertificatePreviewResult }) {
  const { state } = result;
  const visible = state.kind !== 'idle';
  const { mounted, state: presence } = usePresence(visible, EXIT_MS);
  // Keep the last visible content on screen while the panel fades out.
  const lastShown = useRef<VisibleState | null>(null);
  if (state.kind !== 'idle') lastShown.current = state;
  const shown = lastShown.current;
  if (!mounted || !shown) return null;
  // The card stays mounted between "loading (dimmed)" and "ready", so it only
  // brightens; other changes crossfade.
  const cardShown = shown.kind === 'ready' || (shown.kind === 'loading' && !!shown.previous);
  return (
    <div
      data-state={presence}
      className="data-[state=closed]:animate-fade-out data-[state=open]:animate-list-item-in"
    >
      <div key={cardShown ? 'card' : shown.kind} className="animate-fade-in">
        <PanelBody state={shown} />
      </div>
    </div>
  );
}
