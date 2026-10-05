import { describe, it, expect } from 'vitest';
import { dsfTaskSearchUrl, TASK_PROFILE } from '../dsfTaskLink';

const SUFFIX = `/Task?_profile=${encodeURIComponent(TASK_PROFILE)}&status=draft`;

describe('dsfTaskSearchUrl', () => {
  it('builds the draft Task search on the FHIR base', () => {
    expect(dsfTaskSearchUrl('https://fhir.klinik.example.de/fhir')).toBe(
      `https://fhir.klinik.example.de/fhir${SUFFIX}`,
    );
  });

  it('strips trailing slashes', () => {
    expect(dsfTaskSearchUrl('https://fhir.klinik.example.de/fhir/')).toBe(
      `https://fhir.klinik.example.de/fhir${SUFFIX}`,
    );
    expect(dsfTaskSearchUrl('https://fhir.klinik.example.de')).toBe(
      `https://fhir.klinik.example.de${SUFFIX}`,
    );
  });

  it('encodes the profile URL', () => {
    expect(dsfTaskSearchUrl('https://a.example.de/fhir')).toContain(
      '_profile=http%3A%2F%2Fdsf.dev%2Ffhir%2FStructureDefinition%2Ftask-download-allow-list',
    );
  });

  it('accepts http bases and keeps a port', () => {
    expect(dsfTaskSearchUrl('http://localhost:8080/fhir')).toBe(
      `http://localhost:8080/fhir${SUFFIX}`,
    );
  });

  it('drops query and fragment of the base', () => {
    expect(dsfTaskSearchUrl('https://a.example.de/fhir?x=1#top')).toBe(
      `https://a.example.de/fhir${SUFFIX}`,
    );
  });

  it.each([
    '',
    '   ',
    null,
    undefined,
    'not a url',
    'ftp://a.example.de/fhir',
    'javascript:alert(1)',
    'https://user:pw@a.example.de/fhir',
  ])('returns null for %p', (value) => {
    expect(dsfTaskSearchUrl(value)).toBeNull();
  });
});
