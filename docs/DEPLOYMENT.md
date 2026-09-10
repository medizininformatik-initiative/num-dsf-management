# Deployment Guide

## Prerequisites

- Docker Desktop (or Docker Engine + Compose Plugin)
- SSL certificates in `certs/` (server.crt, server.key)
- `.env.prod` filled (from `.env.prod.example`)

## Environment variables

All configuration flows through env vars (no hardcoded secrets). Copy `.env.example` to `.env` and fill in.

**Application:**
- `NODE_ENV` — `production` in prod
- `PORT` — backend HTTP port (default 3000)
- `FRONTEND_URL` — public URL for CORS and email links

**Database:**
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

**Redis:**
- `REDIS_URL`

**JWT (RS256, asymmetric):**
- `JWT_PRIVATE_KEY_BASE64` — base64-encoded RSA private key
- `JWT_PUBLIC_KEY_BASE64` — base64-encoded RSA public key
- `JWT_EXPIRES_IN` — e.g. `15m`
- `REFRESH_TOKEN_EXPIRES_IN` — e.g. `7d`

**TOTP encryption:**
- `TOTP_ENCRYPTION_KEY` — 32-byte hex key for AES-256 encryption of TOTP secrets at rest

**Mail (SMTP):**
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`

**DSF environment indicator:**
- `DSF_ENVIRONMENT` — `TEST` or `PRODUCTION`
- `DSF_ENV_COLOR` — hex color for the environment badge

**Rate limiting (Redis-backed):**
- `RATE_LIMIT_OTP_MAX` (default 5), `RATE_LIMIT_OTP_WINDOW_MS` (default 900000)
- `RATE_LIMIT_API_MAX` (default 100), `RATE_LIMIT_API_WINDOW_MS` (default 60000)

**Admin team:**
- `IMI_ADMIN_EMAILS` — comma-separated list. Each admin's email **domain** is treated as their "site" for the 4-eyes approval rule.
- `IMI_ADMIN_CERT_FINGERPRINTS` (cert-auth variant only). Comma-separated `email=fingerprint` pairs that let IMI admins sign in by client certificate on the login-screen-free box. The fingerprint is the SHA-512 hash of the admin's client cert (128 hex chars; colons and case are ignored). It is re-seeded on every boot, so pairs can be appended later. Use the same address here and in `IMI_ADMIN_EMAILS`: the first grants the login, the second grants the admin role.

**Approval workflow:**
- `APPROVAL_SILENT_CONSENT_DAYS` — number of days a single-approved request waits before auto-approving via silent consent (Schweigen als Zustimmung). Default `7`.

**Session inactivity:**
- `IDLE_TIMEOUT_MS` — sliding inactivity timeout (default 1800000)

## First Production Deploy

```bash
# 1. Clone
git clone <repo-url>
cd num-dsf-allowlist

# 2. Environment
cp .env.prod.example .env.prod
# Fill .env.prod with real secrets

# 3. Generate keys
bash scripts/generate-keys.sh

# 4. Seed admin email
docker compose -f docker-compose.prod.yml run --rm backend \
  node dist/db/seed-whitelist.js admin@imi.uni-muenster.de

# 5. Start
docker compose -f docker-compose.prod.yml up -d --build

# 6. Check logs
docker compose -f docker-compose.prod.yml logs -f backend
```

## Run from a downloaded image (no build, offline-capable)

> For a step-by-step walkthrough (including a local test on Windows), see
> [RUN-FROM-IMAGE.md](RUN-FROM-IMAGE.md).

Every push to `main` produces a **downloadable image bundle** as a CI artifact
(`dsf-allowlist-images-<sha>.tar.gz`, on the workflow run's summary page). Each
tagged **GitHub Release** additionally attaches that bundle, its `.sha256`, and a
**run-kit** (`dsf-allowlist-runkit-<tag>.tar.gz`) as downloadable assets. The
run-kit contains `docker-compose.release.yml`, the nginx configs,
`.env.prod.example`, `db/migrations/`, and a preset `.image.env`
(`IMAGE_OWNER`/`IMAGE_TAG`).

Run it without building anything:

```bash
# 1. Download the image bundle + run-kit from the Release page, then:
sha256sum -c dsf-allowlist-images-<tag>.tar.gz.sha256
docker load < dsf-allowlist-images-<tag>.tar.gz      # loads backend + frontend images

# 2. Unpack the run-kit and configure
tar xzf dsf-allowlist-runkit-<tag>.tar.gz
cp .env.prod.example .env.prod

# Generate the required RS256 JWT keypair + TOTP key straight into .env.prod
# (the backend refuses to start if any of these are empty):
openssl genrsa -out jwt_priv.pem 2048
openssl rsa -in jwt_priv.pem -pubout -out jwt_pub.pem
sed -i "s|^JWT_PRIVATE_KEY_BASE64=.*|JWT_PRIVATE_KEY_BASE64=$(base64 -w0 jwt_priv.pem)|" .env.prod
sed -i "s|^JWT_PUBLIC_KEY_BASE64=.*|JWT_PUBLIC_KEY_BASE64=$(base64 -w0 jwt_pub.pem)|" .env.prod
sed -i "s|^TOTP_ENCRYPTION_KEY=.*|TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env.prod
rm jwt_priv.pem jwt_pub.pem

