/**
 * MeasureChecklist.tsx – the four suspension measures as a labelled checkbox
 * group (block thumbprints, remove logins and end sessions, withdraw from the
 * allow list and publish, mail all sites). The caller owns the selection;
 * all four are on by default where it is used.
 * Dependencies: FormFieldGroup, checkboxClass, incidentLabels, i18n store.
 */
import { SUSPEND_MEASURES, type SuspendMeasure } from '../../api/incidents.api';
import { useI18n } from '../../stores/i18n.store';
import { FormFieldGroup, checkboxClass } from '../modals/FormField';
import { MEASURE_KEY } from './incidentLabels';

interface MeasureChecklistProps {
  value: SuspendMeasure[];
  onChange: (next: SuspendMeasure[]) => void;
  disabled?: boolean;
}

export function MeasureChecklist({ value, onChange, disabled = false }: MeasureChecklistProps) {
  const { t } = useI18n();
  return (
    <FormFieldGroup
      label={t('incidentMeasuresLabel')}
      required
      error={value.length === 0 ? t('incidentMeasuresRequired') : undefined}
    >
      <div className="space-y-2">
        {SUSPEND_MEASURES.map((measure) => (
          <label
            key={measure}
            className="flex cursor-pointer items-start gap-3 text-sm text-[color:var(--text-primary)]"
          >
            <input
              type="checkbox"
              checked={value.includes(measure)}
              disabled={disabled}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? SUSPEND_MEASURES.filter((m) => m === measure || value.includes(m))
                    : value.filter((m) => m !== measure),
                )
              }
              className={`mt-0.5 ${checkboxClass}`}
            />
            {t(MEASURE_KEY[measure])}
          </label>
        ))}
      </div>
    </FormFieldGroup>
  );
}
