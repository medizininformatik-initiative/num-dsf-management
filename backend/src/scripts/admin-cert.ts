/**
 * admin-cert.ts – last-resort recovery of admin certificate access, on the
 * server, when every admin certificate has expired or been lost.
 *
 * Usage:
 *   admin-cert add <email> <cert.pem> [--label X]
 *   admin-cert list [email]
 *   admin-cert remove <fingerprint-prefix> --yes
 *   admin-cert totp-reset <email> --yes   (lost phone and TAN list)
 * `add` only works for an e-mail that already has a verified admin grant:
 * granting admin rights stays a four-eyes process, this only restores access.
 * Dev:  docker compose exec backend npx ts-node src/scripts/admin-cert.ts ...
 * Prod: docker compose exec backend node dist/scripts/admin-cert.js ...
 * Wrapper: scripts/admin-cert.sh. Dependencies: services/admin-certificates.service
 */
import fs from 'fs';
import { db } from '../db/connection';
import {
  addAdminCertificate,
  listAll,
  listForEmail,
  removeAdminCertificate,
  AdminCertError,
  type AdminCertificate,
} from '../services/admin-certificates.service';
import { isVerifiedAdminEmail } from '../lib/adminGrants';
import { resetTotp } from '../services/totp.service';
import { writeAuditLog } from '../services/audit.service';

export const CLI_ACTOR = 'server-cli';

const MESSAGES: Record<string, string> = {
  NOT_AN_ADMIN:
    'This e-mail has no verified admin grant. Granting admin rights needs the normal four-eyes promotion in the portal; this tool only restores access for an existing admin.',
  PRIVATE_KEY_REJECTED: 'The file contains a private key. Provide the public certificate only.',
  INVALID_PEM:
    'The file is not exactly one readable X.509 certificate in PEM format (no chain, nothing else).',
  CA_CERTIFICATE_REJECTED: 'This is a CA certificate; give the admin’s own client certificate.',
  CERTIFICATE_EXPIRED: 'The certificate has already expired.',
  CERTIFICATE_NOT_YET_VALID: 'The certificate is not valid yet.',
  CA_BLACKLISTED: 'The issuing CA is blacklisted.',
  CA_NOT_WHITELISTED: 'The issuing CA is not on the CA whitelist (CA_WHITELIST_ENFORCE=true).',
  ADMIN_CERTIFICATE_IN_USE: 'This certificate is already registered as an admin certificate.',
  ORG_LOGIN_CERTIFICATE_IN_USE: 'This certificate is already an organization login certificate.',
  CERTIFICATE_NOT_FOUND: 'No such admin certificate.',
};

function describe(c: AdminCertificate): string {
  const until = c.validUntil ? new Date(c.validUntil).toISOString().slice(0, 10) : 'unknown';
  return `${c.email}  ${c.fingerprint.slice(0, 16)}...  valid until ${until}  ${c.label ?? ''}`.trimEnd();
}

/** Parse "--label X" out of the arguments; returns the remaining positional arguments. */
export function parseArgs(args: string[]): {
  positional: string[];
  label: string | null;
  yes: boolean;
} {
  const positional: string[] = [];
  let label: string | null = null;
  let yes = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label') label = args[++i] ?? null;
    else if (args[i] === '--yes') yes = true;
    else positional.push(args[i]);
  }
  return { positional, label, yes };
}

export async function runAdd(email: string, file: string, label: string | null): Promise<number> {
  let pem: string;
  try {
    pem = fs.readFileSync(file, 'utf8');
  } catch {
    console.error(`Cannot read file: ${file}`);
    return 1;
  }
  try {
    const cert = await addAdminCertificate({
      email,
      pem,
      label,
      actor: CLI_ACTOR,
      ip: 'server-cli',
      self: false,
    });
    console.log('Admin certificate registered.');
    console.log(`  E-mail:      ${cert.email}`);
    console.log(`  Fingerprint: ${cert.fingerprint}`);
    console.log(
      `  Valid until: ${cert.validUntil ? new Date(cert.validUntil).toISOString() : '?'}`,
    );
    return 0;
  } catch (err) {
    if (err instanceof AdminCertError) {
      console.error(MESSAGES[err.code] ?? err.code);
      return 1;
    }
    throw err;
  }
}

export async function runList(email?: string): Promise<number> {
  const rows = email ? await listForEmail(email) : await listAll();
  if (rows.length === 0) console.log('No admin certificates.');
  for (const c of rows) console.log(describe(c));
  return 0;
}

export async function runRemove(prefix: string, yes: boolean): Promise<number> {
  if (!/^[0-9a-f]{8,128}$/i.test(prefix)) {
    console.error('Give at least 8 hex characters of the fingerprint.');
    return 1;
  }
  const matches = (await listAll()).filter((c) => c.fingerprint.startsWith(prefix.toLowerCase()));
  if (matches.length !== 1) {
    console.error(matches.length === 0 ? 'No admin certificate matches.' : 'Prefix is ambiguous.');
    return 1;
  }
  const target = matches[0];
  console.log(describe(target));
  if (!yes) {
    console.error('Refusing to remove without --yes. Nothing changed.');
    return 2;
  }
  await removeAdminCertificate({
    email: target.email,
    id: target.id,
    actor: CLI_ACTOR,
    ip: 'server-cli',
    self: false,
  });
  console.log('Removed.');
  return 0;
}

/**
 * Lost phone and TAN list: clear the admin's TOTP (secret, TANs, enabled flag).
 * At the next certificate login the admin has to set TOTP up again.
 */
export async function runTotpReset(emailArg: string, yes: boolean): Promise<number> {
  const email = emailArg.toLowerCase().trim();
  if (!(await isVerifiedAdminEmail(email))) {
    console.error('This e-mail has no verified admin grant.');
    return 1;
  }
  const user = await db('users').where({ email }).first();
  if (!user) {
    console.error('No user with this e-mail has signed in yet.');
    return 1;
  }
  if (!yes) {
    console.error(`Refusing to reset TOTP of ${email} without --yes. Nothing changed.`);
    return 2;
  }
  await resetTotp(user.id);
  await writeAuditLog({
    userEmail: CLI_ACTOR,
    resourceType: 'AUTH',
    resourceId: email,
    operation: 'TOTP_SETUP',
    diffJson: { action: 'reset_by_server_cli' },
    ipAddress: 'server-cli',
  });
  console.log(`TOTP of ${email} reset. They set it up again at the next certificate login.`);
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, label, yes } = parseArgs(rest);
  if (command === 'add' && positional.length === 2)
    return runAdd(positional[0], positional[1], label);
  if (command === 'list' && positional.length <= 1) return runList(positional[0]);
  if (command === 'remove' && positional.length === 1) return runRemove(positional[0], yes);
  if (command === 'totp-reset' && positional.length === 1) return runTotpReset(positional[0], yes);
  console.error(
    'Usage: admin-cert add <email> <cert.pem> [--label X] | list [email] | remove <fingerprint-prefix> --yes | totp-reset <email> --yes',
  );
  return 1;
}

if (require.main === module) {
  main()
    .then((code) => db.destroy().then(() => process.exit(code)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
