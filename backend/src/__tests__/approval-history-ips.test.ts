/**
 * approval-history-ips.test.ts – extractApprovedIps reads the endpoint IPs of an approval
 * snapshot (string or object, ipAddresses or legacy ips key), sorted and de-duplicated, and
 * returns null for a missing or unreadable snapshot.
 * Dependencies: lib/approvedIps
 */
import { extractApprovedIps } from '../lib/approvedIps';

describe('approvedIps – extractApprovedIps', () => {
  it('reads IPs from a parsed snapshot object', () => {
    const snapshot = { endpoints: [{ ipAddresses: [{ ip: '10.0.0.2' }, { ip: '10.0.0.1' }] }] };
    expect(extractApprovedIps(snapshot)).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('parses a JSON string snapshot', () => {
    const snapshot = JSON.stringify({ endpoints: [{ ipAddresses: [{ ip: '10.0.0.1' }] }] });
    expect(extractApprovedIps(snapshot)).toEqual(['10.0.0.1']);
  });

  it('accepts the legacy ips key', () => {
    expect(extractApprovedIps({ endpoints: [{ ips: [{ ip: '10.0.0.9' }] }] })).toEqual([
      '10.0.0.9',
    ]);
  });

  it('de-duplicates IPs across endpoints', () => {
    const snapshot = {
      endpoints: [{ ipAddresses: [{ ip: '10.0.0.1' }] }, { ipAddresses: [{ ip: '10.0.0.1' }] }],
    };
    expect(extractApprovedIps(snapshot)).toEqual(['10.0.0.1']);
  });

  it('returns an empty list for endpoints without IPs', () => {
    expect(extractApprovedIps({ endpoints: [{}, { ipAddresses: [] }] })).toEqual([]);
  });

  it('returns null when the snapshot has no endpoints array', () => {
    expect(extractApprovedIps({})).toBeNull();
    expect(extractApprovedIps(null)).toBeNull();
    expect(extractApprovedIps(undefined)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractApprovedIps('{not valid json')).toBeNull();
  });
});
