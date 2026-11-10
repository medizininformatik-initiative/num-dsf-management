/**
 * IncidentCommentForm.tsx – the admin's free-text entry for the timeline:
 * measures taken outside the portal, calls, findings. No step-up; the text
 * becomes a COMMENT event that everyone who can see the incident reads.
 * Dependencies: FormField, Button, Icon, useCommentIncident, incidentErrors,
 * incident.schema limits, i18n store, sonner.
 */
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useCommentIncident } from '../../hooks/useIncidentActions';
import { INCIDENT_TEXT_MAX } from '../../schemas/incident.schema';
import { useI18n } from '../../stores/i18n.store';
import { FormField, inputClass } from '../modals/FormField';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { incidentErrorMessage } from './incidentErrors';

export function IncidentCommentForm({ incidentId }: { incidentId: string }) {
  const { t } = useI18n();
  const headingId = useId();
  const [text, setText] = useState('');
  const comment = useCommentIncident(incidentId);
  const trimmed = text.trim();

  return (
    <section aria-labelledby={headingId} className="surface-card p-5">
      <h3 id={headingId} className="text-base font-semibold text-[color:var(--text-primary)]">
        {t('incidentCommentTitle')}
      </h3>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed || comment.isPending) return;
          comment.mutate(trimmed, {
            onSuccess: () => {
              setText('');
              toast.success(t('incidentCommentAdded'));
            },
            onError: (err) => toast.error(incidentErrorMessage(err, t('genericActionFailed'), t)),
          });
        }}
      >
        <FormField label={t('incidentEventCOMMENT')} hint={t('incidentCommentHint')}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={INCIDENT_TEXT_MAX}
            className={`${inputClass} resize-y`}
          />
        </FormField>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!trimmed || comment.isPending}>
            <Icon name="add_comment" size={16} />
            {t('incidentCommentSubmit')}
          </Button>
        </div>
      </form>
    </section>
  );
}