# Then edit .env.prod and set the remaining secrets:
#   DB_ROOT_PASSWORD, DB_NAME, DB_USER, DB_PASSWORD, REDIS_PASSWORD,
#   SMTP_*, MAIL_FROM, IMI_ADMIN_EMAILS, DSF_ENVIRONMENT.
mkdir -p certs                                        # add server.crt/key (+ client-ca.crt)

# 3. Start — .image.env carries IMAGE_OWNER/IMAGE_TAG; .env.prod carries secrets
docker compose --env-file .env.prod --env-file .image.env -f docker-compose.release.yml up -d
```

Or pull from the registry instead of loading the file (online):

```bash
docker pull ghcr.io/<owner>/dsf-allowlist-backend:<tag>
docker pull ghcr.io/<owner>/dsf-allowlist-frontend:<tag>
```

`docker-compose.release.yml` uses `image:` (no `build:`), so it runs the loaded or
pulled images directly; nginx uses the stock unprivileged image with the mounted
config. The bundled frontend image is the standard OTP/TOTP build; the cert-auth
variant (`VITE_AUTH_MODE=cert`) is baked at build time, so it is not part of the
downloadable bundle — build it locally via `docker-compose.cert-auth.yml`.

## Update Process

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build --no-deps backend frontend
```

For a server with no git that instead unpacks a downloaded zip, see "Updating a zip-based deployment" right below.

### Updating a zip-based deployment (no git on the server)

This server has no git; the operator downloads the `main` branch as a zip, unpacks it next to the running stack, and lets `scripts/update-server.sh` apply it in place. Run the script with `--help` for the full step list and environment overrides.

**1. Get the new tree onto the server**

The repository is private, so download the zip from a browser session that is already logged in to GitHub, or with a personal access token:

```bash
# Browser: https://github.com/Mukeyii/num-dsf-allowlist/archive/refs/heads/main.zip
# then copy the file to the server (scp/sftp), or from the server itself with a token:
curl -L -H "Authorization: token <TOKEN>" \
  -o /tmp/dsf-main.zip \
  https://github.com/Mukeyii/num-dsf-allowlist/archive/refs/heads/main.zip

mkdir -p /tmp/dsf-new
unzip -q /tmp/dsf-main.zip -d /tmp/dsf-new
# unpacks to /tmp/dsf-new/num-dsf-allowlist-main
```

**2. Preview, then apply**

```bash
cd /opt/dsf-allowlist
scripts/update-server.sh /tmp/dsf-new/num-dsf-allowlist-main --dry-run
scripts/update-server.sh /tmp/dsf-new/num-dsf-allowlist-main
```

The dry run reports exactly which files rsync would change and which migrations are pending, without touching anything (no copy, no database, no rebuild). Review it before running for real.

**What the script preserves.** `.env.prod`, `.env`, `docker-compose.apache.yml` (the Apache override, which is not part of the repo), `hackathon/`, `.migrations-applied`, `certs/`, `node_modules/` and `.git/` are all excluded from the copy, so a server-local file is never overwritten by the new tree. No `--delete` is ever used, so files removed from the repo are simply left behind on the server.

**How `.migrations-applied` works.** This file lists every migration basename already applied to this database, one per line. The first time the script runs against a given server it does not exist yet, so the script infers a baseline from whatever is currently in `db/migrations/` (those were applied at first init) and prints a warning; from then on, each migration the script applies successfully is appended to the file. If a migration is ever applied by hand outside the script (for example while debugging), add its basename to `/opt/dsf-allowlist/.migrations-applied` on its own line afterwards, otherwise the script will try to apply it again on the next update and fail on a duplicate.

**Rollback.** Keep the previous zip around. To roll back the code, unpack that older zip and re-run the script with it; database migrations are forward-only, so a rollback never undoes a migration that was already applied.

## Database migrations

Migrations live at `db/migrations/*.sql` (NOT under `backend/src/`). The dev and cert-auth stacks mount this directory into the MySQL container at `/docker-entrypoint-initdb.d/`, so on a fresh data volume every migration runs once, in filename order, at first init. The `prod` and `release` composes do not auto-mount them; apply them with the command below (the release run-kit ships `db/migrations/` for exactly this).

To apply a NEW migration to a running production DB without restarting:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  mysql -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} < db/migrations/006_*.sql
```

Each migration is a single `.sql` file with a 3-digit prefix. Files are applied in alphabetical order. Always inspect a migration before applying — there are no automated reverse migrations.

## Client-certificate sign-in (mTLS)

The portal supports two passwordless authentication paths:
1. **Email + OTP + TOTP** (default OTP/TOTP stack).
2. **Browser client certificate**, which signs the user in with no login screen (cert-auth stack).

Two distinct certificate hashes are in play; do not confuse them:

- **Human sign-in** matches the client cert's **SHA-512 fingerprint** against `admin_cert_fingerprints` (admins are checked first) and then `organizations.client_cert_fingerprint` (per site). This is the allow-list gate for logging in.
- **FHIR bundle download** by a DSF process still matches the machine cert's **SHA-256 thumbprint** against `organizations.client_cert_thumbprint`. That path is unchanged and independent of sign-in.

For the browser sign-in to work, nginx terminates TLS, requests the client cert, and forwards it to the backend:

- Mount `/etc/nginx/certs/server.crt` and `/etc/nginx/certs/server.key` (the TLS cert/key for the HTTPS listener).
- Mount `/etc/nginx/certs/client-ca.crt`. With `ssl_verify_client optional_no_ca`, even a self-signed DSF leaf cert completes the handshake and is forwarded to the backend; the fingerprint match is the real gate.

nginx forwards the URL-encoded PEM as `X-Client-Cert` and the verify result as `X-Client-Verify`. The backend trusts the cert only when `X-Client-Verify: SUCCESS`, so nginx must be the only ingress; the HTTP vhost clears these headers and redirects to HTTPS.

Computing a certificate's SHA-512 fingerprint (the value the allow-list stores):

```bash
# GnuTLS certtool (the value shown to operators)
certtool --fingerprint --hash=sha512 --infile=client_certificate.pem

