/**
 * DownloadModal.tsx — download dialog of the allow list. Leads with the link DSF
 * itself uses (the current allow list of the selected endpoint, fetched with the
 * site's client certificate), lists the published versions with their DSF
 * history link and a signed GUI download, and keeps the network-wide bundle,
 * the IP address list (IMI admins only) and the content preview under a
 * disclosure. Downloads are always available; the verification disclaimer is a
 * calm note with the full text behind a disclosure. A finished
 * download shows its content hash (compared with the SHA-256 the browser
 * computes of the received bytes) and signature, followed by a three-step guide
 * to verify and import it with the DSF process downloadAllowList.
 * Dependencies: Modal, useEndpoints, useBundleHistory, useMe, entities API,
 * DownloadVersionList, BundlePreview, lib/fingerprint, i18n store, sonner.
 */
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useBundleHistory } from '../../hooks/useBundleHistory';
import { useMe } from '../../hooks/useMe';
import { api, downloadFullAllowListBundle } from '../../api/entities.api';
import { fingerprintGroups } from '../../lib/fingerprint';
import { BundlePreview } from './BundlePreview';
import { DownloadVersionList } from './DownloadVersionList';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';
import { useI18n } from '../../stores/i18n.store';

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
}

interface Verification {
  fileName: string;
  hash: string | null;
  signature: string | null;
  /** SHA-256 of the bytes received; null when the browser cannot compute it. */
  localHash: string | null;
}

/** Task input of dsf-process-allow-list's downloadAllowList (system|code). */
const TASK_INPUT = 'http://dsf.dev/fhir/CodeSystem/allow-list|allow_list';
const PROCESS_URL = 'https://github.com/datasharingframework/dsf-process-allow-list';

const codeBox =
  'min-w-0 flex-1 break-all rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-3 font-mono text-[11px] text-[color:var(--text-primary)]';
