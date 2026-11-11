/**
 * nis2-report-schema.test.ts – The structured report fields per NIS2 stage:
 * complete sets for ticking, partial drafts for saving, unknown keys and
 * oversized or control-character texts refused, missing-field names.
 * Pure test: no database.
 * Dependencies: schemas/nis2Report.schema
 */
import {
  interimRequestSchema,
  missingNis2Fields,
  nis2CompleteSchema,
  nis2DraftSchema,
} from '../schemas/nis2Report.schema';

describe('nis2 report schemas', () => {
  it('accepts a complete early warning and refuses a missing field', () => {
    const full = { suspectedMalicious: 'yes', crossBorder: 'unknown', affectedServices: 'BPE' };
    expect(nis2CompleteSchema.EARLY_WARNING.safeParse(full).success).toBe(true);
    expect(missingNis2Fields('EARLY_WARNING', full)).toEqual([]);
    expect(missingNis2Fields('EARLY_WARNING', { suspectedMalicious: 'no' })).toEqual([
      'crossBorder',
      'affectedServices',
    ]);
    expect(missingNis2Fields('EARLY_WARNING', undefined)).toEqual([
      'suspectedMalicious',
      'crossBorder',
      'affectedServices',
    ]);
  });

  it('treats the indicators of compromise as optional and the severity as an enum', () => {
    const base = { severity: 'high', impact: 'FHIR endpoint down' };
    expect(nis2CompleteSchema.NOTIFICATION.safeParse(base).success).toBe(true);
    expect(nis2CompleteSchema.NOTIFICATION.safeParse({ ...base, iocs: '' }).success).toBe(true);
    expect(missingNis2Fields('NOTIFICATION', { ...base, severity: 'severe' })).toEqual([
      'severity',
    ]);
  });

  it('needs root cause, mitigation and the cross-border answer for the final report', () => {
    expect(missingNis2Fields('FINAL_REPORT', { rootCause: '  ', mitigation: 'x' })).toEqual([
      'rootCause',
      'crossBorderFinal',
    ]);
  });

  it('accepts partial drafts and rejects unknown keys', () => {
    expect(nis2DraftSchema.NOTIFICATION.safeParse({ impact: 'x' }).success).toBe(true);
    expect(nis2DraftSchema.NOTIFICATION.safeParse({ impact: '' }).success).toBe(true);
    expect(nis2DraftSchema.NOTIFICATION.safeParse({ other: 'x' }).success).toBe(false);
    expect(nis2DraftSchema.EARLY_WARNING.safeParse({ crossBorder: 'maybe' }).success).toBe(false);
  });

  it('caps the length and refuses control characters but keeps line breaks', () => {
    expect(
      nis2DraftSchema.EARLY_WARNING.safeParse({ affectedServices: 'a'.repeat(501) }).success,
    ).toBe(false);
    expect(nis2DraftSchema.NOTIFICATION.safeParse({ iocs: 'a\u0000b' }).success).toBe(false);
    const multiline = nis2DraftSchema.NOTIFICATION.safeParse({ iocs: '1.2.3.4\r\nevil.example' });
    expect(multiline.success).toBe(true);
  });

  it('validates the interim report request date', () => {
    const now = new Date();
    expect(interimRequestSchema.safeParse({ requestedAt: now.toISOString() }).success).toBe(true);
    const future = new Date(now.getTime() + 3_600_000).toISOString();
    expect(interimRequestSchema.safeParse({ requestedAt: future }).success).toBe(false);
    expect(interimRequestSchema.safeParse({ requestedAt: 'yesterday' }).success).toBe(false);
  });
});
