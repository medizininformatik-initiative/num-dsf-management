/**
 * onboardingColumns.test.ts – per-cell validation (mirror of the backend
 * rules), the clipboard (tab-separated) parser and the grid-apply helper of
 * the bulk onboarding editor.
 */
import { describe, it, expect } from 'vitest';
import {
  applyGrid,
  emptyCells,
  isBlankCells,
  parseClipboardGrid,
  validateCell,
  validateRow,
} from '../onboardingColumns';

const FP = 'ab:'.repeat(63) + 'ab'; // 128 hex chars with colons

describe('validateCell', () => {
  it('requires identifier, name, e-mail and fingerprint', () => {
    expect(validateCell('organizationIdentifier', '  ')).toBe('onbErrRequired');
    expect(validateCell('organizationName', '')).toBe('onbErrRequired');
    expect(validateCell('contactEmail', '')).toBe('onbErrRequired');
    expect(validateCell('clientCertFingerprint', '')).toBe('onbErrRequired');
    expect(validateCell('city', '')).toBeNull();
    expect(validateCell('countryCode', '')).toBeNull();
  });

  it('checks the FQDN, e-mail, fingerprint and country formats', () => {
    expect(validateCell('organizationIdentifier', 'klinik')).toBe('onbErrFqdn');
    expect(validateCell('organizationIdentifier', 'Klinik.Example.de')).toBeNull();
    expect(validateCell('contactEmail', 'nope')).toBe('onbErrEmail');
    expect(validateCell('contactEmail', 'a@klinik.example.de')).toBeNull();
    expect(validateCell('clientCertFingerprint', 'abc')).toBe('onbErrFingerprint');
    expect(validateCell('clientCertFingerprint', FP)).toBeNull();
    expect(validateCell('countryCode', 'DEU')).toBe('onbErrCountry');
    expect(validateCell('countryCode', 'de')).toBeNull();
  });

  it('rejects formula characters in free-text cells and over-long values', () => {
    expect(validateCell('organizationName', '=SUM(A1)')).toBe('onbErrFormula');
    expect(validateCell('city', '@home')).toBe('onbErrFormula');
    expect(validateCell('organizationName', 'x'.repeat(256))).toBe('onbErrTooLong');
    expect(validateCell('city', 'x'.repeat(101))).toBe('onbErrTooLong');
  });
});

describe('validateRow / isBlankCells', () => {
  it('reports the first problem and recognizes blank rows', () => {
    expect(isBlankCells(emptyCells())).toBe(true);
    const row = { ...emptyCells(), organizationIdentifier: 'a.example.de' };
    expect(isBlankCells(row)).toBe(false);
    expect(validateRow(row)).toEqual({ column: 'organizationName', error: 'onbErrRequired' });
  });
});

describe('parseClipboardGrid', () => {
  it('returns null for plain single-cell text', () => {
    expect(parseClipboardGrid('klinik.example.de')).toBeNull();
    expect(parseClipboardGrid('klinik.example.de\n')).toBeNull();
  });

  it('splits tab-separated rows and drops a header line', () => {
    const text =
      'organizationIdentifier\torganizationName\r\na.example.de\tA Org\r\nb.example.de\tB Org\r\n';
    expect(parseClipboardGrid(text)).toEqual([
      ['a.example.de', 'A Org'],
      ['b.example.de', 'B Org'],
    ]);
  });

  it('treats one tab-separated line as a row', () => {
    expect(parseClipboardGrid('a.example.de\tA Org')).toEqual([['a.example.de', 'A Org']]);
  });
});

describe('applyGrid', () => {
  it('fills from the given cell, appends rows and ignores overflow columns', () => {
    const rows = [emptyCells()];
    const next = applyGrid(rows, [['x', 'y', 'z', 'w', 'v', 'u', 'overflow'], ['second']], 0, 0);
    expect(next).toHaveLength(2);
    expect(next[0].countryCode).toBe('u');
    expect(next[1].organizationIdentifier).toBe('second');
    expect(rows[0].organizationIdentifier).toBe(''); // input untouched
  });

  it('starts at the column of the pasted-into cell', () => {
    const next = applyGrid([emptyCells()], [['Name', 'mail@x.example.de']], 0, 1);
    expect(next[0].organizationName).toBe('Name');
    expect(next[0].contactEmail).toBe('mail@x.example.de');
    expect(next[0].organizationIdentifier).toBe('');
  });
});
