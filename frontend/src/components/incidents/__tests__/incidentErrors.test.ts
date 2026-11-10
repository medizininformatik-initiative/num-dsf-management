/**
 * incidentErrors.test.ts — incident refusal codes map to their own message, a
 * certificate step-up failure to the shared one, anything else to the backend
 * message or the fallback.
 */
import { describe, it, expect } from 'vitest';
import { incidentErrorMessage } from '../incidentErrors';

const t = (key: string) => `t:${key}`;
const apiError = (code: string, message?: string) => ({
  response: { data: { error: { code, message } } },
});

describe('incidentErrorMessage', () => {
  it('words the incident refusals', () => {
    expect(incidentErrorMessage(apiError('STILL_SUSPENDED'), 'fb', t)).toBe(
      't:incidentErrorSTILL_SUSPENDED',
    );
    expect(incidentErrorMessage(apiError('ALREADY_ACKNOWLEDGED'), 'fb', t)).toBe(
      't:incidentErrorALREADY_ACKNOWLEDGED',
    );
  });

  it('uses the shared step-up message', () => {
    expect(incidentErrorMessage(apiError('CERT_STEP_UP_FAILED'), 'fb', t)).toBe(
      't:certStepUpFailedToast',
    );
  });

  it('falls back to the backend message, then the fallback', () => {
    expect(incidentErrorMessage(apiError('TOTP_INVALID', 'Invalid code'), 'fb', t)).toBe(
      'Invalid code',
    );
    expect(incidentErrorMessage(new Error('network'), 'fb', t)).toBe('fb');
  });
});
