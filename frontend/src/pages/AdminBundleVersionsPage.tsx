/**
 * AdminBundleVersionsPage.tsx – Admin bundle-version history with download
 * + diff. Two version pickers (A / B, toggle buttons); the diff card appears
 * once both are selected. Dates follow the app language; rows enter staggered.
 * Dependencies: bundleVersions.api, i18n store, lib/dateUtils, AdminPageHeader,
 * Button, StatusPill, Icon, Skeleton, TanStack Query.
 */
import { useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bundleVersionsApi, type BundleVersionListRow } from '../api/bundleVersions.api';
import { useI18n } from '../stores/i18n.store';
import { formatDateTime } from '../lib/dateUtils';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { Icon } from '../components/ui/Icon';
import { Skeleton } from '../components/ui/Skeleton';

export function AdminBundleVersionsPage() {
  const { t, lang } = useI18n();
  const [selA, setSelA] = useState<string | null>(null);
  const [selB, setSelB] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['bundle-versions'],
    queryFn: () => bundleVersionsApi.list().then((r) => r.data),
  });

  const diff = useQuery({
    queryKey: ['bundle-versions-diff', selA, selB],
    queryFn: () => bundleVersionsApi.diff(selA!, selB!).then((r) => r.data.data),
    enabled: !!selA && !!selB && selA !== selB,
  });

  const rows = list.data?.data ?? [];

  return (
    <div className="flex-1 overflow-y-auto" data-testid="admin-bundle-versions">
      <AdminPageHeader
        icon="history"
        title={t('bundleVersionsTitle')}
        subtitle={t('bundleVersionsIntro')}
      />

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 sm:px-8">
        {list.isLoading ? (
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5">
            <Skeleton lines={4} />
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[color:var(--border)] p-4 text-sm italic text-[color:var(--text-muted)]">
            {t('bundleVersionsEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)]">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="bg-[color:var(--bg-hover)]">
                <tr className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  <th className="px-4 py-2.5">{t('bundleVersionsColVersion')}</th>
                  <th className="px-4 py-2.5">{t('createdAt')}</th>
                  <th className="px-4 py-2.5">{t('triggeredBy')}</th>
                  <th className="px-4 py-2.5">{t('triggeredByEmail')}</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">{t('details')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: BundleVersionListRow, i) => (
                  <tr
                    key={r.id}
                    style={{ '--stagger-index': i } as CSSProperties}
                    className="animate-list-item-in border-t border-[color:var(--border)]"
                  >
                    <td className="px-4 py-2.5 font-mono font-semibold text-[color:var(--text-primary)]">
                      v{r.version_number}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[color:var(--text-secondary)]">
                      {formatDateTime(r.created_at, lang)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[color:var(--text-secondary)]">
                      {r.triggered_by}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[color:var(--text-muted)]">
                      {r.triggered_by_email}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5 whitespace-nowrap">
                        <a
                          href={bundleVersionsApi.downloadUrl(r.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm btn-ghost press-effect"
                        >
                          <Icon name="download" size={16} />
                          {t('download')}
                        </a>
                        <Button
                          size="sm"
                          variant={selA === r.id ? 'primary' : 'secondary'}
                          aria-pressed={selA === r.id}
                          onClick={() => setSelA(r.id)}
                        >
                          {t('diffPickA')}
                        </Button>
                        <Button
                          size="sm"
                          variant={selB === r.id ? 'primary' : 'secondary'}
                          aria-pressed={selB === r.id}
                          onClick={() => setSelB(r.id)}
                        >
                          {t('diffPickB')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selA && selB && selA !== selB && (
          <section
            className="animate-fade-in rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5"
            data-testid="bundle-versions-diff"
          >
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-[color:var(--text-primary)]">
              <Icon name="difference" size={20} />
              {t('diff')}
            </h2>
            {diff.isLoading ? (
              <Skeleton lines={2} />
            ) : diff.data ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="success" icon="add">
                    {t('added')}: {diff.data.added.length}
                  </StatusPill>
                  <StatusPill tone="danger" icon="remove">
                    {t('removed')}: {diff.data.removed.length}
                  </StatusPill>
                  <StatusPill tone="warning" icon="edit">
                    {t('changed')}: {diff.data.changed.length}
                  </StatusPill>
                </div>
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-medium text-[color:var(--text-secondary)]">
                    {t('details')}
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-[color:var(--bg-hover)] p-3 font-mono text-[11px] text-[color:var(--text-primary)]">
                    {JSON.stringify(diff.data, null, 2)}
                  </pre>
                </details>
              </>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
