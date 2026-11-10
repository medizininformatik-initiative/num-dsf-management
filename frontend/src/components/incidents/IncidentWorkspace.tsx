/**
 * IncidentWorkspace.tsx – the list-and-detail layout both incident pages
 * share: the sticky page header, the incident list on the left and the
 * selected incident on the right (stacked on narrow screens, with a link back
 * to the list). The selection lives in the URL as ?id=, the form the incident
 * mails link to, so a mailed link opens the incident directly and survives a
 * reload.
 * Dependencies: useIncidents, AdminPageHeader, IncidentList, IncidentDetail,
 * Icon, i18n store, react-router.
 */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IncidentDetail as IncidentDetailData } from '../../api/incidents.api';
import { useIncidents } from '../../hooks/useIncidents';
import { useI18n } from '../../stores/i18n.store';
import { AdminPageHeader } from '../admin/AdminPageHeader';
import { Icon } from '../ui/Icon';
import { IncidentDetail } from './IncidentDetail';
import { IncidentList } from './IncidentList';

interface IncidentWorkspaceProps {
  title: string;
  subtitle: string;
  /** Header controls, e.g. "Report incident". */
  actions?: ReactNode;
  renderAdmin?: (detail: IncidentDetailData) => ReactNode;
  testId: string;
}

export function IncidentWorkspace({
  title,
  subtitle,
  actions,
  renderAdmin,
  testId,
}: IncidentWorkspaceProps) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const { data, isLoading, isError } = useIncidents();

  return (
    <div className="flex-1 scroll-pt-24 overflow-y-auto" data-testid={testId}>
      <AdminPageHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
        <div className={selectedId ? 'hidden lg:block' : ''}>
          <IncidentList
            incidents={data ?? []}
            isLoading={isLoading}
            isError={isError}
            selectedId={selectedId}
            onSelect={(id) => setParams({ id })}
          />
        </div>
        <div className="min-w-0">
          {selectedId ? (
            <>
              <button
                type="button"
                onClick={() => setParams({}, { replace: true })}
                className="press-effect mb-3 inline-flex items-center gap-1 rounded-control px-1 py-0.5 text-sm font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] lg:hidden"
              >
                <Icon name="arrow_back" size={16} />
                {t('incidentDetailBack')}
              </button>
              <IncidentDetail id={selectedId} renderAdmin={renderAdmin} />
            </>
          ) : (
            <p className="hidden items-center gap-2 rounded-card border border-dashed border-[color:var(--border)] p-6 text-sm text-[color:var(--text-muted)] lg:flex">
              <Icon name="left_click" size={18} className="shrink-0" />
              {t('incidentSelectHint')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
