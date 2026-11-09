/**
 * germanCities.test.ts – Unit tests for city → coordinate lookup
 */
import { describe, it, expect } from 'vitest';
import {
  cityBucketKey,
  cityCoord,
  displayPostalCode,
  getPinCoord,
  parseCityField,
  postcodeCoord,
  resolveCity,
  unknownCityCoord,
} from '../germanCities';

describe('cityCoord', () => {
  it('returns coordinate tuple for a known city', () => {
    const c = cityCoord('Berlin');
    expect(c).not.toBeNull();
    expect(c![0]).toBeGreaterThanOrEqual(0);
    expect(c![1]).toBeGreaterThanOrEqual(0);
  });

  it('is case-insensitive', () => {
    expect(cityCoord('berlin')).toEqual(cityCoord('Berlin'));
    expect(cityCoord('BERLIN')).toEqual(cityCoord('Berlin'));
  });

  it('is accent-insensitive (umlauts)', () => {
    expect(cityCoord('München')).toEqual(cityCoord('Muenchen'));
    expect(cityCoord('Düsseldorf')).toEqual(cityCoord('Duesseldorf'));
    expect(cityCoord('Köln')).toEqual(cityCoord('Koeln'));
    expect(cityCoord('Saarbrücken')).toEqual(cityCoord('Saarbruecken'));
  });

  it('trims whitespace', () => {
    expect(cityCoord('  Berlin  ')).toEqual(cityCoord('Berlin'));
  });

  it('handles empty / null / undefined', () => {
    expect(cityCoord('')).toBeNull();
    expect(cityCoord(null)).toBeNull();
    expect(cityCoord(undefined)).toBeNull();
  });

  it('returns null for unknown city', () => {
    expect(cityCoord('Mitglieddorf')).toBeNull();
    expect(cityCoord('Nowhere')).toBeNull();
  });
});

describe('unknownCityCoord', () => {
  it('places coordinate inside the Sonstige stripe (x:620..660, y:140..720)', () => {
    const [x, y] = unknownCityCoord('Mitglieddorf');
    expect(x).toBeGreaterThanOrEqual(620);
    expect(x).toBeLessThanOrEqual(660);
    expect(y).toBeGreaterThanOrEqual(140);
    expect(y).toBeLessThanOrEqual(720);
  });

  it('is deterministic for the same input', () => {
    expect(unknownCityCoord('Mitglieddorf')).toEqual(unknownCityCoord('Mitglieddorf'));
  });

  it('produces different positions for different inputs', () => {
    const a = unknownCityCoord('Mitglieddorf');
    const b = unknownCityCoord('Standortburg');
    expect(a).not.toEqual(b);
  });
});

describe('getPinCoord', () => {
  it('returns known=true for a known city', () => {
    const r = getPinCoord('Berlin');
    expect(r.known).toBe(true);
  });

  it('returns known=false for unknown city', () => {
    const r = getPinCoord('Mitglieddorf');
    expect(r.known).toBe(false);
    expect(r.coord[0]).toBeGreaterThanOrEqual(620);
  });

  it('returns known=false for null', () => {
    const r = getPinCoord(null);
    expect(r.known).toBe(false);
  });
});

describe('parseCityField', () => {
  it('splits a postcode written before or after the place name', () => {
    expect(parseCityField('48149 Münster')).toEqual({ name: 'Münster', postalCode: '48149' });
    expect(parseCityField('Münster 48149')).toEqual({ name: 'Münster', postalCode: '48149' });
    expect(parseCityField('D-48149 Münster')).toEqual({ name: 'Münster', postalCode: '48149' });
  });

  it('leaves a plain name alone', () => {
    expect(parseCityField(' Münster ')).toEqual({ name: 'Münster', postalCode: null });
    expect(parseCityField(null)).toEqual({ name: '', postalCode: null });
  });
});

