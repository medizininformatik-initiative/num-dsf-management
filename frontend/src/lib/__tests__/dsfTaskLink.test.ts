import { describe, it, expect } from 'vitest';
import { dsfTaskSearchUrl, dsfTaskDisplayUrl, TASK_IDENTIFIER } from '../dsfTaskLink';

const READABLE =
  '/Task?identifier=http://dsf.dev/sid/task-identifier|http://dsf.dev/bpe/Process/downloadAllowList/1.0/task-download-allow-list&status=draft';
const ENCODED = `/Task?identifier=${encodeURIComponent(TASK_IDENTIFIER)}&status=draft`;

describe('dsfTaskDisplayUrl', () => {
  it('shows the identifier form of the old tool, readable', () => {
    expect(dsfTaskDisplayUrl('https://dsf-fhir.uni-muenster.example.de/fhir')).toBe(
      `https://dsf-fhir.uni-muenster.example.de/fhir${READABLE}`,
    );
  });

  it('strips trailing slashes, keeps ports and http bases, drops query and fragment', () => {
    expect(dsfTaskDisplayUrl('https://fhir.klinik.example.de/fhir/')).toBe(
      `https://fhir.klinik.example.de/fhir${READABLE}`,
    );
    expect(dsfTaskDisplayUrl('http://localhost:8080/fhir')).toBe(
      `http://localhost:8080/fhir${READABLE}`,
    );
    expect(dsfTaskDisplayUrl('https://a.example.de/fhir?x=1#top')).toBe(
      `https://a.example.de/fhir${READABLE}`,
    );
  });
});

describe('dsfTaskSearchUrl', () => {
  it('builds the draft Task search on the FHIR base with an encoded identifier', () => {
    const url = dsfTaskSearchUrl('https://fhir.klinik.example.de/fhir');
    expect(url).toBe(`https://fhir.klinik.example.de/fhir${ENCODED}`);
    expect(url).toContain('identifier=http%3A%2F%2Fdsf.dev%2Fsid%2Ftask-identifier%7Chttp');
    expect(url).toContain('&status=draft');
  });

  it('strips trailing slashes', () => {
    expect(dsfTaskSearchUrl('https://fhir.klinik.example.de/fhir/')).toBe(
      `https://fhir.klinik.example.de/fhir${ENCODED}`,
    );
    expect(dsfTaskSearchUrl('https://fhir.klinik.example.de')).toBe(
      `https://fhir.klinik.example.de${ENCODED}`,
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
    expect(dsfTaskDisplayUrl(value)).toBeNull();
  });
});
