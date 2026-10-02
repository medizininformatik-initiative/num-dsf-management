/**
 * DownloadModal.tsx — allow-list downloads with verification help.
 * Primary option: the endpoint bundle, exactly what the site's DSF process
 * downloads for the selected endpoint (signed). Secondary: the network-wide
 * bundle (signed too) and the IP-address Excel list. Everything stays behind
 * the disclaimer acknowledgment. After a bundle download the dialog shows the
 * content hash (X-Content-Hash, compared with the SHA-256 of the received
 * bytes), the signature (X-Bundle-Signature, collapsed) and the time, each
 * with a copy button; a three-step guide ends with the Task input for the DSF
 * process downloadAllowList.
 * Dependencies: Modal, Button, Icon, StatusPill, BundlePreview, useEndpoints,
 * entities.api, lib/dateUtils, lib/fingerprint, i18n store, sonner.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { selectClass } from './FormField';
import { BundlePreview } from './BundlePreview';
import { useEndpoints } from '../../hooks/useEndpoints';
import { api, downloadFullAllowListBundle } from '../../api/entities.api';
import { formatDateTime } from '../../lib/dateUtils';
import { fingerprintGroups } from '../../lib/fingerprint';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';

/** Task input of dsf-process-allow-list's downloadAllowList (system|code). */
const TASK_INPUT = 'http://dsf.dev/fhir/CodeSystem/allow-list|allow_list';
const PROCESS_URL = 'https://github.com/datasharingframework/dsf-process-allow-list';

type BundleKind = 'endpoint' | 'full';

interface DownloadResult {
  fileName: string;
  contentHash: string | null;
  signature: string | null;
  /** SHA-256 of the bytes received; null when the browser cannot compute it. */
  localHash: string | null;
  at: string;
}

interface EndpointOption {
  identifier: string;
  name?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** A response header from axios (AxiosHeaders or a plain object). */
function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as { get?: (n: string) => unknown } & Record<string, unknown>;
  const value = typeof h.get === 'function' ? h.get(name) : h[name];
  return typeof value === 'string' && value ? value : null;
}

/** Hex SHA-256 of a blob, or null without WebCrypto (e.g. outside a secure context). */
async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof blob.arrayBuffer !== 'function') return null;
    const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Icon button that copies `value` and confirms with a short check mark. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
      toast.success(t('downloadCopiedToast', { label }));
    } catch {
      toast.error(t('downloadCopyFailed'));
    }
  }

  const name = t('downloadCopyValue', { label });
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={copy}
      aria-label={name}
      title={name}
      className="flex-shrink-0 px-1.5"
    >
      <Icon
        key={copied ? 'done' : 'copy'}
        name={copied ? 'check' : 'content_copy'}
        size={16}
        className={copied ? 'animate-popover-in text-success-fg' : ''}
      />
    </Button>
  );
}

/** Monospace value with its copy button. */
function CopyField({ value, label, display }: { value: string; label: string; display?: string }) {
  return (
    <div className="flex items-start gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] py-1 pl-2.5 pr-1">
      <code className="min-w-0 flex-1 break-all py-1 font-mono text-[11px] leading-relaxed text-[color:var(--text-primary)]">
        {display ?? value}
      </code>
      <CopyButton value={value} label={label} />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs font-bold text-[color:var(--text-primary)]">{title}</p>
        {children}
      </div>
    </li>
  );
}

const card =
  'space-y-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-hover)] p-4';
const helpText = 'text-xs leading-relaxed text-[color:var(--text-secondary)]';
const fieldLabel = 'text-[11px] font-semibold text-[color:var(--text-secondary)]';

