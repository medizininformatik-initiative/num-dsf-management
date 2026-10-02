/**
 * caDn.test.ts – covers the CA subject-DN helpers used by the admin CA lists:
 * the common name is found in certificate order and in RFC 4514 order,
 * escaped and unescaped commas inside a value survive, and a DN without a CN
 * falls back to the whole DN.
 */
import { describe, it, expect } from 'vitest';
import { commonName, splitDn } from '../caDn';

describe('splitDn', () => {
  it('splits at the commas that start a new RDN only', () => {
    expect(splitDn('C=DE, O=Example, Inc.,CN=Example CA')).toEqual([
      'C=DE',
      'O=Example, Inc.',
      'CN=Example CA',
    ]);
  });
});

describe('commonName', () => {
  it('reads the CN from a DN in certificate order', () => {
    expect(
      commonName(
        'C=DE,O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V.,OU=DFN-PKI,CN=DFN-Verein Global Issuing CA',
      ),
    ).toBe('DFN-Verein Global Issuing CA');
  });

  it('reads the CN from a DN in RFC 4514 order, case-insensitively', () => {
    expect(commonName('cn=Example Root CA,O=Example,C=DE')).toBe('Example Root CA');
  });

  it('keeps commas inside the CN value and unescapes them', () => {
    expect(commonName('CN=Example\\, Issuing CA,O=Example,C=DE')).toBe('Example, Issuing CA');
    expect(commonName('C=DE,CN=Example, Issuing CA')).toBe('Example, Issuing CA');
  });

  it('falls back to the whole DN when there is no CN', () => {
    expect(commonName(' O=Example Org,C=DE ')).toBe('O=Example Org,C=DE');
  });
});
