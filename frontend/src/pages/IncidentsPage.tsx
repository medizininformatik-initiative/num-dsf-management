/**
 * IncidentsPage.tsx – /app/incidents: the security incidents every signed-in
 * user may see (confirmed incidents of the network and their own reports)
 * with status, site, date, NIS2 duties and the timeline of measures taken.
 * The description only appears when the API returns it. ?id= opens one
 * incident; the site mails link here.
 * Dependencies: IncidentWorkspace, i18n store.
 */
import { IncidentWorkspace } from '../components/incidents/IncidentWorkspace';
import { useI18n } from '../stores/i18n.store';

export function IncidentsPage() {
  const { t } = useI18n();
  return (
    <IncidentWorkspace
      title={t('incidentsTitle')}
      subtitle={t('incidentsSubtitle')}
      testId="incidents-page"
    />
  );
}
