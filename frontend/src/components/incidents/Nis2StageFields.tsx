/**
 * Nis2StageFields.tsx – the compact form of one NIS2 stage's report fields
 * (BSIG § 32): the answers and texts the site would enter into the BSI form.
 * Saving is a draft (nothing is required to save); the stage can be ticked as
 * reported only when the required fields are saved, which Nis2Panel checks.
 * Once the stage is reported the fields are a record and read-only. The form
 * restarts from the saved values whenever they change. Field texts are
 * rendered as typed, never as markup.
 * Dependencies: useSaveNis2Fields, lib/nis2Fields, schemas/nis2Report.schema,
 * FormField primitives, Button, i18n store, incidentErrors, React Hook Form,
 * Zod, sonner.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { Nis2FieldStage, Nis2Stage } from '../../api/incidents.api';
import { useSaveNis2Fields } from '../../hooks/useIncidentActions';
import { NIS2_FIELD_DEFS, type Nis2FieldDef } from '../../lib/nis2Fields';
import {
  nis2FieldsFormSchema,
  toFormValues,
  toRequestBody,
  type Nis2FieldsForm,
} from '../../schemas/nis2Report.schema';
import type { TranslationKey } from '../../i18n/en';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { FormField, fieldHintClass, inputClass, selectClass } from '../modals/FormField';
import { incidentErrorMessage } from './incidentErrors';

const LABEL_KEY: Record<keyof Nis2FieldsForm, TranslationKey> = {
  suspectedMalicious: 'incidentNis2FieldSuspectedMalicious',
  crossBorder: 'incidentNis2FieldCrossBorder',
  affectedServices: 'incidentNis2FieldAffectedServices',
  severity: 'incidentNis2FieldSeverity',
  impact: 'incidentNis2FieldImpact',
  iocs: 'incidentNis2FieldIocs',
  rootCause: 'incidentNis2FieldRootCause',
  mitigation: 'incidentNis2FieldMitigation',
  crossBorderFinal: 'incidentNis2FieldCrossBorderFinal',
};

const TRI_OPTIONS: Array<[string, TranslationKey]> = [
  ['yes', 'incidentNis2Yes'],
  ['no', 'incidentNis2No'],
  ['unknown', 'incidentNis2Unknown'],
];

const SEVERITY_OPTIONS: Array<[string, TranslationKey]> = [
  ['low', 'incidentNis2SeverityLow'],
  ['medium', 'incidentNis2SeverityMedium'],
  ['high', 'incidentNis2SeverityHigh'],
  ['critical', 'incidentNis2SeverityCritical'],
];

interface Props {
  incidentId: string;
  /** The stage shown (the progress report shows the final report's fields). */
  stage: Nis2Stage;
  fieldStage: Nis2FieldStage;
  values: Record<string, string>;
  /** The stage was reported to the BSI: the fields are a record. */
  locked: boolean;
  /** The progress and the final report share these fields. */
  shared: boolean;
}

export function Nis2StageFields({ incidentId, stage, fieldStage, values, locked, shared }: Props) {
  const { t } = useI18n();
  const save = useSaveNis2Fields(incidentId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<Nis2FieldsForm>({
    resolver: zodResolver(nis2FieldsFormSchema),
    defaultValues: toFormValues(values),
  });
  const saved = JSON.stringify(values);
  useEffect(() => {
    reset(toFormValues(JSON.parse(saved) as Record<string, string>));
  }, [saved, reset]);

  const onSubmit = handleSubmit((form) => {
    save.mutate(
      { stage, fields: toRequestBody(fieldStage, form) },
      {
        onSuccess: () => toast.success(t('incidentNis2FieldsSaved')),
        onError: (err) => toast.error(incidentErrorMessage(err, t('incidentNis2FieldsFailed'), t)),
      },
    );
  });

  function control(def: Nis2FieldDef) {
    const name = def.key as keyof Nis2FieldsForm;
    if (def.kind === 'tri' || def.kind === 'severity') {
      const options = def.kind === 'tri' ? TRI_OPTIONS : SEVERITY_OPTIONS;
      return (
        <select {...register(name)} disabled={locked} className={selectClass}>
          <option value="">{t('incidentNis2Select')}</option>
          {options.map(([value, key]) => (
            <option key={value} value={value}>
              {t(key)}
            </option>
          ))}
        </select>
      );
    }
    if (def.kind === 'line') {
      return (
        <input
          {...register(name)}
          disabled={locked}
          maxLength={def.max}
          autoComplete="off"
          className={inputClass}
        />
      );
    }
    return (
      <textarea
        {...register(name)}
        disabled={locked}
        rows={3}
        maxLength={def.max}
        className={`${inputClass} resize-y`}
      />
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mt-3 space-y-3 rounded-lg border border-[color:var(--border)] p-3"
      data-testid={`nis2-fields-${stage}`}
    >
      {NIS2_FIELD_DEFS[fieldStage].map((def) => (
        <FormField
          key={def.key}
          label={t(LABEL_KEY[def.key as keyof Nis2FieldsForm])}
          required={def.required}
          error={errors[def.key as keyof Nis2FieldsForm]?.message}
        >
          {control(def)}
        </FormField>
      ))}
      {shared && <p className={fieldHintClass}>{t('incidentNis2FieldsSharedFinal')}</p>}
      {locked ? (
        <p className={fieldHintClass}>{t('incidentNis2FieldsLocked')}</p>
      ) : (
        <Button type="submit" variant="secondary" size="sm" disabled={save.isPending || !isDirty}>
          {t('incidentNis2FieldsSave')}
        </Button>
      )}
    </form>
  );
}