# OpenSSL equivalent: SHA-512 of the DER encoding
openssl x509 -in client_certificate.pem -outform DER | openssl dgst -sha512
```

Both print 128 hex characters (certtool colon-separates them). The portal normalizes on input, so colons and letter case do not matter.

A per-site login certificate is registered either by the site itself in the Organization edit modal, or in bulk by an admin (see the onboarding section below).

### Certificate-auth deployment variant (login-screen-free)

`docker-compose.cert-auth.yml` is a site-facing stack that skips the login screen and signs users in by client certificate at nginx (see ADR-005). It differs from `docker-compose.prod.yml` in only two ways: the frontend is built with `VITE_AUTH_MODE=cert` (no login UI; `AuthBootstrap` calls `/auth/client-cert-login` automatically), and nginx mounts `nginx/nginx.cert-auth.conf`, which returns `403` for every OTP/TOTP endpoint so they cannot be reached even by a crafted request. The two stacks run independently.

IMI admins also sign in on this box by their own client certificate, seeded via `IMI_ADMIN_CERT_FINGERPRINTS`. There is no separate OTP deployment to maintain for admins and no OTP fallback: a browser that presents an unregistered cert (or none) lands on a status page explaining how to get registered.

**Accepted residual risk:** sensitive admin writes (approving a request, editing another org's data) still require step-up re-verification, but on this stack that step-up is a re-presented client certificate instead of a typed TOTP code. Certificate step-up is non-interactive: the browser attaches the certificate to every request on its own, so it does not prove the admin intended this particular action the way entering a fresh TOTP code does. Script running inside the page, for example from an XSS bug or a malicious browser extension, could perform an admin write under this guard the same way a genuine click would. The Content-Security-Policy and the same-origin session cookie are the controls for this path, so admins using the cert profile should keep browser extensions to a minimum.

### Debian install, step by step (cert-auth variant)

First-time install on a fresh Debian host that already has Docker Engine and the Compose plugin, plus the server TLS certificate and key. This brings up the login-screen-free stack, bootstraps the first admin by certificate, and leaves you ready to onboard sites.

**1. Get the code onto the box**

```bash
git clone <repo-url> dsf-allowlist
cd dsf-allowlist
```

(Or unpack a release run-kit; its compose file and `db/migrations/` are included.)

**2. Place the TLS material**

```bash
mkdir -p certs
cp /path/to/server.crt certs/server.crt
cp /path/to/server.key certs/server.key
# Trust anchor for client certs. With optional_no_ca any readable PEM works;
# if you have no dedicated client CA, the server cert is an acceptable placeholder.
cp /path/to/client-ca.crt certs/client-ca.crt 2>/dev/null || cp certs/server.crt certs/client-ca.crt
chmod 600 certs/server.key
```

**3. Create `.env.prod`**

```bash
cp .env.prod.example .env.prod
# Generate the RS256 JWT keypair + TOTP key straight into .env.prod
# (the backend refuses to start if any of these are empty):
openssl genrsa -out jwt_priv.pem 2048
openssl rsa -in jwt_priv.pem -pubout -out jwt_pub.pem
sed -i "s|^JWT_PRIVATE_KEY_BASE64=.*|JWT_PRIVATE_KEY_BASE64=$(base64 -w0 jwt_priv.pem)|" .env.prod
sed -i "s|^JWT_PUBLIC_KEY_BASE64=.*|JWT_PUBLIC_KEY_BASE64=$(base64 -w0 jwt_pub.pem)|" .env.prod
sed -i "s|^TOTP_ENCRYPTION_KEY=.*|TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env.prod
rm jwt_priv.pem jwt_pub.pem
```

Then edit `.env.prod` and set at least `DB_ROOT_PASSWORD`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `REDIS_PASSWORD`, `SMTP_*`, `MAIL_FROM`, `DSF_ENVIRONMENT`, and the two admin variables in step 4.

**4. Bootstrap the first admin by certificate**

The admin needs both variables: `IMI_ADMIN_EMAILS` grants the admin role, `IMI_ADMIN_CERT_FINGERPRINTS` lets that same admin sign in by cert. Compute the SHA-512 fingerprint of the admin's own client certificate and register the pair.

```bash
FP=$(certtool --fingerprint --hash=sha512 --infile=admin-client.pem | tr -d ': \n')
# Set in .env.prod (same address in both):
#   IMI_ADMIN_EMAILS=dsf-admin@imi.uni-muenster.de
#   IMI_ADMIN_CERT_FINGERPRINTS=dsf-admin@imi.uni-muenster.de=$FP
```

**5. Start the stack**

```bash
docker compose --env-file .env.prod -f docker-compose.cert-auth.yml up -d --build
```

On first boot the MySQL container runs every file in `db/migrations/` in order (this creates the SHA-512 fingerprint column and the admin cert table); the backend then seeds the admin grant and the admin cert fingerprint and becomes healthy, and nginx starts.

**6. Verify**

```bash
curl -k https://localhost/health          # backend liveness through nginx
docker compose -f docker-compose.cert-auth.yml logs -f backend
```

Open the site in a browser that has the admin client certificate installed. You should land in the app with no login screen. If you see the status page instead, the presented cert's fingerprint is not the one in `IMI_ADMIN_CERT_FINGERPRINTS`; re-check step 4.

**7. Onboard the participating sites** (see "Onboarding sites in bulk" below).

### Fronting the app with your own Apache2 instead of the bundled nginx

The bundled nginx already performs the client-cert authentication, and it is the tested path. If you must terminate TLS at an existing Apache2 on the host, Apache has to reproduce exactly what `nginx/nginx.cert-auth.conf` does, because the backend trusts these headers:

- Enable `proxy`, `proxy_http` and `headers`, and put the app in its **own** vhost file with an explicit `ServerName` so the distribution's default vhosts stay untouched.
- Request the client cert without a hard CA requirement: `SSLVerifyClient optional_no_ca`, plus `SSLOptions +StdEnvVars +ExportCertData` so the PEM is available.
- Clear the headers first, then set them from mod_ssl. Clearing is the security control: without it a client could simply send `X-Client-Verify: SUCCESS` plus someone else's certificate.
  ```apache
  RequestHeader unset X-Client-Cert
  RequestHeader unset X-Client-Verify
  RequestHeader unset X-Ssl-Client-Cert
  RequestHeader set X-Client-Verify "SUCCESS" "expr=%{SSL:SSL_CLIENT_VERIFY} =~ /^(SUCCESS|GENEROUS|FAILED:(self.signed|unable to ))/"
  RequestHeader set X-Client-Cert "expr=%{escape:%{SSL:SSL_CLIENT_CERT}}" "expr=%{SSL:SSL_CLIENT_VERIFY} =~ /^(SUCCESS|GENEROUS|FAILED:(self.signed|unable to ))/"
  ```
  `%{escape:...}` percent-encodes the PEM, which is what nginx's `$ssl_client_escaped_cert` does and what the backend's `decodeURIComponent` expects. A raw `%{SSL_CLIENT_CERT}s` would put bare newlines into a header.
- **Accepting `FAILED:self-signed` is required, not sloppy.** nginx with `optional_no_ca` skips chain validation entirely and reports `SUCCESS`. Apache still reports the OpenSSL result, and under TLS 1.3 a self-signed client cert arrives as `FAILED:self-signed certificate` rather than `GENEROUS`, so a `SUCCESS|GENEROUS`-only match silently drops every DSF certificate. The pattern above admits exactly the self-signed and unknown-issuer cases that `optional_no_ca` is meant to allow, while still rejecting `FAILED:certificate has expired` and `FAILED:certificate revoked`. The real gate stays the SHA-512 fingerprint match.
- Return `403` for `/auth/request-otp`, `/auth/verify-otp`, `/auth/verify-totp`, `/auth/setup-totp`, and `/auth/confirm-totp` so the OTP path stays closed.
- Proxy `/api/`, `/auth/`, `/fhir/` and `/health` to the backend and `/` to the frontend (the frontend image does its own SPA fallback, so no 404 rewriting is needed). Set `RequestHeader set X-Forwarded-Proto "https"` so the session cookie stays `secure`.

To debug a cert that will not authenticate, log both layers for one request and compare them:

```apache
LogFormat "verify=[%{SSL_CLIENT_VERIFY}x] dn=[%{SSL_CLIENT_S_DN}x] hdr_verify=[%{X-Client-Verify}i]" dsfdebug
CustomLog ${APACHE_LOG_DIR}/dsf-debug.log dsfdebug
```

An empty `dn` means the cert never reached Apache (TLS layer); a populated `dn` with `hdr_verify=[-]` means the `expr=` condition did not match. Remove the debug log afterwards, since it can record the full certificate.
- Ensure no other vhost or location can inject `X-Client-Cert` / `X-Client-Verify`, and that Apache is the only ingress to the app containers (do not publish the backend or the internal nginx ports).

The security model is identical to the nginx variant: the SHA-512 fingerprint match is the gate, and it is only sound if the front proxy is the sole entry point.

### Onboarding sites in bulk (admin upload)

Once an admin can sign in, new sites are onboarded from **Administration > Onboarding** (`/app/admin/onboarding`) by uploading a CSV or JSON file. Each row creates or updates a complete site in one transaction: the organization, its instance, the contact user, the allow-list entry, and the client-certificate fingerprint. Re-uploading the same file is idempotent (existing sites are updated, not duplicated).

Columns (CSV header row) or object keys (JSON):

| Field | Required | Notes |
|---|---|---|
| `organizationIdentifier` | yes | FQDN, e.g. `ukm.de`. Lower-cased. Primary key of the site. |
| `organizationName` | yes | 1 to 255 characters. |
| `contactEmail` | yes | Becomes the site's login user and allow-list entry. |
| `clientCertFingerprint` | yes | SHA-512 fingerprint of the site's browser client cert (128 hex; colons and case are ignored). |
| `city` | no | Up to 100 characters. |
| `countryCode` | no | Two letters, e.g. `DE`. |

CSV example:

```csv
organizationIdentifier,organizationName,contactEmail,clientCertFingerprint,city,countryCode
ukm.de,Uniklinik Muenster,dsf@ukm.de,3f1c...<128 hex>...,Muenster,DE
```

JSON example:

```json
[
  {
    "organizationIdentifier": "ukm.de",
    "organizationName": "Uniklinik Muenster",
    "contactEmail": "dsf@ukm.de",
    "clientCertFingerprint": "3f1c...<128 hex>...",
    "city": "Muenster",
    "countryCode": "DE"
  }
]
```

The upload is admin-only and hardened at the boundary:

- The endpoint (`POST /api/v1/admin/onboarding/import`) requires an authenticated IMI admin; anyone else gets `403`.
- It is rate-limited (10 requests per 15 minutes per user).
- The body is capped at 1 MB (`413`) and 1000 rows (`413`).
- A file that contains a PEM block (`-----BEGIN`) is rejected outright (`400`), so a private key or certificate body is never accepted here.
- Cells that start with a formula character (`=`, `+`, `-`, `@`) or a leading tab/CR are rejected, which blocks CSV/spreadsheet formula injection.
- A fingerprint already registered to a different organization is refused for that row (`FINGERPRINT_IN_USE`); a unique index enforces it as a backstop.
- Every imported row is written to the append-only audit log with only the first 16 characters of the fingerprint, never the full value.

A row that fails validation does not abort the import: the response reports a per-row result (`created` / `updated` / `failed` with the reason) plus a summary, and the UI shows the same table so an admin can fix and re-upload only the bad rows.

How a site obtains its fingerprint: it runs `certtool --fingerprint --hash=sha512 --infile=client_certificate.pem` on its browser client certificate and sends you that value plus the minimal org data above. After import, the site reaches the portal with its certificate and no login screen.

### Hackathon / demo seed

`scripts/hackathon-prepare.sh` prepares a repeatable demo environment on the cert-auth stack: N fictional users (default 3), each with a freshly generated self-signed client certificate, a complete dummy site (organization, contacts, endpoints with IPs, a certificate, memberships), and a PENDING approval request already waiting for review.

```bash
scripts/hackathon-prepare.sh              # 3 users, output in /opt/dsf-allowlist/hackathon
scripts/hackathon-prepare.sh 5 /opt/dsf-allowlist/hackathon-2026
```

The stack must already be running: the seed executes inside the running backend container (`docker compose exec`, manifest on stdin), so no extra container, mount or port is involved.

What it creates, per user:

- `hack<i>@klinik-<i>.example.de` / `klinik-<i>.example.de`, all under the fictional `.example.de` domain and RFC 5737 test IP ranges, never real data.
- A self-signed client certificate, key, and `.p12` bundle (password printed once in the script's summary unless `HACKATHON_P12_PASSWORD` is set) for importing into a browser.
- IMI admin rights for every user, each on a different email domain. The 4-eyes approval rule (site identity = email domain, see `lib/approvalState.ts`) is domain-based, so any two hackathon users can approve or reject each other's onboarding requests.
- A `manifest.json` (consumed by `backend/src/db/seed-hackathon.ts`, the actual database writer) and an `onboarding.csv` as a bonus, ready to upload at `/app/admin/onboarding` if you would rather demo the bulk-import UI with the same data.

The script is idempotent: re-running it regenerates every certificate and key from scratch and re-seeds the database. Any `.p12` already handed out from an earlier run stops working the moment the script re-runs, so redistribute the new files after every run.

Running the script again with a smaller N does not remove the extra users from a larger previous run; delete those manually. To remove a seeded hackathon user, delete its email everywhere it is referenced. `users` cascades to the instance, organization, contacts, endpoints, certificates, memberships, and approval request, so that single delete does most of the work; `admin_grants`, `admin_cert_fingerprints`, and `email_whitelist` are not linked by a foreign key and need their own delete:

```sql
DELETE FROM admin_grants WHERE email = 'hack1@klinik-1.example.de';
DELETE FROM admin_cert_fingerprints WHERE email = 'hack1@klinik-1.example.de';
DELETE FROM email_whitelist WHERE email = 'hack1@klinik-1.example.de';
DELETE FROM users WHERE email = 'hack1@klinik-1.example.de';
```

The audit log entries the seed writes are not removed by this (`audit_logs` is append-only, see the Admin grants section below); that is expected and matches how every other mutation in this portal is audited.

### Hackathon rehearsal

`scripts/hackathon-smoke.sh` is an end-to-end rehearsal for the setup above: run it against a deployed cert-auth stack right after `scripts/hackathon-prepare.sh` to prove cert login, the four-eyes approval workflow, bulk CSV onboarding, and the allow-list bundle all actually work together, not just individually.

```bash
scripts/hackathon-prepare.sh 3 /opt/dsf-allowlist/hackathon
scripts/hackathon-smoke.sh https://dsf-management.example.de
```

Usage: `scripts/hackathon-smoke.sh <BASE_URL> [HACKATHON_DIR] [--keep]`. `HACKATHON_DIR` defaults to `/opt/dsf-allowlist/hackathon` and must contain `hack1.crt/.key` through `hack3.crt/.key`. `--keep` leaves the site the script onboards in step 6 in place instead of removing it at the end. `SMOKE_INSECURE=1` adds `curl --insecure`, needed for a self-signed dev TLS certificate (e.g. the plain `docker-compose.yml` stack over `https://localhost`). Requires `curl`, `openssl`, and either `python3`/`python` or `jq`.

