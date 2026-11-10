/**
 * AdminIncidentsPage.tsx – /app/admin/incidents: the admin incident register.
 * Every incident (open first), the selected one (?id=, the form the admin
 * mails link to) with the admin actions, and "New incident" to record one
 * directly, e.g. after a phone call. Non-admins are sent to /app/incidents
 * with the same ?id=; the backend refuses the admin routes anyway.
 * Dependencies: IncidentWorkspace, IncidentAdminPanel, ReportIncidentDialog,
 * useMe, Button, Icon, i18n store, react-router.
 */
import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { IncidentAdminPanel } from '../components/incidents/IncidentAdminPanel';
import { IncidentWorkspace } from '../components/incidents/IncidentWorkspace';
import { ReportIncidentDialog } from '../components/incidents/ReportIncidentDialog';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';

export function AdminIncidentsPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { search } = useLocation();
  const [reporting, setReporting] = useState(false);
  if (me && !me.isAdmin) return <Navigate to={`/app/incidents${search}`} replace />;

  return (
    <>
      <IncidentWorkspace
        title={t('incidentsAdminTitle')}
        subtitle={t('incidentsAdminSubtitle')}
        testId="admin-incidents"
        actions={
          <Button size="sm" onClick={() => setReporting(true)}>
            <Icon name="add" size={16} />
            {t('incidentAdminNew')}
          </Button>
        }
        renderAdmin={me?.isAdmin ? (detail) => <IncidentAdminPanel detail={detail} /> : undefined}
      />
      <ReportIncidentDialog open={reporting} onClose={() => setReporting(false)} />
    </>
  );
}