export function DownloadModal({ open, onClose, instanceId }: Props) {
  const { t, lang } = useI18n();
  const selectId = useId();
  const ackHintId = useId();
  const { data: endpointData } = useEndpoints(instanceId);
  const endpoints: EndpointOption[] = Array.isArray(endpointData) ? endpointData : [];
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState<BundleKind | 'ip' | null>(null);
  const [result, setResult] = useState<DownloadResult | null>(null);
  // Acknowledgment gate: federated allow-list bundles are recommendations, not
  // automatically trusted artefacts. Sites verify content, signature and
  // provenance before deploying (the guide below shows how).
  const [acknowledged, setAcknowledged] = useState(false);

  // Default to the first endpoint; fall back when the picked one disappears.
  const endpointId = endpoints.some((e) => e.identifier === picked)
    ? picked
    : (endpoints[0]?.identifier ?? '');
  const endpointFile = (id: string) => `allowlist-bundle-${id}.json`;
  const bundleReference = endpointId
    ? `${window.location.origin}/fhir/Bundle/${encodeURIComponent(endpointId)}`
    : '';
  const commandFile =
    result?.fileName ?? (endpointId ? endpointFile(endpointId) : 'allow-list-bundle.json');

  async function downloadBundle(kind: BundleKind) {
    setBusy(kind);
    try {
      const res =
        kind === 'endpoint'
          ? await api(instanceId).downloadBundle(endpointId)
          : await downloadFullAllowListBundle();
      const fileName =
        kind === 'endpoint' ? endpointFile(endpointId) : 'dsf-allow-list-bundle.json';
      const blob =
        res.data instanceof Blob
          ? res.data
          : new Blob([res.data], { type: 'application/fhir+json' });
      saveBlob(blob, fileName);
      setResult({
        fileName,
        contentHash: headerValue(res.headers, 'x-content-hash'),
        signature: headerValue(res.headers, 'x-bundle-signature'),
        localHash: await sha256Hex(blob),
        at: new Date().toISOString(),
      });
      toast.success(t('bundleDownloaded'));
    } catch {
      toast.error(t('bundleDownloadFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function downloadIpList() {
    setBusy('ip');
    try {
      const res = await api(instanceId).downloadIpList();
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveBlob(blob, `dsf-ip-address-list-${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success(t('downloadIpSuccess'));
    } catch {
      toast.error(t('downloadIpFailed'));
    } finally {
      setBusy(null);
    }
  }

  const hashCheck =
    result?.contentHash && result.localHash
      ? result.localHash === result.contentHash.toLowerCase()
        ? 'match'
        : 'mismatch'
      : 'unchecked';
  const [stepBefore, stepAfter = ''] = t('downloadGuideStep3Body').split('{link}');
  const ackHint = acknowledged ? undefined : ackHintId;

  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title={t('downloadModalTitle')}>
      <div className="space-y-5">
        <div
          className="rounded-xl border border-warning-border bg-warning-surface p-3"
          data-testid="bundle-disclaimer"
        >
          <p className="mb-1 text-xs font-semibold text-[color:var(--text-primary)]">
            {t('bundleDisclaimerHeading')}
          </p>
          <p className="mb-2 text-xs leading-relaxed text-[color:var(--text-secondary)]">
            {t('bundleDisclaimerBody')}
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-[color:var(--text-primary)]">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 accent-[color:var(--primary)]"
              data-testid="disclaimer-checkbox"
            />
            <span>{t('bundleDisclaimerAcknowledge')}</span>
          </label>
          {!acknowledged && (
            <p id={ackHintId} className="mt-2 text-[11px] text-warning-fg">
              {t('downloadAckHint')}
            </p>
          )}
        </div>

        {/* Primary: the endpoint bundle the site's DSF downloads */}
        <section className={card} aria-labelledby={`${selectId}-title`}>
          <div>
            <h3
              id={`${selectId}-title`}
              className="text-sm font-bold text-[color:var(--text-primary)]"
            >
              {t('downloadEndpointBundleTitle')}
            </h3>
            <p className={`mt-1 ${helpText}`}>{t('downloadEndpointBundleHelp')}</p>
          </div>
          {endpoints.length === 0 ? (
            <p className="text-xs font-medium text-warning-fg">{t('downloadNoEndpoints')}</p>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor={selectId} className={`block ${fieldLabel}`}>
                {t('downloadModalSelectEndpoint')}
              </label>
              <select
                id={selectId}
                value={endpointId}
                onChange={(e) => setPicked(e.target.value)}
                className={selectClass}
              >
                {endpoints.map((ep) => (
                  <option key={ep.identifier} value={ep.identifier}>
                    {ep.name ? `${ep.name} (${ep.identifier})` : ep.identifier}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            className="w-full"
            disabled={busy !== null || !acknowledged || !endpointId}
            onClick={() => downloadBundle('endpoint')}
            aria-describedby={ackHint}
            data-testid="download-bundle-btn"
          >
            <Icon name="download" size={16} />
            {busy === 'endpoint' ? t('downloadModalDownloading') : t('downloadModalDownloadBundle')}
          </Button>
        </section>

        {/* Secondary: the network-wide bundle */}
        <section className={card} aria-labelledby={`${selectId}-full`}>
          <div>
            <h3
              id={`${selectId}-full`}
              className="text-xs font-bold text-[color:var(--text-primary)]"
            >
              {t('downloadFullBundleTitle')}
            </h3>
            <p className={`mt-1 ${helpText}`}>{t('downloadFullBundleHelp')}</p>
          </div>
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy !== null || !acknowledged}
            onClick={() => downloadBundle('full')}
            aria-describedby={ackHint}
            data-testid="download-full-bundle-btn"
          >
            <Icon name="public" size={16} />
            {busy === 'full' ? t('downloadModalDownloading') : t('downloadFullBundleBtn')}
          </Button>
        </section>

        {result && (
          <section
            key={result.at}
            data-testid="download-result"
            className="animate-list-item-in space-y-3 rounded-xl border border-info-border bg-info-surface p-4"
          >
            <p className="flex items-center gap-1.5 break-all text-xs font-bold text-[color:var(--text-primary)]">
              <Icon name="task_alt" size={16} className="text-info-fg" />
              {t('downloadResultTitle', { file: result.fileName })}
            </p>
            {!result.contentHash && !result.signature && (
              <p role="alert" className="text-xs font-medium text-warning-fg">
                {t('downloadResultNoHeaders')}
              </p>
            )}
            {result.contentHash && (
              <div className="space-y-1">
                <p className={fieldLabel}>{t('downloadResultHash')}</p>
                <CopyField
                  value={result.contentHash}
                  display={fingerprintGroups(result.contentHash).join(' ')}
                  label={t('downloadResultHash')}
                />
                {hashCheck === 'match' && (
                  <StatusPill
                    tone="success"
                    icon="verified"
                    className="whitespace-normal"
                    data-testid="hash-check"
                  >
                    {t('downloadResultHashMatch')}
                  </StatusPill>
                )}
                {hashCheck === 'mismatch' && (
                  <p role="alert" data-testid="hash-check">
                    <StatusPill tone="danger" icon="gpp_bad" className="whitespace-normal">
                      {t('downloadResultHashMismatch')}
                    </StatusPill>
                  </p>
                )}
                {hashCheck === 'unchecked' && (
                  <p className="text-[11px] text-[color:var(--text-secondary)]">
                    {t('downloadResultHashUnchecked')}
                  </p>
                )}
              </div>
            )}
            {result.signature && (
              <div className="flex items-start gap-1">
                <details className="group min-w-0 flex-1">
                  <summary className="flex cursor-pointer list-none items-center gap-1 rounded py-1 text-[11px] font-semibold text-[color:var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] [&::-webkit-details-marker]:hidden">
                    <Icon
                      name="chevron_right"
                      size={16}
                      className="transition-transform duration-short ease-standard group-open:rotate-90"
                    />
                    {t('downloadResultSignature')}
                  </summary>
                  <code className="mt-1 block max-h-32 overflow-auto break-all rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] p-2 font-mono text-[11px] leading-relaxed text-[color:var(--text-primary)]">
                    {result.signature}
                  </code>
                </details>
                <CopyButton value={result.signature} label={t('downloadResultSignature')} />
              </div>
            )}
            <div className="flex items-center gap-1">
              <p className="min-w-0 flex-1 text-xs text-[color:var(--text-primary)]">
                <span className={fieldLabel}>{t('downloadResultTime')}</span>{' '}
                <time dateTime={result.at}>{formatDateTime(result.at, lang)}</time>
              </p>
              <CopyButton value={result.at} label={t('downloadResultTime')} />
            </div>
          </section>
        )}

        {/* How to verify and import */}
        <section aria-labelledby={`${selectId}-guide`} className="space-y-3">
          <h3
            id={`${selectId}-guide`}
            className="text-sm font-bold text-[color:var(--text-primary)]"
          >
            {t('downloadGuideTitle')}
          </h3>
          <ol className="space-y-4">
            <Step n={1} title={t('downloadGuideStep1Title')}>
              <p className={helpText}>{t('downloadGuideStep1Body')}</p>
            </Step>
            <Step n={2} title={t('downloadGuideStep2Title')}>
              <p className={helpText}>{t('downloadGuideStep2Body')}</p>
              <p className={fieldLabel}>{t('downloadGuideStep2Commands')}</p>
              <CopyField value={`sha256sum ${commandFile}`} label="sha256sum" />
              <CopyField
                value={`Get-FileHash ${commandFile} -Algorithm SHA256`}
                label="Get-FileHash"
              />
            </Step>
            <Step n={3} title={t('downloadGuideStep3Title')}>
              <p className={helpText}>
                {stepBefore}
                <a
                  href={PROCESS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-primary underline-offset-2 hover:underline dark:text-brand-400"
                >
                  {t('downloadGuideProcessLink')}
                  <Icon name="open_in_new" size={12} />
                </a>
                {stepAfter}
              </p>
              <p className={fieldLabel}>{t('downloadGuideTaskInput')}</p>
              <CopyField value={TASK_INPUT} label={t('downloadGuideTaskInput')} />
              <p className={fieldLabel}>{t('downloadGuideReference')}</p>
              {bundleReference ? (
                <CopyField value={bundleReference} label={t('downloadGuideReference')} />
              ) : (
                <p className="text-xs text-warning-fg">{t('downloadGuideSelectEndpoint')}</p>
              )}
              <p className="flex gap-1.5 text-[11px] leading-relaxed text-[color:var(--text-secondary)]">
                <Icon name="info" size={14} className="mt-px flex-shrink-0 text-info-fg" />
                <span>{t('downloadGuideIdentifiers')}</span>
              </p>
            </Step>
          </ol>
        </section>

        <section className={card}>
          <div>
            <h3 className="text-xs font-bold text-[color:var(--text-primary)]">
              {t('downloadModalIpTitle')}
            </h3>
            <p className={`mt-1 ${helpText}`}>{t('downloadModalIpDesc')}</p>
          </div>
          <Button
            variant="secondary"
            className="w-full"
            onClick={downloadIpList}
            disabled={busy !== null || !acknowledged}
            aria-describedby={ackHint}
            data-testid="download-ip-btn"
          >
            <Icon name="table_view" size={16} />
            {busy === 'ip' ? t('downloadModalDownloading') : t('downloadModalDownloadIp')}
          </Button>
        </section>

        <BundlePreview instanceId={instanceId} />

        <div className="flex justify-end border-t border-[color:var(--border)] pt-4">
          <Button variant="secondary" onClick={onClose}>
            {t('downloadModalClose')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
