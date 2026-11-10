/**
 * incident.schema.test.ts — the report form schema (title and description
 * lengths, escalation level, detection time not in the future), the Zulip
 * link (https only, empty allowed) and the datetime-local formatter.
 */
import { describe, it, expect } from 'vitest';
import {
  reportIncidentSchema,
  zulipUrlSchema,
  toLocalInputValue,
  type ReportIncidentForm,
} from '../incident.schema';

const valid: ReportIncidentForm = {
  organizationId: 'ukm.de',
  title: 'Suspicious logins',
  description: 'Logins from an unknown network',
  escalationLevel: '2',
  detectedAt: '2026-11-10T08:30',
  dpoInformed: false,
};

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('reportIncidentSchema', () => {
  it('accepts a complete report, also without a known site', () => {
    expect(reportIncidentSchema.safeParse(valid).success).toBe(true);
    expect(reportIncidentSchema.safeParse({ ...valid, organizationId: '' }).success).toBe(true);
  });

  it('needs a title of at least three characters', () => {
    expect(firstMessage(reportIncidentSchema.safeParse({ ...valid, title: ' ab ' }))).toBe(
      'incidentTitleTooShort',
    );
  });

  it('caps the title at 200 characters', () => {
    expect(firstMessage(reportIncidentSchema.safeParse({ ...valid, title: 'x'.repeat(201) }))).toBe(
      'incidentTitleTooLong',
    );
  });

  it('needs a description', () => {
    expect(firstMessage(reportIncidentSchema.safeParse({ ...valid, description: '  ' }))).toBe(
      'incidentDescriptionRequired',
    );
  });

  it('allows only escalation levels 1 to 3', () => {
    expect(reportIncidentSchema.safeParse({ ...valid, escalationLevel: '4' }).success).toBe(false);
  });

  it('refuses a detection time in the future', () => {
    const future = toLocalInputValue(new Date(Date.now() + 3_600_000));
    expect(firstMessage(reportIncidentSchema.safeParse({ ...valid, detectedAt: future }))).toBe(
      'incidentDetectedAtFuture',
    );
  });
});

describe('zulipUrlSchema', () => {
  it('accepts an empty value and https links', () => {
    expect(zulipUrlSchema.safeParse('').success).toBe(true);
    expect(zulipUrlSchema.safeParse('https://zulip.example.org/#narrow/stream/1').success).toBe(
      true,
    );
  });

  it('refuses plain http', () => {
    expect(firstMessage(zulipUrlSchema.safeParse('http://zulip.example.org'))).toBe(
      'incidentZulipHttps',
    );
  });
});

describe('toLocalInputValue', () => {
  it('formats local time for a datetime-local input', () => {
    expect(toLocalInputValue(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03');
  });
});