Every check prints `PASS`/`FAIL`/`INFO` with the HTTP status and a one-line reason, and the script stops at the first `FAIL` after printing a summary table. Tokens and fingerprints are never printed in full.

**What each step proves, and what a FAIL there usually means:**

1. **Reachability** (`GET /health/ready`). The stack is up and the backend can reach MySQL and Redis. A FAIL here is almost always infrastructure, not this feature: containers not started, `.env`/`.env.prod` missing a DB or Redis value, or (on the plain dev nginx config) `/health` not proxied to the backend.
2. **Cert login** for hack1/hack2/hack3 (`POST /auth/client-cert-login`). Proves the reverse proxy performs the mTLS handshake and forwards `X-Client-Cert`/`X-Client-Verify`, and that the backend resolves the SHA-512 fingerprint to the right admin. A FAIL usually means the reverse proxy in front of `BASE_URL` is not reproducing `nginx/nginx.cert-auth.conf` (see "Fronting the app with your own Apache2" above), or the hackathon certs were regenerated after the DB was last seeded.
3. **Identity and instance scoping** (`GET /auth/me`, `GET /api/v1/instances`, `GET /api/v1/instances/:id/organization`). Proves the JWT carries the right identity and admin flag, and that the seeded organization is reachable. Every hackathon user is an IMI admin, and `instances.service.ts`'s `listForUser()` gives admins cross-tenant visibility (see its own comment), so this checks the list *contains* the user's own instance, not that it is the only one; a FAIL here on a fresh stack usually means the seed did not run or ran against a different database than `BASE_URL` is pointed at.
4. **Negative auth checks.** No certificate presented must fail login; a valid bearer token with the certificate NOT re-presented must fail a step-up-gated write with `CERT_STEP_UP_FAILED` (`backend/src/middleware/stepUp.middleware.ts`) - this is the check that proves a stolen access token cannot forge the cert step-up. `POST /auth/request-otp` returning `403` proves the OTP entry surface is closed on a cert-auth deployment; on the standard OTP/TOTP stack it is expected to stay open, so that case is only an `INFO`, never a `FAIL`.
5. **Four-eyes approval.** This is the step most worth reading before assuming a FAIL is a real bug, because the exact sequence was derived from `backend/src/lib/approvalState.ts` and `backend/src/services/approval.service.ts`, not assumed:
   - There is no rule against approving your own site's request. `validateApproval()` only tracks which *sites* (email domains) have signed, so hack1 can sign its own pending request; it simply counts as the first of the two signatures needed.
   - `deriveStatus()` promotes to `APPROVED` as soon as two signatures from two *different* sites exist - two, not three. A third admin who tries afterwards gets `REQUEST_FINALIZED`, because `approveRequest()` checks the request's status before it looks at who is signing.
   - `ALREADY_DECIDED` only happens when the same admin signs twice while the request is still `PENDING`. Once a request is finalized, any further attempt (a new admin or a repeat one) is `REQUEST_FINALIZED`, never `ALREADY_DECIDED`.
   - A FAIL in this step almost always means the approval state machine changed; diff `approvalState.ts` against the expectations coded into `scripts/hackathon-smoke.sh`'s step 5 comments.