const sectionTitle = 'text-sm font-bold text-[color:var(--text-primary)]';
const helpText = 'text-xs leading-relaxed text-[color:var(--text-muted)]';
const fieldLabel = 'text-[11px] font-semibold text-[color:var(--text-secondary)]';

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toBlob(data: BlobPart, type: string): Blob {
  return data instanceof Blob ? data : new Blob([data], { type });
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

/** Monospace value with a copy button. */
function CopyField({
  value,
  label,
  display,
  onCopy,
}: {
  value: string;
  label: string;
  display?: string;
  onCopy: (text: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2">
      <code className={codeBox}>{display ?? value}</code>
      <button
        type="button"
        onClick={() => onCopy(value)}
        aria-label={t('downloadCopyValue', { label })}
        className="press-effect inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
      >
        <Icon name="content_copy" size={18} />
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
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

export function DownloadModal({ open, onClose, instanceId }: Props) {
  const { t } = useI18n();
  const uid = useId();
  const { data: endpoints = [] } = useEndpoints(instanceId);
  const { data: me } = useMe();
  const isAdmin = me?.isAdmin === true;
  const [selectedEndpoint, setSelectedEndpoint] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);

  const history = useBundleHistory(instanceId, selectedEndpoint);
  const bundleBase = selectedEndpoint
    ? `${window.location.origin}/fhir/Bundle/${encodeURIComponent(selectedEndpoint)}`
    : '';
  const networkUrl = `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'}/download/full-bundle`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('dlCopied'));
    } catch {
      toast.error(t('downloadCopyFailed'));
    }
  }

  /** Save a bundle response and keep what the user needs to verify it. */
  async function finishBundleDownload(
    res: { data: BlobPart; headers?: unknown },
    fileName: string,
  ) {
    const blob = toBlob(res.data, 'application/fhir+json');
    saveBlob(blob, fileName);
    setVerification({
      fileName,
      hash: headerValue(res.headers, 'x-content-hash'),
      signature: headerValue(res.headers, 'x-bundle-signature'),
      localHash: await sha256Hex(blob),
    });
    toast.success(t('bundleDownloaded'));
  }

  async function downloadVersion(version: number) {
    setBusyVersion(version);
    try {
      const res = await api(instanceId).downloadBundle(selectedEndpoint, version);
      await finishBundleDownload(res, `dsf-allow-list-v${version}.json`);
    } catch {
      toast.error(t('bundleDownloadFailed'));
    } finally {
      setBusyVersion(null);
    }
  }

  async function downloadNetworkBundle() {
    setBusy(true);
    try {
      const res = await downloadFullAllowListBundle();
      await finishBundleDownload(res, 'dsf-allow-list-bundle.json');
    } catch {
      toast.error(t('bundleDownloadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function downloadIpList() {
    setBusy(true);
    try {
      const res = await api(instanceId).downloadIpList();
      saveBlob(
        toBlob(res.data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        `dsf-ip-address-list-${new Date().toISOString().split('T')[0]}.xlsx`,
      );
      toast.success(t('downloadIpSuccess'));
    } catch {
      toast.error(t('downloadIpFailed'));
    } finally {
      setBusy(false);
    }
  }

  const hashCheck =
    verification?.hash && verification.localHash
      ? verification.localHash === verification.hash.toLowerCase()
        ? 'match'
        : 'mismatch'
      : 'unchecked';
  const commandFile = verification?.fileName ?? 'dsf-allow-list.json';
  const [stepBefore, stepAfter = ''] = t('downloadGuideStep3Body').split('{link}');

  return (
    <Modal open={open} onClose={onClose} title={t('downloadModalTitle')} width="max-w-2xl">
      <div className="space-y-4">
        <div className="glass-thin rounded-2xl px-4 py-3" data-testid="bundle-disclaimer">
          <p className="flex items-start gap-2 text-xs text-[color:var(--text-secondary)]">
            <Icon name="info" size={16} className="mt-px shrink-0 text-info-fg" />
            <span>{t('dlDisclaimerNote')}</span>
          </p>
          <details className="mt-1.5 pl-6">
            <summary className="cursor-pointer text-[11px] font-semibold text-[color:var(--text-secondary)]">
              {t('dlDisclaimerMore')}
            </summary>
            <p className={`mt-1 ${helpText}`}>{t('bundleDisclaimerBody')}</p>
          </details>
        </div>

        <div>
          <label
            htmlFor={`${uid}-endpoint`}
            className="mb-1.5 block text-xs font-semibold text-[color:var(--text-secondary)]"
          >
            {t('downloadModalSelectEndpoint')}
          </label>
          <select
            id={`${uid}-endpoint`}
            value={selectedEndpoint}
            onChange={(e) => {
              setSelectedEndpoint(e.target.value);
              setVerification(null);
            }}
            className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] px-3 py-2 text-sm text-[color:var(--text-primary)]"
          >
            <option value="">{t('downloadModalSelectEndpointPlaceholder')}</option>
            {endpoints.map((ep: { identifier: string; name?: string }) => (
              <option key={ep.identifier} value={ep.identifier}>
                {ep.name || ep.identifier}
              </option>
            ))}
          </select>
        </div>

        <section className="glass-thin rounded-2xl p-4" aria-labelledby={`${uid}-link`}>
          <h3 id={`${uid}-link`} className={sectionTitle}>
            {t('dlDsfLinkTitle')}
          </h3>
          <p className={`mt-1 ${helpText}`}>{t('dlDsfLinkHelp')}</p>
          {bundleBase ? (
            <div className="mt-3 flex items-start gap-2">
              <code className={`${codeBox} text-xs`} data-testid="dsf-link">
                {bundleBase}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void copy(bundleBase)}
                aria-label={t('dlCopyLink')}
                data-testid="copy-dsf-link"
              >
                <Icon name="content_copy" size={16} />
                {t('dlCopyLink')}
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-xs italic text-[color:var(--text-muted)]">
              {t('dlDsfLinkPick')}
            </p>
          )}
        </section>

        {selectedEndpoint && (
          <section className="glass-thin rounded-2xl p-4" aria-labelledby={`${uid}-history`}>
            <h3 id={`${uid}-history`} className={`${sectionTitle} mb-3`}>
              {t('dlHistoryTitle')}
            </h3>
            {history.isLoading ? (
              <Skeleton lines={3} />
            ) : history.isError ? (
              <p role="alert" className="text-xs text-danger-fg">
                {t('dlHistoryLoadFailed')}
              </p>
            ) : (history.data?.length ?? 0) === 0 ? (
              <p className="text-xs italic text-[color:var(--text-muted)]">{t('dlHistoryEmpty')}</p>
            ) : (
              <DownloadVersionList
                versions={history.data ?? []}
                historyUrl={(v) => `${bundleBase}/_history/${v}`}
                onCopy={(url) => void copy(url)}
                onDownload={downloadVersion}
                busyVersion={busyVersion}
              />
            )}
          </section>
        )}

        {verification && (
          <section
            className="glass-thin animate-list-item-in space-y-3 rounded-2xl p-4"
            aria-labelledby={`${uid}-verify`}
            data-testid="verify-panel"
          >
            <div>
              <h3 id={`${uid}-verify`} className={sectionTitle}>
                {t('dlVerifyTitle')}
              </h3>
              <p className={`mt-1 ${helpText}`}>{t('dlVerifyIntro')}</p>
            </div>
            <p className="break-all font-mono text-xs text-[color:var(--text-primary)]">
              {verification.fileName}
            </p>
            {!verification.hash && !verification.signature && (
              <p role="alert" className="text-xs font-medium text-warning-fg">
                {t('downloadResultNoHeaders')}
              </p>
            )}
            {verification.hash && (
              <div className="space-y-1.5">
                <p className={fieldLabel}>{t('dlVerifyHash')}</p>
                <CopyField
                  value={verification.hash}
                  display={fingerprintGroups(verification.hash).join(' ')}
                  label={t('dlVerifyHash')}
                  onCopy={(text) => void copy(text)}
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
            {verification.signature && (
              <details>
                <summary className="cursor-pointer text-[11px] font-semibold text-[color:var(--text-secondary)]">
                  {t('dlVerifySignature')}
                </summary>
                <div className="mt-1.5">
                  <CopyField
                    value={verification.signature}
                    label={t('dlVerifySignature')}
                    onCopy={(text) => void copy(text)}
                  />
                </div>
              </details>
            )}
          </section>
        )}

        <section className="glass-thin rounded-2xl p-4" aria-labelledby={`${uid}-guide`}>
          <h3 id={`${uid}-guide`} className={`${sectionTitle} mb-3`}>
            {t('downloadGuideTitle')}
          </h3>
          <ol className="space-y-4">
            <Step n={1} title={t('downloadGuideStep1Title')}>
              <p className={helpText}>{t('downloadGuideStep1Body')}</p>
            </Step>
            <Step n={2} title={t('downloadGuideStep2Title')}>
              <p className={helpText}>{t('downloadGuideStep2Body')}</p>
              <p className={fieldLabel}>{t('downloadGuideStep2Commands')}</p>
              <CopyField
                value={`sha256sum ${commandFile}`}
                label="sha256sum"
                onCopy={(text) => void copy(text)}
              />
              <CopyField
                value={`Get-FileHash ${commandFile} -Algorithm SHA256`}
                label="Get-FileHash"
                onCopy={(text) => void copy(text)}
              />
            </Step>
            <Step n={3} title={t('downloadGuideStep3Title')}>
              <p className={helpText}>
                {stepBefore}
                <a
                  href={PROCESS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[color:var(--accent)] underline"
                >
                  {t('downloadGuideProcessLink')}
                </a>
                {stepAfter}
              </p>
              <p className={fieldLabel}>{t('downloadGuideTaskInput')}</p>
              <CopyField
                value={TASK_INPUT}
                label={t('downloadGuideTaskInput')}
                onCopy={(text) => void copy(text)}
              />
              <p className="flex gap-1.5 text-[11px] leading-relaxed text-[color:var(--text-secondary)]">
                <Icon name="info" size={14} className="mt-px shrink-0 text-info-fg" />
                <span>{t('downloadGuideIdentifiers')}</span>
              </p>
            </Step>
          </ol>
        </section>

        <details className="glass-thin rounded-2xl p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--text-secondary)]">
            {t('dlAdvanced')}
          </summary>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <h3 className={sectionTitle}>{t('downloadFullBundleTitle')}</h3>
              <p className={helpText}>{t('downloadFullBundleHelp')}</p>
              <CopyField
                value={networkUrl}
                label={t('downloadFullBundleTitle')}
                onCopy={(text) => void copy(text)}
              />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={downloadNetworkBundle}
                data-testid="download-bundle-btn"
                className="w-full"
              >
                {busy ? t('downloadModalDownloading') : t('downloadModalDownloadBundle')}
              </Button>
            </div>
            {isAdmin && (
              <div className="space-y-2">
                <h3 className={sectionTitle}>{t('downloadModalIpTitle')}</h3>
                <p className={helpText}>{t('downloadModalIpDesc')}</p>
                <Button
                  variant="secondary"
                  onClick={downloadIpList}
                  disabled={busy}
                  data-testid="download-ip-btn"
                  className="w-full"
                >
                  {busy ? t('downloadModalDownloading') : t('downloadModalDownloadIp')}
                </Button>
              </div>
            )}
            <BundlePreview instanceId={instanceId} />
          </div>
        </details>

        <div className="flex justify-end border-t border-[color:var(--border)] pt-3">
          <Button variant="secondary" onClick={onClose}>
            {t('downloadModalClose')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
