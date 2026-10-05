#!/usr/bin/env node
/**
 * check-resource-links.mjs — on-demand dead-link check for the DSF Resources
 * page. Extracts every `url: '...'` from src/lib/dsfResources.ts (or reads the
 * URLs from a text file given as the first argument, one per line), requests
 * each one with GET and follows redirects. 2xx is alive; 403/429 usually means
 * bot protection and must be checked by hand in a browser; anything else
 * (404/410, DNS or TLS failure, timeout) is reported as dead.
 * Not run in CI (needs network). Usage, from frontend/:
 *   node scripts/check-resource-links.mjs [urls.txt]
 * Exit code 1 when at least one link is dead.
 * Dependencies: Node 18+ (global fetch), no packages.
 */
/* global process, fetch, AbortSignal, console */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];

function loadUrls() {
  if (arg) {
    return readFileSync(arg, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  const src = readFileSync(join(here, '..', 'src', 'lib', 'dsfResources.ts'), 'utf8');
  return [...src.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1]);
}

async function check(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'Mozilla/5.0 (dsf-allowlist link check)' },
    });
    const verdict =
      res.status < 300 ? 'alive' : res.status === 403 || res.status === 429 ? 'check' : 'dead';
    const moved = res.url !== url ? ` -> ${res.url}` : '';
    return { url, verdict, line: `${res.status}${moved}` };
  } catch (err) {
    return { url, verdict: 'dead', line: `ERROR ${err.cause?.code ?? err.name}` };
  }
}

const urls = [...new Set(loadUrls())];
const results = await Promise.all(urls.map(check));
for (const r of results) {
  console.log(`${r.verdict.padEnd(5)}  ${r.line.padEnd(8)}  ${r.url}`);
}
const dead = results.filter((r) => r.verdict === 'dead').length;
const manual = results.filter((r) => r.verdict === 'check').length;
console.log(`\n${urls.length} checked, ${dead} dead, ${manual} need a manual browser check`);
process.exitCode = dead > 0 ? 1 : 0;