6. **Bulk CSV onboarding** (`POST /api/v1/admin/onboarding/import`). Create, then re-upload the same row (must report `updated`, not a duplicate `created`), then log in with the newly onboarded cert. Also checks the two upload-level guards: a PEM anywhere in the file is rejected with `PEM_NOT_ALLOWED` before any row is parsed, and a row whose organization name starts with `=`/`+`/`-`/`@` is reported as a parse error (CSV/Excel formula-injection guard), not imported. A FAIL here usually points at `onboarding.service.ts`'s validation changing shape.
7. **Allow-list bundle** (`GET /fhir/Bundle`, the endpoint the DSF `UpdateAllowList` process reads). Checks it is a well-formed FHIR Bundle containing all three hackathon sites plus the parent `hackathon-hub.example.de` and at least one `OrganizationAffiliation` - all only true after step 5 actually finished approving them. It also asserts the site onboarded in step 6 is **absent**: bulk onboarding never inserts an `approval_requests` row (see `onboarding.service.ts`), and `generateFullBundle()` only includes an organization whose *latest* approval request is `APPROVED` (`fhir.service.ts`, and the regression test `fhir-bundle-latest-approval.test.ts`) - so a site that was only onboarded, never approved, must never show up here. If it does, onboarding has started bypassing the approval gate, which is a real regression, not a passing coincidence. A request with no client certificate at all must be rejected.
8. **GUI downloads** (`GET /api/v1/download/full-bundle`, `GET /api/v1/download/ip-address-list`). Confirms the authenticated-user bundle download and the admin Excel export both return a real, non-trivial body.
9. **Cleanup.** There is no admin API endpoint that deletes an organization outright, so the script uses the closest real mechanism - `DELETE /api/v1/admin/users/:email` - to remove the onboarded site's whitelist entry and revoke its sessions immediately, then prints the exact SQL still needed to remove the residual `organizations`/`instances`/`users` rows (mirroring the teardown SQL documented above for the hackathon seed itself). It then re-checks that the removed site's certificate no longer logs in. Pass `--keep` to skip this and inspect the onboarded site by hand instead.

