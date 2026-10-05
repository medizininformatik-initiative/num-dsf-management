/**
 * backup-restore-privilege.test.ts – the grant check that decides whether a
 * restore may drop and re-create triggers when binary logging is on.
 * Dependencies: backup-restore.service (grantsAllowTriggers)
 */
import { grantsAllowTriggers } from '../services/backup-restore.service';

describe('grantsAllowTriggers', () => {
  it('accepts a global ALL PRIVILEGES grant (root)', () => {
    expect(
      grantsAllowTriggers(['GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION']),
    ).toBe(true);
  });

  it('accepts a global grant that includes SUPER', () => {
    expect(grantsAllowTriggers(['GRANT SELECT, SUPER ON *.* TO `ops`@`%`'])).toBe(true);
  });

  it('rejects an application account with schema-level rights only', () => {
    expect(
      grantsAllowTriggers([
        'GRANT USAGE ON *.* TO `dsf`@`%`',
        'GRANT ALL PRIVILEGES ON `dsf_allowlist`.* TO `dsf`@`%`',
      ]),
    ).toBe(false);
  });

  it('rejects when no grant is returned', () => {
    expect(grantsAllowTriggers([])).toBe(false);
  });
});