describe('resolveCity', () => {
  it('tolerates suffixes, district names and abbreviations', () => {
    expect(resolveCity('Münster (Westf.)')?.name).toBe('Münster');
    expect(resolveCity('Berlin-Buch')?.name).toBe('Berlin');
    expect(resolveCity('Halle/Saale')?.name).toBe('Halle (Saale)');
    expect(resolveCity('Frankfurt a.M.')?.name).toBe('Frankfurt am Main');
    expect(resolveCity('Mülheim a.d. Ruhr')?.name).toBe('Mülheim an der Ruhr');
    expect(resolveCity('Munich')?.name).toBe('München');
    expect(resolveCity('48149 Münster')?.name).toBe('Münster');
  });

  it('keeps Frankfurt (Oder) apart from Frankfurt am Main', () => {
    expect(resolveCity('Frankfurt (Oder)')?.name).toBe('Frankfurt (Oder)');
    expect(resolveCity('Frankfurt/Oder')?.name).toBe('Frankfurt (Oder)');
    expect(resolveCity('Frankfurt')?.name).toBe('Frankfurt am Main');
  });

  it('does not guess a different town from a shared word', () => {
    expect(resolveCity('Bad Homburg')).toBeNull();
    expect(resolveCity('Neustadt an der Weinstraße')).toBeNull();
  });

  it('knows a default postcode for every listed city', () => {
    expect(resolveCity('Hamburg')?.postalCode).toMatch(/^\d{5}$/);
    expect(resolveCity('Leipzig')?.postalCode).toBe('04109');
  });
});

describe('postcode placement', () => {
  it('places an unknown town by the region of its own postcode', () => {
    const region = postcodeCoord('48565')!;
    const r = getPinCoord('Steinfurt', '48565');
    expect(r.known).toBe(true);
    expect(Math.abs(r.coord[0] - region[0])).toBeLessThanOrEqual(6);
    expect(Math.abs(r.coord[1] - region[1])).toBeLessThanOrEqual(6);
  });

  it('uses a postcode written into the city field', () => {
    expect(getPinCoord('48565 Steinfurt').known).toBe(true);
  });

  it('prefers the city table over the postcode region', () => {
    expect(getPinCoord('Münster', '48149').coord).toEqual(cityCoord('Münster'));
  });

  it('still sends a place without name match or postcode to the Sonstige stripe', () => {
    const r = getPinCoord('Steinfurt');
    expect(r.known).toBe(false);
    expect(r.coord[0]).toBeGreaterThanOrEqual(620);
  });

  it('rejects malformed postcodes', () => {
    expect(postcodeCoord('4814')).toBeNull();
    expect(postcodeCoord('abcde')).toBeNull();
    expect(postcodeCoord(undefined)).toBeNull();
  });
});

describe('displayPostalCode', () => {
  it("shows the site's own postcode first", () => {
    expect(displayPostalCode('Münster', '48149')).toEqual({ code: '48149', derived: false });
    expect(displayPostalCode('48149 Münster', null)).toEqual({ code: '48149', derived: false });
  });

  it('falls back to the default postcode of a listed city, marked as derived', () => {
    expect(displayPostalCode('Leipzig', '')).toEqual({ code: '04109', derived: true });
  });

  it('returns null for an unknown town without postcode', () => {
    expect(displayPostalCode('Steinfurt', null)).toBeNull();
  });
});

describe('cityBucketKey', () => {
  it('puts spellings of the same city into one bucket', () => {
    expect(cityBucketKey('48149 Münster', 'DE')).toBe(cityBucketKey('Münster', 'DE'));
    expect(cityBucketKey('Münster (Westf.)', null)).toBe(cityBucketKey('münster', 'DE'));
  });

  it('keeps unknown towns apart by name', () => {
    expect(cityBucketKey('Steinfurt', 'DE')).not.toBe(cityBucketKey('Emsdetten', 'DE'));
    expect(cityBucketKey(null, null)).toBe('__unknown__|DE');
  });
});