**Known environment quirks (not bugs in the app):**

- All three nginx configs (`nginx.conf`, `nginx.prod.conf`, `nginx.cert-auth.conf`) put a tight `limit_req` on the whole `/auth/` prefix (5 requests/minute, burst 3-5) as a defense-in-depth throttle independent of the backend's own Redis-backed OTP rate limit. The smoke script paces its `/auth/*` calls to stay under this; if you see stray `429`s while experimenting by hand against `/auth/me` or `/auth/client-cert-login`, wait a minute or restart the stack's Redis-backed limiter state, it is not an application error.
- On the plain dev stack (`docker-compose.yml`), a long-running `backend` container's `ts-node-dev` process can miss file changes on a Windows Docker Desktop bind mount and keep serving stale compiled code (for example, silently omitting the JWT's `amr` claim). If step 4b fails with `TOTP_REQUIRED` instead of `CERT_STEP_UP_FAILED`, restart the backend container and re-run.

## Scheduled jobs

All UTC, configured in `backend/src/services/scheduler.service.ts`:

| When | Job | Purpose |
|---|---|---|
| 06:00 daily | `runApprovalReminders` | Re-emails admins for approval requests pending > 3 days |
| 07:00 daily | `runSilentConsentSweep` | Promotes single-approved requests older than `APPROVAL_SILENT_CONSENT_DAYS` to APPROVED |
| 08:00 daily | `runCertExpiryCheck` | Emails site contacts when their cert is < 30 days from expiry |
| 09:00 daily | `runMembershipCleanup` | Hard-deletes soft-deleted memberships older than 90 days |

