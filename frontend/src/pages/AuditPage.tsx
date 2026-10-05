/**
 * AuditPage.tsx – Cross-instance audit log view
 * Shows events across ALL instances the user has access to (admin = all), with
 * filters, anomaly flags, expandable details and CSV/JSON export of the current filter.
 * Dependencies: useCrossInstanceAudit, useAuditSites, audit components, useI18n
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuditSites, useCrossInstanceAudit } from '../hooks/useAudit';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';
import { Button } from '../components/ui/Button';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { AuditEntryRow } from '../components/audit/AuditEntryRow';
import { AuditFilterBar } from '../components/audit/AuditFilterBar';
import { EMPTY_FILTERS, type AuditFilterForm } from '../components/audit/auditConfig';
import { AuditSummaryBar } from '../components/audit/AuditSummaryBar';
import { exportCrossInstanceAudit, type AuditFilters } from '../api/audit.api';

const TH = 'px-3 py-2.5 text-left text-[12px] font-bold text-[color:var(--text-secondary)]';
const COLUMNS = 7;
const TEXT_DEBOUNCE_MS = 300;

/** Local start / end of the picked day as ISO timestamps; undefined for an empty or invalid date. */
function dayBound(day: string, end: boolean): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toApiFilters(f: AuditFilterForm): AuditFilters {
  return {
    from: dayBound(f.from, false),
    to: dayBound(f.to, true),
    actor: f.actor.trim() || undefined,
    instanceId: f.instanceId || undefined,
    resource: f.resource || undefined,
    operation: f.operation || undefined,
    q: f.q.trim() || undefined,
    flaggedOnly: f.flaggedOnly || undefined,
  };
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<AuditFilterForm>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditFilterForm>(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const limit = 50;

  // Typing in the text filters should not fire a request per keystroke.
  useEffect(() => {
    if (form === applied) return;
    const id = setTimeout(() => {
      setApplied(form);
      setPage(1);
    }, TEXT_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [form, applied]);

  const filters = useMemo(() => toApiFilters(applied), [applied]);
  const isAdminViewer = me?.isAdmin === true;
  // Only query once admin is confirmed: a non-admin would otherwise fetch and
  // briefly render audit rows before the me-based redirect below resolves.
  const { data, isLoading, error } = useCrossInstanceAudit(page, limit, isAdminViewer, filters);
  const { data: sites } = useAuditSites(isAdminViewer);
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const summary = data?.meta.summary;
  const isAdmin = !!data?.meta.isAdmin;
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const filtersActive = JSON.stringify(applied) !== JSON.stringify(EMPTY_FILTERS);

  // When the dataset shrinks the current page can fall past the last page,
  // querying an empty page; clamp back into [1, totalPages].
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const onExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      const { blob, filename } = await exportCrossInstanceAudit(format, filters);
      saveBlob(blob, filename);
      toast.success(t('auditExportDone'));
    } catch {
      toast.error(t('auditExportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto font-sans">
      <AdminPageHeader
        icon="history"
        title={t('auditLog')}
        subtitle={isAdmin ? t('auditScopeAdmin') : t('auditScopeOwner')}
      />
      <div className="p-6 sm:p-8">
        <AuditFilterBar
          value={form}
          onChange={setForm}
          sites={sites ?? []}
          exporting={exporting}
          onExport={onExport}
        />

        {summary && <AuditSummaryBar summary={summary} />}

        {isLoading && <p className="text-sm text-[color:var(--text-muted)]">{t('loading')}</p>}
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {t('auditLoadFailed')}
          </p>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <p className="text-sm text-[color:var(--text-muted)]">
            {filtersActive ? t('auditNoEntries') : t('auditEmpty')}
          </p>
        )}

        {rows.length > 0 && (
          <>
            <p className="mb-2 text-[12px] text-[color:var(--text-muted)]">
              {t('auditShowing', { total })}
            </p>
            <div className="glass-thin overflow-x-auto rounded-2xl">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-[color:var(--bg-hover)]">
                    <th className={TH}>{t('auditColTimestamp')}</th>
                    <th className={TH}>{t('auditColEvent')}</th>
                    <th className={TH}>{t('auditColUser')}</th>
                    <th className={TH}>{t('auditColInstance')}</th>
                    <th className={TH}>{t('auditColResource')}</th>
                    <th className={TH}>{t('auditColOperation')}</th>
                    <th className={TH}>{t('auditColIp')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <AuditEntryRow
                      key={r.id}
                      entry={r}
                      expanded={expanded.has(r.id)}
                      onToggle={() => toggle(r.id)}
                      colSpan={COLUMNS}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-end gap-3 text-[12px]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
            >
              {t('prev')}
            </Button>
            <span className="text-[color:var(--text-secondary)]">
              {t('paginationShowing', { page, total: totalPages })}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
            >
              {t('next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
