<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dsf-dark.svg">
  <img src="docs/logo-dsf-light.svg" alt="dsf." height="56" />
</picture>

# DSF Management Portal

Web application for managing the participants of the [Data Sharing Framework](https://dsf.dev) (DSF) in the German Medical Informatics Initiative (MII) and the Network University Medicine (NUM). Sites maintain their organization, endpoints, certificates and memberships; administrators approve changes; the portal publishes the result as the signed DSF allow list.

Operated by the [Institute of Medical Informatics](https://www.medizin.uni-muenster.de/imi/das-institut.html), University of Münster.

## Features

- **Site data on one page.** Organization, contacts, endpoints, certificates and memberships of a DSF instance, with their relations.
- **Four-eyes approval.** A change reaches the allow list only after two administrators from different sites approve it, or one approves and nobody objects for seven days.
- **Versioned allow list.** Every published version is kept, with diff, signed download and a four-eyes restore.
- **FHIR bundle for the DSF.** The BPE process `downloadAllowList` fetches the RS256-signed bundle over mTLS.
- **Sign-in.** Client certificate, or e-mail one-time code plus TOTP. The DSF certificate of a site becomes its login once it is on the approved allow list.
- **Administration.** Users and admin roles, CA white- and blacklist, bulk onboarding from CSV/XLSX, scheduled backups, audit log with export.
- **Network map** of all sites and their networks.

<table>
<tr>
<td width="33%"><a href="docs/screenshots/01-canvas.png"><img src="docs/screenshots/01-canvas.png" alt="Site data" /></a></td>
<td width="33%"><a href="docs/screenshots/02-map.png"><img src="docs/screenshots/02-map.png" alt="Network map" /></a></td>
<td width="33%"><a href="docs/screenshots/03-admin-approval.png"><img src="docs/screenshots/03-admin-approval.png" alt="Approval review" /></a></td>
</tr>
</table>

## Quick start

Requires Docker and Git.

```bash
git clone https://github.com/Mukeyii/num-dsf-allowlist.git
cd num-dsf-allowlist
cp .env.example .env
bash scripts/generate-keys.sh
docker compose up -d
docker compose exec backend npx ts-node src/db/seed-whitelist.ts admin@example.com
docker compose exec backend npx ts-node src/db/seed-testdata.ts   # optional demo data
```

The portal runs at <http://localhost>, the API at <http://localhost/api/v1>, and the development mailbox (Mailhog) at <http://localhost:8025>.

## Development

```bash
docker compose exec backend npm test     # backend tests (Jest, needs the stack)
cd frontend && npm test                  # frontend tests (Vitest)
cd frontend && npm run test:e2e          # Playwright end-to-end tests (needs the stack)
cd frontend && npm run test:contract     # contract tests against the real backend
```

Type-check with `npx tsc --noEmit` in `backend/` and `frontend/`. Commits follow Conventional Commits; the git hooks (husky) run Prettier, commitlint and, if installed, gitleaks. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

```
frontend/        React, TypeScript, Vite, Tailwind
backend/         Node.js, Express, TypeScript
db/migrations/   MySQL 8 schema (idempotent SQL)
nginx/           reverse proxy configurations
scripts/         key generation, server update, backup and restore
docs/            guides, ADRs, screenshots
```

## Deployment

Production runs with Docker Compose behind a TLS-terminating reverse proxy. Installation, updates, environment variables, migrations, certificate sign-in, and backup and restore are described in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md); running from the released images in [`docs/RUN-FROM-IMAGE.md`](docs/RUN-FROM-IMAGE.md).

## Documentation

| Topic | Where |
|---|---|
| Getting started, admin guide, FAQ | [`docs/wiki/`](docs/wiki/) |
| API reference | [`docs/wiki/API-Reference.md`](docs/wiki/API-Reference.md) |
| Site automation (certificate renewal) | [`docs/automation.md`](docs/automation.md) |
| Architecture and decisions | [`docs/wiki/Architecture.md`](docs/wiki/Architecture.md), [`docs/adr/`](docs/adr/) |
| Database schema and migrations | [`docs/database/`](docs/database/) |
| Security policy | [`SECURITY.md`](SECURITY.md) |

## Security

Sessions use RS256-signed JWTs with revocable refresh tokens. Sensitive admin actions need a fresh second factor. Uploads containing a private key are rejected and never logged, the audit log is append-only, and contact data is never published in the allow list. Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## License

Apache 2.0, see [`LICENSE`](LICENSE). Institute of Medical Informatics, University of Münster.