The scheduler starts at backend boot (`backend/src/index.ts`). Jobs swallow individual failures so one bad iteration doesn't kill the runner.

## Allow-list bundle download

The portal is the central authority that generates the **network-wide** DSF allow-list. There is one bundle — every site downloads the same thing and installs it at its local DSF FHIR server.

- **GUI:** authenticated users hit `GET /api/v1/download/full-bundle` (cookie auth) and receive a FHIR JSON Bundle.
- **DSF process (mTLS):** the upstream `dsf-process-allow-list/DownloadAllowList` BPMN task reads `GET /fhir/Bundle?identifier=http://dsf.dev/fhir/CodeSystem/allow-list|allow_list` from this portal's FHIR endpoint; client cert is matched by SHA-256 thumbprint against `organizations.client_cert_thumbprint`.

The previous per-instance route (`/api/v1/instances/:id/download/bundle?endpointId=...`) is retained for backward compatibility with older clients but should NOT be used for new integrations.

## Federation safety

This portal is designed to coexist with other Allow-List tools (e.g. a NUM-operated tool, future regional operators) in a federated DSF P2P network:

- Bundles emit `DELETE` only on `OrganizationAffiliation`. `Organization` and `Endpoint` records are never deleted from a participant's local FHIR server through our bundle — they may be referenced by another tool's allow-list.
- The site-side `InsertAllowList` BPMN process applies multiple bundles sequentially; conflicts on `Organization` PUTs are idempotent (each tool emits the same single cert thumbprint, since per-site the client cert == server cert).
- Memberships removed via the UI are soft-deleted; the next bundle emission carries the corresponding DELETE-Affiliation entry; a daily cron at 09:00 UTC hard-deletes soft-rows older than 90 days.

To opt out of soft-delete retention (e.g. for non-federated single-tool deployments), set `MEMBERSHIP_SOFT_DELETE_RETENTION_DAYS=0` (cleanup runs every day and removes immediately).

## Admin grants & user management

Admin role lives in the `admin_grants` table; each row is signed RS256 over a canonical message (`email|granted_at|granted_by_a|granted_by_b`). The app verifies the signature on every admin check — a DB-only attacker can't forge admin role without the signing key.

### Signing keys

- **Default:** `ADMIN_GRANT_PRIVATE_KEY_BASE64` and `ADMIN_GRANT_PUBLIC_KEY_BASE64` (recommended — separate from JWT keys for rotation independence).
- **Fallback:** `JWT_PRIVATE_KEY_BASE64` / `JWT_PUBLIC_KEY_BASE64` if the dedicated keys aren't set.

Generate dedicated keys:

```bash
openssl genrsa 2048 > admin_grant_private.pem
openssl rsa -in admin_grant_private.pem -pubout > admin_grant_public.pem
echo "ADMIN_GRANT_PRIVATE_KEY_BASE64=$(base64 -w0 admin_grant_private.pem)"
echo "ADMIN_GRANT_PUBLIC_KEY_BASE64=$(base64 -w0 admin_grant_public.pem)"
```

### First-run bootstrap

If `admin_grants` is empty on backend startup, the bootstrap reads `IMI_ADMIN_EMAILS` and creates a signed grant per address (with `granted_by_a = granted_by_b = SYSTEM:bootstrap`). Subsequent runs ignore the env var.

Operators are encouraged to remove `IMI_ADMIN_EMAILS` from prod env after the first successful boot — the DB is now authoritative.

### Adding new admins (post-bootstrap)

Promotion requires the 4-eyes principle: an existing admin creates a promotion request via `/app/admin/users` (Promote button); a second admin from a **different site** (different email domain) approves via `/app/admin/promotions`. Both confirmations are explicit; there is no silent-consent timer.

