/**
 * riskSummary.test.ts — the risk sentence builder: at most two sentences (risk findings high to
 * low, then mitigating/info findings), German and English, with the three reference cases
 * (routine renewal, takeover pattern, first request) and the singular day forms.
 * Dependencies: riskSummary, stores/i18n.store
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { RiskAssessment, RiskFinding } from '../../../api/admin.api';
import { useI18n } from '../../../stores/i18n.store';
import { buildRiskSummary, riskPill } from '../riskSummary';

const RULES: Record<string, Pick<RiskFinding, 'severity' | 'weight'>> = {
  CERT_RENEWAL: { severity: 'info', weight: -1 },
  CERT_EARLY_REPLACE: { severity: 'medium', weight: 2 },
  CERT_ISSUER_CHANGED: { severity: 'medium', weight: 2 },
  CONTACT_DATA_CHANGED: { severity: 'medium', weight: 2 },
  TAKEOVER_PATTERN: { severity: 'high', weight: 4 },
  FIRST_REQUEST: { severity: 'info', weight: 0 },
  NOTHING_CHANGED: { severity: 'info', weight: 0 },
  CERT_CA_BLACKLISTED: { severity: 'high', weight: 6 },
};

function f(code: string, params: Record<string, string | number> = {}): RiskFinding {
  return { code, ...RULES[code], params };
}

function risk(
  level: RiskAssessment['level'],
  findings: RiskFinding[],
  firstRequest = false,
): RiskAssessment {
  return { level, score: 0, firstRequest, findings };
}

const sentenceCount = (text: string) => text.split(/(?<=\.)\s/).length;
const t = () => useI18n.getState().t;

describe('buildRiskSummary (de)', () => {
  beforeEach(() => useI18n.getState().setLang('de'));

  it('describes a routine renewal in one mitigating sentence', () => {
    const text = buildRiskSummary(
      risk('LOW', [f('CERT_RENEWAL', { cn: 'dsf.ukm.de', days: 12 })]),
      t(),
    );
    expect(text).toBe(
      'Routine-Verlängerung von dsf.ukm.de, altes Zertifikat läuft in 12 Tagen ab, gleiche CA.',
    );
  });

  it('words an already expired old certificate', () => {
    const text = buildRiskSummary(
      risk('LOW', [f('CERT_RENEWAL', { cn: 'dsf.ukm.de', days: -3 })]),
      t(),
    );
    expect(text).toContain('seit 3 Tagen abgelaufen');
  });

  it('uses the singular for one day', () => {
    const text = buildRiskSummary(
      risk('LOW', [f('CERT_RENEWAL', { cn: 'dsf.ukm.de', days: 1 })]),
      t(),
    );
    expect(text).toContain('läuft in 1 Tag ab');
  });

  it('joins the risk findings high to low in one sentence', () => {
    const text = buildRiskSummary(
      risk('HIGH', [
        f('TAKEOVER_PATTERN'),
        f('CERT_EARLY_REPLACE', { cn: 'dsf.ukm.de', days: 70 }),
        f('CERT_ISSUER_CHANGED', { from: 'GEANT TLS ECC 1', to: 'R11' }),
        f('CONTACT_DATA_CHANGED'),
      ]),
      t(),
    );
    expect(text).toBe(
      'Auffällig: Zertifikatswechsel zusammen mit geänderten Kontaktdaten oder geänderter ' +
        'Endpunkt-Adresse (Übernahme-Muster); Zertifikat 70 Tage vor Ablauf ersetzt; ' +
        'neue CA „R11“ statt „GEANT TLS ECC 1“; Kontakt-E-Mail oder -Adresse geändert.',
    );
    expect(sentenceCount(text)).toBe(1);
  });

  it('puts the info findings into a second sentence, never more than two', () => {
    const text = buildRiskSummary(
      risk(
        'MEDIUM',
        [
          f('CERT_EARLY_REPLACE', { cn: 'a', days: 70 }),
          f('CERT_RENEWAL', { cn: 'b', days: 5 }),
          f('FIRST_REQUEST'),
        ],
        true,
      ),
      t(),
    );
    expect(sentenceCount(text)).toBe(2);
    expect(text.startsWith('Prüfen: Zertifikat 70 Tage vor Ablauf ersetzt.')).toBe(true);
    expect(text).toContain('Routine-Verlängerung von b');
    expect(text).toContain('Erstantrag ohne frühere Freigabe');
  });

  it('describes a clean first request', () => {
    const text = buildRiskSummary(risk('LOW', [f('FIRST_REQUEST')], true), t());
    expect(text).toBe('Erstantrag ohne frühere Freigabe, alle Angaben vollständig prüfen.');
  });

  it('never says nothing changed when the data did change without a finding', () => {
    expect(buildRiskSummary(risk('LOW', []), t())).toBe('Änderungen ohne Risikobezug.');
    expect(buildRiskSummary(risk('LOW', [f('NOTHING_CHANGED')]), t())).toBe(
      'Keine Änderung gegenüber der letzten Freigabe.',
    );
  });

  it('shows a code it does not know generically instead of skipping it', () => {
    const unknown: RiskFinding = { code: 'FUTURE_RULE', severity: 'high', weight: 9, params: {} };
    expect(buildRiskSummary(risk('HIGH', [unknown, f('CONTACT_DATA_CHANGED')]), t())).toBe(
      'Auffällig: weitere Auffälligkeit (FUTURE_RULE); Kontakt-E-Mail oder -Adresse geändert.',
    );
  });

  it('strips control characters, collapses blanks and truncates site-supplied text', () => {
    const name = ['Evil', String.fromCharCode(0x202e, 0), '  Klinik ', 'x'.repeat(80)].join('');
    const text = buildRiskSummary(
      risk('MEDIUM', [f('ORG_NAME_CHANGED', { from: 'Alt', to: name })]),
      t(),
    );
    expect([...text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 0x202e)).toBe(
      false,
    );
    expect(text).toContain('„Evil Klinik ');
    expect(text).toContain('…“');
    expect(text.length).toBeLessThan(160);
  });

  it('caps the risk sentence at five findings and counts the rest', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      f('ORG_NAME_CHANGED', { from: `a${i}`, to: `b${i}` }),
    );
    const text = buildRiskSummary(risk('MEDIUM', many), t());
    expect(text.match(/Organisationsname/g)).toHaveLength(5);
    expect(text.endsWith('; +3 weitere.')).toBe(true);
    expect(sentenceCount(text)).toBe(1);
  });

  it('words the day edge cases: expiring today, already expired, short validity', () => {
    const today = buildRiskSummary(risk('LOW', [f('CERT_RENEWAL', { cn: 'a.de', days: 0 })]), t());
    expect(today).toContain('läuft heute ab');
    const expiredShort: RiskFinding = {
      code: 'CERT_SHORT_VALIDITY',
      severity: 'low',
      weight: 1,
      params: { cn: 'a.de', days: -4 },
    };
    expect(buildRiskSummary(risk('LOW', [expiredShort]), t())).toBe(
      'Hinweise: neues Zertifikat a.de ist seit 4 Tagen abgelaufen.',
    );
  });

  it('words the split takeover and the new rules', () => {
    const split: RiskFinding = {
      code: 'TAKEOVER_PATTERN',
      severity: 'high',
      weight: 4,
      params: { after: 'contact', days: 10 },
    };
    expect(buildRiskSummary(risk('HIGH', [split]), t())).toBe(
      'Auffällig: Zertifikatswechsel innerhalb von 30 Tagen nach Kontaktänderung (Übernahme-Muster).',
    );
    const shared: RiskFinding = {
      code: 'IP_SHARED',
      severity: 'medium',
      weight: 2,
      params: { n: 2, orgs: 'a.de, b.de' },
    };
    expect(buildRiskSummary(risk('MEDIUM', [shared]), t())).toBe(
      'Prüfen: 2 IP-Adresse(n) werden auch von a.de, b.de genutzt.',
    );
    const legacy: RiskFinding = {
      code: 'CERT_NOT_COMPARABLE',
      severity: 'low',
      weight: 1,
      params: { cn: '' },
    };
    expect(buildRiskSummary(risk('LOW', [legacy]), t())).toContain(
      'Zertifikate nicht mit der letzten Freigabe vergleichbar',
    );
  });
});

describe('buildRiskSummary (en)', () => {
  beforeEach(() => useI18n.getState().setLang('en'));

  it('renders the English renewal and blacklist texts', () => {
    expect(
      buildRiskSummary(risk('LOW', [f('CERT_RENEWAL', { cn: 'dsf.ukm.de', days: 12 })]), t()),
    ).toBe('Routine renewal of dsf.ukm.de, old certificate expires in 12 days, same CA.');
    const text = buildRiskSummary(
      risk('HIGH', [
        f('CERT_CA_BLACKLISTED', { ca: 'Bad CA' }),
        f('CERT_ISSUER_CHANGED', { from: 'GEANT TLS ECC 1', to: 'R11' }),
      ]),
      t(),
    );
    expect(text).toBe(
      'Suspicious: issuing CA “Bad CA” is blacklisted; new CA “R11” instead of “GEANT TLS ECC 1”.',
    );
  });
});

describe('riskPill', () => {
  beforeEach(() => useI18n.getState().setLang('de'));

  it('maps the levels to tone and label', () => {
    expect(riskPill(risk('LOW', []), t())).toEqual([
      { tone: 'success', label: 'Unauffällig', icon: 'check_circle' },
    ]);
    expect(riskPill(risk('MEDIUM', []), t())[0]).toMatchObject({
      tone: 'warning',
      label: 'Prüfen',
    });
    expect(riskPill(risk('HIGH', []), t())[0]).toMatchObject({
      tone: 'danger',
      label: 'Auffällig',
    });
  });

  it('shows the neutral first-request pill, plus the level when it is not LOW', () => {
    expect(riskPill(risk('LOW', [], true), t())).toEqual([
      { tone: 'neutral', label: 'Erstantrag', icon: 'fiber_new' },
    ]);
    const both = riskPill(risk('HIGH', [], true), t());
    expect(both.map((p) => p.label)).toEqual(['Erstantrag', 'Auffällig']);
  });
});
