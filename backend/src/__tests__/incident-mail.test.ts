/**
 * incident-mail.test.ts – The incident mail names title, site, level and the
 * portal link in both languages, escapes HTML and never carries anything
 * beyond its context (the description is not even an input).
 * Pure test: no transport.
 * Dependencies: services/mail-templates/incident-mail
 */
import {
  renderIncidentMail,
  type IncidentMailContext,
} from '../services/mail-templates/incident-mail';

const base: IncidentMailContext = {
  event: 'confirmed',
  environment: 'TEST',
  title: 'Compromised DSF BPE',
  site: 'Site A (a.example.de)',
  escalationLevel: 3,
  actor: 'admin@imi-test.example.de',
  link: 'https://portal.example.de/app/incidents/abc',
};

describe('renderIncidentMail', () => {
  it('names title, site, level and link in both languages', () => {
    const { subject, text, html } = renderIncidentMail(base);
    expect(subject).toContain('Sicherheitsvorfall bestätigt / Security incident confirmed');
    expect(subject).toContain('Compromised DSF BPE');
    for (const body of [text, html]) {
      expect(body).toContain('Site A (a.example.de)');
      expect(body).toContain('3');
      expect(body).toContain('https://portal.example.de/app/incidents/abc');
    }
  });

  it('shows the published allow-list version of a suspension', () => {
    expect(renderIncidentMail({ ...base, event: 'suspended', versionNumber: 42 }).text).toContain(
      'v42',
    );
  });

  it('marks an unknown site', () => {
    expect(renderIncidentMail({ ...base, site: null }).text).toContain('unbekannt / unknown');
  });

  it('escapes the title in HTML', () => {
    const { html } = renderIncidentMail({ ...base, title: '<script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('contains nothing but the context fields', () => {
    const { text } = renderIncidentMail(base);
    const ctx = base as unknown as Record<string, unknown>;
    expect(ctx.description).toBeUndefined();
    expect(text).not.toMatch(/description|Beschreibung/i);
  });
});
