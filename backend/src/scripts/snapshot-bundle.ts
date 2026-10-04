/**
 * snapshot-bundle.ts – create a bundle version from the current database state,
 * the same way an approval does. Used by the DSF end-to-end harness
 * (scripts/dsf-e2e/run.sh) after it changes portal data directly.
 *
 * Usage:  node -r ts-node/register/transpile-only src/scripts/snapshot-bundle.ts <notes>
 * Depends on: services/bundle-versions.service, db/connection.
 */
import { db } from '../db/connection';
import { createSnapshot } from '../services/bundle-versions.service';

createSnapshot({
  triggeredBy: 'MANUAL',
  triggeredByEmail: 'SYSTEM:dsf-e2e',
  notes: process.argv[2] ?? 'dsf-e2e',
})
  .then((r) => {
    console.log('bundle version ' + r.versionNumber);
    return db.destroy();
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
