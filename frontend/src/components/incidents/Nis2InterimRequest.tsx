/**
 * Nis2InterimRequest.tsx – records that the BSI asked for an interim report
 * (Zwischenmeldung) and on which date; only then can the stage be ticked as
 * reported. The date defaults to now and must not lie in the future. A new
 * request before the tick replaces the date.
 * Dependencies: useRequestNis2Interim, incident.schema
 * (toLocalInputValue), FormField primitives, Button, i18n store, incidentErrors,
 * sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useRequestNis2Interim } from '../../hooks/useIncidentActions';
import { toLocalInputValue } from '../../schemas/incident.schema';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { FormField, inputClass } from '../modals/FormField';
import { incidentErrorMessage } from './incidentErrors';

export function Nis2InterimRequest({
  incidentId,
  requestedAt,
}: {
  incidentId: string;
  requestedAt: string | null;
}) {
  const { t } = useI18n();
  const request = useRequestNis2Interim(incidentId);
  const [value, setValue] = useState(() => toLocalInputValue(new Date(requestedAt ?? Date.now())));
  const [error, setError] = useState<string | undefined>();

  function submit() {
    const time = new Date(value).getTime();
    if (!value || Number.isNaN(time)) return setError('incidentNis2RequestRequired');
    if (time > Date.now() + 60_000) return setError('incidentNis2RequestFuture');
    setError(undefined);
    request.mutate(new Date(value).toISOString(), {
      onSuccess: () => toast.success(t('incidentNis2RequestSaved')),
      onError: (err) => toast.error(incidentErrorMessage(err, t('incidentAckFailed'), t)),
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2" data-testid="nis2-interim-request">
      <FormField label={t('incidentNis2RequestedAtLabel')} error={error}>
        <input
          type="datetime-local"
          value={value}
          max={toLocalInputValue(new Date())}
          onChange={(e) => setValue(e.target.value)}
          className={inputClass}
        />
      </FormField>
      <Button variant="secondary" size="sm" disabled={request.isPending} onClick={submit}>
        {t('incidentNis2RequestSave')}
      </Button>
    </div>
  );
}
