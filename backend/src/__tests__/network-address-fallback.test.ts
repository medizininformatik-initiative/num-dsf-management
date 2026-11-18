/**
 * network-address-fallback.test.ts – DB-free unit test of snapshotOrLive, the
 * snapshot-then-live rule for the map's city, postcode and country.
 * Dependencies: network.service
 */
import { snapshotOrLive } from '../services/network.service';

describe('snapshotOrLive', () => {
  it('falls back to the live value when the snapshot value is empty', () => {
    expect(snapshotOrLive('', 'Kiel')).toBe('Kiel');
    expect(snapshotOrLive('   ', 'Kiel')).toBe('Kiel');
    expect(snapshotOrLive(null, 'Kiel')).toBe('Kiel');
    expect(snapshotOrLive('', 'DE')).toBe('DE');
  });

  it('keeps a filled snapshot value over the live one', () => {
    expect(snapshotOrLive('Lübeck', 'Kiel')).toBe('Lübeck');
  });

  it('returns null when both are empty', () => {
    expect(snapshotOrLive('', '')).toBeNull();
    expect(snapshotOrLive(undefined, '  ')).toBeNull();
    expect(snapshotOrLive('', null)).toBeNull();
  });
});
