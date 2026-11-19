/**
 * requestRiskNet.test.ts – IP normalisation / private-range classification, registrable domains
 * with second-level public suffixes, and endpoint address parsing of the request-risk helpers.
 * Dependencies: lib/requestRiskNet
 */
import {
  isPrivateIp,
  normalizeHost,
  normalizeIp,
  parseEndpointAddress,
  registrableDomain,
} from '../lib/requestRiskNet';

describe('normalizeIp', () => {
  it.each([
    ['93.184.216.34', '93.184.216.34'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['::ffff:10.0.0.1', '10.0.0.1'],
    ['0:0:0:0:0:ffff:a00:1', '10.0.0.1'],
    ['0000:0000:0000:0000:0000:0000:0000:0001', '::1'],
    ['fe80::1%eth0', 'fe80::1'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });

  it('returns null for something that is no IP address', () => {
    expect(normalizeIp('host.example.de')).toBeNull();
    expect(normalizeIp('999.1.1.1')).toBeNull();
    expect(normalizeIp('')).toBeNull();
  });
});

describe('isPrivateIp', () => {
  it.each([
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '127.0.0.1',
    '169.254.10.10',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.2.5',
    '198.51.100.7',
    '203.0.113.9',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '239.255.255.250',
    '255.255.255.255',
    'fd12::1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    '::1',
    '::',
    '0:0:0:0:0:0:0:1',
    'ff02::1',
    '::ffff:10.0.0.1',
    '::ffff:0a00:0001',
    '0:0:0:0:0:ffff:c0a8:1',
    '64:ff9b::a00:1',
    '64:ff9b::192.168.1.1',
  ])('%s is private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '198.20.0.1',
    '2606:4700::1111',
    '64:ff9b::808:808',
    '::ffff:8.8.8.8',
    'not-an-ip',
  ])('%s is not private', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('registrableDomain / normalizeHost', () => {
  it.each([
    ['dsf.ukm.de', 'ukm.de'],
    ['ukm.de', 'ukm.de'],
    ['DSF.UKM.DE.', 'ukm.de'],
    ['dsf.evil.ac.uk', 'evil.ac.uk'],
    ['evil.co.uk', 'evil.co.uk'],
    ['a.b.gv.at', 'b.gv.at'],
    ['x.y.com.au', 'y.com.au'],
    ['localhost', 'localhost'],
    ['93.184.216.34', '93.184.216.34'],
    ['[2001:db8::1]', '2001:db8::1'],
  ])('%s -> %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });

  it('normalizeHost lowercases and drops brackets and trailing dots', () => {
    expect(normalizeHost('FHIR.Example.DE..')).toBe('fhir.example.de');
    expect(normalizeHost('[::1]')).toBe('::1');
  });
});

describe('parseEndpointAddress', () => {
  it('splits scheme, host, effective port and path without trailing slash', () => {
    expect(parseEndpointAddress('https://DSF.ukm.de./fhir/')).toEqual({
      readable: true,
      scheme: 'https',
      host: 'dsf.ukm.de',
      port: 443,
      path: '/fhir',
    });
    expect(parseEndpointAddress('http://dsf.ukm.de:8080/fhir')).toMatchObject({
      scheme: 'http',
      port: 8080,
      path: '/fhir',
    });
  });

  it('flags an address it cannot read', () => {
    expect(parseEndpointAddress('not a url').readable).toBe(false);
    expect(parseEndpointAddress('').readable).toBe(false);
    expect(parseEndpointAddress('ftp://x.example.de/').readable).toBe(false);
  });
});