### Locking and removing users

The whitelist UI (`/app/admin/users`) supports lock (reversible) and remove (permanent) for any whitelisted email. Lock/demote/remove revoke the affected user's refresh tokens — they cannot continue active sessions. Self-lock and self-remove are blocked. Demote/remove that would leave fewer than 2 admins from 2 distinct sites is rejected.

### Key rotation procedure

If the signing key is compromised:

1. Generate new keypair.
2. Re-sign all `admin_grants` rows with the new private key. (One-shot script: `npx ts-node backend/src/scripts/resign-admin-grants.ts` — write this script when needed.)
3. Update env vars and restart backend.
4. Audit-log entries are not affected; signatures are only verified going forward.

## Rollback

Before each production deploy, snapshot the running image SHAs:

```bash
docker compose -f docker-compose.prod.yml images backend > deploy-snapshot-$(date +%F).txt
docker compose -f docker-compose.prod.yml images frontend >> deploy-snapshot-$(date +%F).txt
```

To roll back code, redeploy a previous git tag:

```bash
git checkout <previous-tag>
docker compose -f docker-compose.prod.yml up -d --build
```

Database rollbacks: there are no automated reverse migrations. If a recent migration must be reverted, write a counter-migration (e.g. `007_revert_approval_signatures.sql`) and apply it as in the Migrations section.

## Backups

### Automated Backup Script

```bash
# Run manually
bash scripts/backup-db.sh

# Run with custom backup directory
bash scripts/backup-db.sh /mnt/backups

# Schedule via cron (daily at 2 AM)
0 2 * * * cd /path/to/num-dsf-allowlist && bash scripts/backup-db.sh >> /var/log/dsf-backup.log 2>&1
```

The script:
- Creates a gzip-compressed MySQL dump with `--single-transaction` (no locks)
- Retains the last 30 backups, older ones are automatically deleted
- Verifies backup integrity (non-empty file check)
- Uses `docker compose exec` to access the DB container

### Manual Restore

```bash
gunzip < backups/dsf_allowlist_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose exec -T db mysql -u root -p${DB_ROOT_PASSWORD} dsf_allowlist
```

## Health Check

```bash
curl https://allowlist.imi.uni-muenster.de/health
```

## Production security checklist

Before going live, confirm:

- [ ] `IMI_ADMIN_EMAILS` populated with real ops admin addresses.
- [ ] `APPROVAL_SILENT_CONSENT_DAYS` set to your policy (default `7`).
- [ ] `JWT_PRIVATE_KEY_BASE64` / `JWT_PUBLIC_KEY_BASE64` rotated from any dev values.
- [ ] `TOTP_ENCRYPTION_KEY` set to a fresh 32-byte hex value (and securely stored).
- [ ] `nginx/nginx.prod.conf` mounts `server.crt`, `server.key`, `client-ca.crt`.
- [ ] HTTP vhost redirects to HTTPS (no plain-text proxy in prod).
- [ ] `.env` is not in git (gitignored).
- [ ] Email transport (`SMTP_*`) tested with a real notification.
- [ ] Database backups configured (see Backups section).
- [ ] Monitoring covers backend `/health`, MySQL liveness, Redis liveness.

## Secret rotation

If any of these are believed to have leaked, rotate immediately:

### JWT signing keys
1. Generate new keypair: `bash scripts/generate-keys.sh`
2. Update `.env.prod` (or k8s secret) with new `JWT_PRIVATE_KEY_BASE64` / `JWT_PUBLIC_KEY_BASE64`.
3. Restart backend: `docker compose -f docker-compose.prod.yml restart backend`
4. All existing sessions invalidate immediately (signatures fail).
5. Users must log in again.

### TOTP encryption key
This key encrypts TOTP secrets at rest in the `users` table. Rotating it requires re-encrypting every row.
1. Decrypt all `users.totp_secret` rows with the OLD key.
2. Re-encrypt with the NEW key.
3. Update `.env.prod` with new `TOTP_ENCRYPTION_KEY` (32-byte hex).
4. Restart backend.

A migration script for this is not currently provided — write one if rotation becomes necessary.

### Admin-grant signing keys
If the `ADMIN_GRANT_PRIVATE_KEY_BASE64` is suspected leaked: every existing `admin_grants` row becomes worthless (an attacker could forge new ones). Procedure:
1. Generate new keypair (same approach as JWT keys).
2. Update both `ADMIN_GRANT_PRIVATE_KEY_BASE64` and `ADMIN_GRANT_PUBLIC_KEY_BASE64` in `.env.prod`.
3. Truncate `admin_grants` table — every row is now invalid because signatures verify with the new public key.
4. Restart backend; the bootstrap routine will re-sign grants for `IMI_ADMIN_EMAILS`. Set this env var to the trusted bootstrap list before restart.
5. Use `/app/admin/users` to re-promote anyone who was an admin before the rotation, via the 4-eyes flow.

### TLS server cert + client CA (./certs)
1. Generate new server cert/key + new client CA via your CA process.
2. Replace files in `./certs/` (host) with `chmod 600`, owned by the user the nginx container runs as.
3. Restart nginx: `docker compose -f docker-compose.prod.yml restart nginx`.
4. Verify with `openssl s_client -connect <host>:443 -showcerts`.
