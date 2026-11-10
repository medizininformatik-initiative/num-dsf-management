/**
 * IncidentExportButtons.tsx – the admin's export of one incident for an
 * authority request, as JSON ({ exportedAt, exportedBy, incident, events,
 * chain }) or CSV (one row per event with the hash values). The file name
 * comes from the response's Content-Disposition, else incident-<id>.<format>.
 * Dependencies: incidents.api, lib/downloadBlob, getErrorMessage, Button,
 * Icon, i18n store, sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { incidentsApi, type ExportFormat } from '../../api/incidents.api';
import { headerValue, saveBlob, toBlob } from '../../lib/downloadBlob';
import { getErrorMessage } from '../../lib/getErrorMessage';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

const MIME: Record<ExportFormat, string> = { json: 'application/json', csv: 'text/csv' };

/** filename="…" (or filename*=UTF-8''…) from a Content-Disposition header. */
export function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

export function IncidentExportButtons({ incidentId }: { incidentId: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  async function download(format: ExportFormat) {
    setBusy(format);
    try {
      const res = await incidentsApi.export(incidentId, format);
      const name =
        dispositionFilename(headerValue(res.headers, 'content-disposition')) ??
        `incident-${incidentId}.${format}`;
      saveBlob(toBlob(res.data, MIME[format]), name);
    } catch (err) {
      toast.error(getErrorMessage(err, t('incidentExportFailed')));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy !== null}
        onClick={() => download('json')}
      >
        <Icon name="download" size={16} />
        {t('incidentExportJson')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy !== null}
        onClick={() => download('csv')}
      >
        <Icon name="table_view" size={16} />
        {t('incidentExportCsv')}
      </Button>
    </>
  );
}
