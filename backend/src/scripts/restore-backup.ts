/**
 * restore-backup.ts – restore a DSF Allow List backup (JSON, .json.gz or
 * encrypted .json.gz.enc) into the database. Manual, on the server.
 *
 * Usage:  restore-backup.ts <file> [--dry-run] [--yes]
 *   --dry-run  verify the file and compare it with the database, change nothing
 *   --yes      required to actually overwrite the database
 * Without --yes nothing is changed; the table counts are printed and the exit
 * code is 2. Encrypted files need BACKUP_ENCRYPTION_KEY in the environment.
 * Dev:  docker compose exec backend npx ts-node src/scripts/restore-backup.ts <file> ...
 * Prod: docker compose exec backend node dist/scripts/restore-backup.js <file> ...
 * Wrapper: scripts/restore-backup.sh. Dependencies: services/backup-restore.service
 */
import { readBackupKey } from '../lib/backupCrypto';
import { loadBackupFile, restoreBackup } from '../services/backup-restore.service';
import { mysqlConnectionOptions } from '../services/backup-dump.service';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('--yes');
  const unknown = args.filter((a) => a.startsWith('--') && !['--dry-run', '--yes'].includes(a));
  if (!file || unknown.length > 0) {
    console.error('Usage: restore-backup <file> [--dry-run] [--yes]');
    return 1;
  }

  const doc = await loadBackupFile(file, readBackupKey());
  console.log(
    `Backup verified: created ${doc.createdAt}, app ${doc.appVersion}, schema ${doc.schemaVersion}`,
  );

  // With binary logging on, re-creating the append-only triggers needs SUPER:
  // RESTORE_DB_USER / RESTORE_DB_PASSWORD (e.g. the MySQL root account) override
  // the application's database account for this run only.
  const connection = {
    ...mysqlConnectionOptions(),
    ...(process.env.RESTORE_DB_USER ? { user: process.env.RESTORE_DB_USER } : {}),
    ...(process.env.RESTORE_DB_PASSWORD ? { password: process.env.RESTORE_DB_PASSWORD } : {}),
  };
  const result = await restoreBackup(doc, { dryRun: true, connection });
  console.log('\nTable                          rows in backup');
  for (const t of result.plan.tables) console.log(`${t.name.padEnd(30)} ${t.rows}`);
  if (result.plan.untouched.length > 0) {
    console.log(`\nNot in the backup, left untouched: ${result.plan.untouched.join(', ')}`);
  }
  if (dryRun) {
    console.log('\nDry run: the backup is valid and matches the database schema. Nothing changed.');
    return 0;
  }
  if (!yes) {
    console.error('\nRefusing to overwrite the database without --yes. Nothing changed.');
    return 2;
  }

  console.log('\nRestoring (one transaction; rolled back on any error) ...');
  const done = await restoreBackup(doc, { connection, log: (line) => console.log(line) });
  console.log('\nRestored. Row counts now in the database:');
  for (const [name, n] of Object.entries(done.counts)) console.log(`${name.padEnd(30)} ${n}`);
  console.log(
    '\nNext steps: restart the backend (docker compose restart backend). ' +
      'All sessions are invalid after a restore; everybody has to sign in again ' +
      '(Redis is not part of the backup).',
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
