/**
 * DownloadModal.tsx — download dialog of the allow list. Leads with the link DSF
 * itself uses (the current allow list of the selected endpoint, fetched with the
 * site's client certificate), lists the published versions with their DSF
 * history link and a signed GUI download, and keeps the network-wide bundle,
 * the IP address list and the content preview under a disclosure. Downloads
 * stay gated behind the verification disclaimer; a finished versioned download
 * shows its hash and signature for comparison.
 * Dependencies: Modal, useEndpoints, useBundleHistory, entities API, DownloadVersionList, BundlePreview.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from './Modal';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useBundleHistory } from '../../hooks/useBundleHistory';
import { api, downloadFullAllowListBundle } from '../../api/entities.api';
import { BundlePreview } from './BundlePreview';
import { DownloadVersionList } from './DownloadVersionList';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { useI18n } from '../../stores/i18n.store';

interface Props {
  open: boolean;
  onClose: () => void;
  instanceId: string;
}

interface Verification {
  version: number;
  hash: string;
  signature: string;
}

const TASK_INPUT = 'http://dsf.dev/fhir/CodeSystem/allow-list|allow_list';

function saveBlob(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DownloadModal({ open, onClose, instanceId }: Props) {
  const { t } = useI18n();
  const { data: endpoints = [] } = useEndpoints(instanceId);
  const [selectedEndpoint, setSelectedEndpoint] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  // Acknowledgment gate: federated AllowList bundles are recommendations, not
  // automatically-trusted artefacts. Sites must verify content+signature+
  // provenance before deploying. Block downloads until the operator confirms.
  const [acknowledged, setAcknowledged] = useState(false);

  const history = useBundleHistory(instanceId, selectedEndpoint);
  const bundleBase = selectedEndpoint
    ? `${window.location.origin}/fhir/Bundle/${encodeURIComponent(selectedEndpoint)}`
    : '';
  const networkUrl = `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'}/download/full-bundle`;

  function copy(text: string) {
    void navigator.clipboard?.writeText(text);
    toast.success(t('dlCopied'));
  }

  async function downloadVersion(version: number) {
    setBusyVersion(version);
    try {
      const res = await api(instanceId).downloadBundle(selectedEndpoint, version);
      saveBlob(res.data, 'application/fhir+json', `dsf-allow-list-v${version}.json`);
      const h = res.headers ?? {};
      setVerification({
        version: Number(h['x-bundle-version'] ?? version),
        hash: String(h['x-content-hash'] ?? ''),
        signature: String(h['x-bundle-signature'] ?? ''),
      });
      toast.success(t('bundleDownloaded'));
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
      saveBlob(res.data, 'application/fhir+json', 'dsf-allow-list-bundle.json');
      toast.success(t('bundleDownloaded'));
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
        res.data,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        `dsf-ip-address-list-${new Date().toISOString().split('T')[0]}.xlsx`,
      );
      toast.success(t('downloadIpSuccess'));
    } catch {
      toast.error(t('downloadIpFailed'));
    } finally {
      setBusy(false);
    }
  }

  const sectionTitle = 'text-sm font-bold text-[color:var(--text-primary)]';
  const sectionHelp = 'mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]';

  return (
    <Modal open={open} onClose={onClose} title={t('downloadModalTitle')} width="max-w-2xl">
      <div className="space-y-4">
        <div className="glass-thin rounded-2xl p-4" data-testid="bundle-disclaimer">
          <p className="text-xs font-semibold text-[color:var(--text-primary)]">
            {t('bundleDisclaimerHeading')}
          </p>
          <p className="mb-2 mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
            {t('bundleDisclaimerBody')}
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-[color:var(--text-secondary)]">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
              data-testid="disclaimer-checkbox"
            />
            <span>{t('bundleDisclaimerAcknowledge')}</span>
          </label>
        </div>

        <div>
          <label
            htmlFor="download-endpoint"
            className="mb-1.5 block text-xs font-semibold text-[color:var(--text-secondary)]"
          >
            {t('downloadModalSelectEndpoint')}
          </label>
          <select
            id="download-endpoint"
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

        <section className="glass-thin rounded-2xl p-4" aria-labelledby="dl-dsf-link">
          <h3 id="dl-dsf-link" className={sectionTitle}>
            {t('dlDsfLinkTitle')}
          </h3>
          <p className={sectionHelp}>{t('dlDsfLinkHelp')}</p>
          {bundleBase ? (
            <div className="mt-3 flex items-start gap-2">
              <code
                className="min-w-0 flex-1 break-all rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-3 font-mono text-xs text-[color:var(--text-primary)]"
                data-testid="dsf-link"
              >
                {bundleBase}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copy(bundleBase)}
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
          <code className="mt-2 block break-all font-mono text-[11px] text-[color:var(--text-muted)]">
            {TASK_INPUT}
          </code>
        </section>

        {selectedEndpoint && (
          <section className="glass-thin rounded-2xl p-4" aria-labelledby="dl-history">
            <h3 id="dl-history" className={`${sectionTitle} mb-3`}>
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
                onCopy={copy}
                onDownload={downloadVersion}
                downloadDisabled={!acknowledged}
                busyVersion={busyVersion}
              />
            )}
          </section>
        )}

        {verification && (
          <section
            className="glass-thin rounded-2xl p-4"
            aria-labelledby="dl-verify"
            data-testid="verify-panel"
          >
            <h3 id="dl-verify" className={sectionTitle}>
              {t('dlVerifyTitle')}
            </h3>
            <p className={sectionHelp}>{t('dlVerifyIntro')}</p>
            {verification.hash || verification.signature ? (
              <dl className="mt-3 space-y-2 text-xs">
                <div>
                  <dt className="font-semibold text-[color:var(--text-secondary)]">
                    {t('dlVerifyVersion')}
                  </dt>
                  <dd className="font-mono text-[color:var(--text-primary)]">
                    v{verification.version}
                  </dd>
                </div>
                {verification.hash && (
                  <div>
                    <dt className="font-semibold text-[color:var(--text-secondary)]">
                      {t('dlVerifyHash')}
                    </dt>
                    <dd className="break-all font-mono text-[color:var(--text-primary)]">
                      {verification.hash}
                    </dd>
                  </div>
                )}
                {verification.signature && (
                  <div>
                    <dt className="font-semibold text-[color:var(--text-secondary)]">
                      {t('dlVerifySignature')}
                    </dt>
                    <dd className="break-all font-mono text-[color:var(--text-primary)]">
                      {verification.signature}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-3 text-xs text-warning-fg">{t('dlVerifyNone')}</p>
            )}
            <p className={sectionHelp}>{t('dlVerifyHelp', { n: verification.version })}</p>
          </section>
        )}

        <details className="glass-thin rounded-2xl p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--text-secondary)]">
            {t('dlAdvanced')}
          </summary>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <h3 className={sectionTitle}>{t('downloadFullBundleTitle')}</h3>
              <p className={sectionHelp}>{t('downloadFullBundleHelp')}</p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-3 font-mono text-[11px] text-[color:var(--text-primary)]">
                  {networkUrl}
                </code>
                <button
                  type="button"
                  onClick={() => copy(networkUrl)}
                  aria-label={t('downloadModalCopyUrl')}
                  className="press-effect inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                >
                  <Icon name="content_copy" size={18} />
                </button>
              </div>
              <Button
                variant="secondary"
                disabled={busy || !acknowledged}
                onClick={downloadNetworkBundle}
                data-testid="download-bundle-btn"
                className="w-full"
              >
                {busy ? t('downloadModalDownloading') : t('downloadModalDownloadBundle')}
              </Button>
            </div>
            <div className="space-y-2">
              <h3 className={sectionTitle}>{t('downloadModalIpTitle')}</h3>
              <p className={sectionHelp}>{t('downloadModalIpDesc')}</p>
              <Button
                variant="secondary"
                onClick={downloadIpList}
                disabled={busy || !acknowledged}
                data-testid="download-ip-btn"
                className="w-full"
              >
                {busy ? t('downloadModalDownloading') : t('downloadModalDownloadIp')}
              </Button>
            </div>
            <BundlePreview instanceId={instanceId} />
          </div>
        </details>

        <p className="text-xs text-[color:var(--text-muted)]">
          {t('downloadModalPluginTip').split('DSF Allow List Plugin')[0]}
          <a
            href="https://github.com/datasharingframework/dsf-process-allow-list/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[color:var(--accent)] underline"
          >
            DSF Allow List Plugin
          </a>
          {t('downloadModalPluginTip').split('DSF Allow List Plugin')[1]}
        </p>

        <div className="flex justify-end border-t border-[color:var(--border)] pt-3">
          <Button variant="secondary" onClick={onClose}>
            {t('downloadModalClose')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
