/**
 * nis2Fields.test.ts — completeness of the NIS2 report fields per stage and
 * the stage-to-fields mapping (the progress report shares the final report's).
 */
import { describe, it, expect } from 'vitest';
import { FIELD_STAGE_OF, isNis2StageComplete, missingNis2Fields } from '../nis2Fields';

describe('missingNis2Fields', () => {
  it('names the required fields that are empty or blank', () => {
    expect(
      missingNis2Fields('EARLY_WARNING', { suspectedMalicious: 'yes', affectedServices: ' ' }),
    ).toEqual(['crossBorder', 'affectedServices']);
    expect(missingNis2Fields('FINAL_REPORT', null)).toEqual([
      'rootCause',
      'mitigation',
      'crossBorderFinal',
    ]);
  });

  it('does not require the indicators of compromise', () => {
    expect(isNis2StageComplete('NOTIFICATION', { severity: 'high', impact: 'Offline' })).toBe(true);
    expect(isNis2StageComplete('NOTIFICATION', { severity: 'high' })).toBe(false);
  });
});

describe('FIELD_STAGE_OF', () => {
  it('lets the progress report use the final report fields and gives the interim report none', () => {
    expect(FIELD_STAGE_OF.PROGRESS_REPORT).toBe('FINAL_REPORT');
    expect(FIELD_STAGE_OF.INTERIM_REPORT).toBeUndefined();
  });
});
