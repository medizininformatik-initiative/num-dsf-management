/**
 * nis2Report.schema.test.ts — the NIS2 report fields form: lengths, stored
 * values into the form, and the request body per stage (own fields only,
 * choices only when made, texts trimmed and empty texts sent to clear them).
 */
import { describe, it, expect } from 'vitest';
import { nis2FieldsFormSchema, toFormValues, toRequestBody } from '../nis2Report.schema';

describe('nis2FieldsFormSchema', () => {
  it('accepts an empty draft and refuses over-long texts', () => {
    expect(nis2FieldsFormSchema.safeParse(toFormValues(null)).success).toBe(true);
    const tooLong = nis2FieldsFormSchema.safeParse({
      ...toFormValues(null),
      affectedServices: 'a'.repeat(501),
    });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) expect(tooLong.error.issues[0].message).toBe('incidentNis2TextTooLong');
  });
});

describe('toRequestBody', () => {
  it('sends only the stage fields, skipping choices that were not made', () => {
    const form = { ...toFormValues(null), crossBorder: 'no', affectedServices: ' BPE ' };
    expect(toRequestBody('EARLY_WARNING', form)).toEqual({
      crossBorder: 'no',
      affectedServices: 'BPE',
    });
  });

  it('sends an emptied text so the backend clears it', () => {
    const form = toFormValues({ severity: 'high', impact: 'x', iocs: '' });
    expect(toRequestBody('NOTIFICATION', { ...form, impact: '  ' })).toEqual({
      severity: 'high',
      impact: '',
      iocs: '',
    });
  });

  it('sends the final report fields', () => {
    const form = toFormValues({
      rootCause: 'Phishing',
      mitigation: 'Reset',
      crossBorderFinal: 'no',
    });
    expect(toRequestBody('FINAL_REPORT', form)).toEqual({
      rootCause: 'Phishing',
      mitigation: 'Reset',
      crossBorderFinal: 'no',
    });
  });
});
