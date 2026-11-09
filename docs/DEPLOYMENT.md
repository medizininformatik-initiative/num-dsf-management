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
- `RATE_LIMIT_CERT_LOGIN_MAX` (default 120), `RATE_LIMIT_CERT_LOGIN_WINDOW_MS` (default 900000). Limit of `POST /auth/client-cert-login` per presented certificate (SHA-512 fingerprint, the IP when there is none). Separate from the tight OTP bucket because the single-page app logs in on every reload and new tab.

**Admin team:**
- `IMI_ADMIN_EMAILS` — comma-separated list. Each admin's email **domain** is treated as their "site" for the 4-eyes approval rule.
- `IMI_ADMIN_CERT_FINGERPRINTS` (cert-auth variant only). Comma-separated `email=fingerprint` pairs that let IMI admins sign in by client certificate on the login-screen-free box. The fingerprint is the SHA-512 hash of the admin's client cert (128 hex chars; colons and case are ignored). It is re-seeded on every boot, so pairs can be appended later. Use the same address here and in `IMI_ADMIN_EMAILS`: the first grants the login, the second grants the admin role.

**Certificate authorities:**
- `CA_WHITELIST_ENFORCE`. Set to `true` to reject certificate uploads whose issuer is not on the CA whitelist (`CA_NOT_WHITELISTED`). Unset by default: other issuers, self-signed test certificates included, are accepted and shown without the DSF CA badge. The whitelist is seeded at init with the CAs DSF 2.1.1 accepts by default (migration 022: DFN, D-TRUST, GEANT and HARICA, Sectigo/USERTrust, T-TeleSec and others) and is managed through `/api/v1/admin/ca-whitelist`.

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

- **Human sign-in** matches the client cert's **SHA-512 fingerprint** against `admin_cert_fingerprints` (admins are checked first) and then `org_login_certificates` (per site, migration 029). This is the allow-list gate for logging in. `organizations.client_cert_fingerprint` is deprecated and no longer read for login.

**Login certificates and scoped sessions.** An admin certificate gives an unscoped admin session. A certificate listed in `org_login_certificates` gives a session scoped to exactly that organization's instance: the access token carries `kind: org` and `inst`, the session sees and changes only that instance (other instances of the same owner answer 403/404, creating instances is refused), and it is never admin, even if the instance owner holds an admin grant. Refresh needs the same certificate, and with `AUTH_MODE=cert` every request re-checks that the presented certificate still maps to the token's instance, so removing a login certificate ends the session on its next request. Admins decide which certificates may log in: in the certificates card of an organization (switch "Für Login freigeben", `Login` badge) or through `/api/v1/admin/organizations/:identifier/login-certificates`. The onboarding import writes its fingerprint there (source `ONBOARDING`); migration 029 copied the existing `client_cert_fingerprint` values (source `MIGRATED`). When the import re-onboards an existing site that an admin created in the GUI, the instance moves to the site's contact user, so the admin's instance switcher stops listing the clinic. Login certificates follow the approved allow list: once a request is approved (four-eyes or silent consent), every thumbprint of its snapshot may log in as the organization (source `APPROVAL`; a certificate an admin uploaded on the site's behalf, e.g. one sent by mail, only after two approvals from distinct sites, not after one approval plus silent consent), and an `APPROVAL` entry that a later approved request no longer lists is removed. Uploading a certificate links it to an existing fingerprint-only entry with the same thumbprint. Renewing a certificate keeps the old login until the old certificate expires, so the site can still sign in while the new one waits for approval. A daily job (08:00 UTC, migration 033) deletes certificates and login entries 30 days after expiry; the allow list drops the thumbprint with the site's next approved request. A certificate that is not enabled gets `CERT_NOT_REGISTERED` ("not enabled for sign-in"). A certificate belongs to one organization: uploading or renewing to a certificate whose thumbprint another organization registered, or whose fingerprint logs in for another organization, is refused with 409 `CERT_REGISTERED_ELSEWHERE`.
- **FHIR bundle download** by a DSF process resolves the machine cert by the SHA-512 login fingerprint, then the legacy SHA-256 `organizations.client_cert_thumbprint` (64 hex characters), then a certificate registered in the organization's certificate list (the DSF client certificate a BPE presents). The last two steps refuse a match that more than one organization claims (403). See "Allow-list bundle download" below.

A third, separate hash lives in the allow-list bundle content itself: each Organization's `extension-certificate-thumbprint` extension carries the **SHA-512** DSF thumbprint required by DSF's `dsf-extension-certificate-thumbprint-2.0.0` StructureDefinition (the `hex-128-length` constraint: 128 lower-case hex characters), computed from the stored certificate PEM. The `certificates.thumbprint` database column stays SHA-256; it is used only for the FHIR mTLS match above, not for the bundle content.

For the browser sign-in to work, nginx terminates TLS, requests the client cert, and forwards it to the backend:

- Mount `/etc/nginx/certs/server.crt` and `/etc/nginx/certs/server.key` (the TLS cert/key for the HTTPS listener).
- Mount `/etc/nginx/certs/client-ca.crt`. With `ssl_verify_client optional_no_ca`, even a self-signed DSF leaf cert completes the handshake and is forwarded to the backend; the fingerprint match is the real gate. nginx loads it as `ssl_trusted_certificate`, so it is not sent to clients as the only acceptable issuer (Java clients such as the DSF BPE would otherwise present no certificate).

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

**Backend enforcement (`AUTH_MODE=cert`).** `docker-compose.cert-auth.yml` sets `AUTH_MODE=cert` on the backend. Any other compose file that runs the certificate-only deployment, for example the Apache override on the production host, must set it too (`AUTH_MODE=cert` in `.env.prod` is enough). Without it the backend stays in the default OTP/TOTP mode and relies on the proxy alone. With it the backend itself:

- answers `403 OTP_DISABLED` on `/auth/request-otp`, `verify-otp`, `verify-totp`, `setup-totp`, `confirm-totp` (the proxy rule becomes defense in depth), and never serves `/auth/dev-login`;
- requires, on every authenticated request, a `cert` session (token claim `amr`) AND the proxy-verified client certificate, and checks that the certificate still maps to the token's user and the account is not locked. A stolen access token or refresh cookie is useless without the certificate, and removing a certificate from the portal ends the session on the next request;
- makes `/auth/refresh` require the matching certificate;
- applies the certificate step-up to the onboarding import as well (the other admin writes already had it).

What the code cannot do and the proxy must: with `SSLVerifyClient optional_no_ca` a TLS client without a certificate completes the handshake and can load the static frontend shell and `/health`; that exposes no data, because every API route and `/fhir/**` then answers 401. (Refusing even the shell would need `SSLVerifyClient require`, which the shared vhost cannot use because of the status page for unregistered certificates.) The proxy must also reset `X-Client-Cert`, `X-Client-Verify` and `X-Ssl-Client-Cert` on every request (see the Apache rules below), because the backend trusts them, and be the only network path to the backend.

**Accepted residual risk:** sensitive admin writes (approving a request, editing another org's data) still require step-up re-verification, but on this stack that step-up is a re-presented client certificate instead of a typed TOTP code. Certificate step-up is non-interactive: the browser attaches the certificate to every request on its own, so it does not prove the admin intended this particular action the way entering a fresh TOTP code does. Script running inside the page, for example from an XSS bug or a malicious browser extension, could perform an admin write under this guard the same way a genuine click would. The Content-Security-Policy and the same-origin session cookie are the controls for this path, so admins using the cert profile should keep browser extensions to a minimum.

### Admin-Zertifikat abgelaufen oder verloren

Apache weist abgelaufene Client-Zertifikate ab; mit einem abgelaufenen Admin-Zertifikat erreicht man die Anwendung nicht mehr. Vorbeugung und Wiederherstellung, in dieser Reihenfolge:

0. **Vorbeugen.** Das Portal speichert Ablaufdatum und letzte Nutzung jedes Admin-Zertifikats (Migration 030). Ab 30 Tagen vor Ablauf erscheint ein Hinweis im Portal (ab 7 Tagen rot), und der tägliche Zertifikatscheck (08:00 UTC) schickt Mails 30, 14, 7, 3 und 1 Tag vorher, sofern kein anderes, länger gültiges Admin-Zertifikat hinterlegt ist. Ein Nachfolge-Zertifikat hinterlegen Sie unter **Admin > Meine Admin-Zertifikate** (PEM, solange das aktuelle noch gültig ist).
1. **Kollege im Portal (Vier-Augen).** Ein anderer Admin öffnet **Admin > Benutzerverwaltung**, wählt bei der betroffenen Person **Zertifikate** und **beantragt** das neue Zertifikat. Es wird erst aktiv, wenn ein dritter Admin eines anderen Standorts (E-Mail-Domain) unter **Offene Zertifikatsanträge** zustimmt; weder die antragstellende Person noch die betroffene Person können zustimmen. Anträge verfallen nach 7 Tagen. Ein verlorenes oder kompromittiertes Zertifikat entfernen Sie dagegen sofort (das verringert nur den Zugriff). Alles braucht den Step-up, wird im Audit-Log protokolliert (Hinweis „Admin geändert“) und die betroffene Person erhält eine Mail.
2. **Server-CLI.** Sind alle Admins ausgesperrt, hinterlegt der Serverbetreiber ein Zertifikat direkt auf dem Server. Das funktioniert nur für eine E-Mail mit gültiger Admin-Berechtigung; Admin-Rechte zu vergeben bleibt das Vier-Augen-Verfahren im Portal.

   ```bash
   scripts/admin-cert.sh add admin@imi.uni-muenster.de /pfad/neues-zertifikat.pem --label "Notfall"
   scripts/admin-cert.sh list                 # alle Admin-Zertifikate mit Ablauf
   scripts/admin-cert.sh remove <fingerprint-prefix> --yes
   ```

   Das Skript nutzt dieselben Umgebungsvariablen wie `restore-backup.sh` (`DSF_ROOT`, `DSF_COMPOSE`), kopiert die Datei in den Backend-Container und prüft wie das Portal: kein privater Schlüssel, gültig, CA-Regeln, nicht bereits als Admin- oder Organisations-Login-Zertifikat vergeben. Der Eintrag erhält `created_by = server-cli` und einen Audit-Eintrag. Die CLI umgeht bewusst das Vier-Augen-Verfahren aus Schritt 1: Root auf dem Server ist der Vertrauensanker.
3. **Legacy.** `IMI_ADMIN_CERT_FINGERPRINTS` in `.env.prod` ergänzen und das Backend neu erstellen (wird bei jedem Start eingelesen). Ablaufdatum und Name werden bei der ersten Anmeldung ergänzt. Nur nutzen, wenn 1 und 2 nicht möglich sind.

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

Once an admin can sign in, new sites are onboarded from **Administration > Onboarding** (`/app/admin/onboarding`) in three steps: **1. choose a method** (type the sites into the in-tool table, or upload a CSV, XLSX or JSON file), **2. review and fix** (a dry run checks every row against the server and shows per row whether it would be created, updated or rejected, without writing anything), **3. import** (with a summary). The page offers an Excel template (`.xlsx`: header row, an example row, a country drop-down and a "Help" sheet explaining each column) and a CSV template. In the table, rows can be added and removed, cells are validated while typing, and rows copied from Excel or Sheets (tab-separated, with or without the header line) can be pasted into any cell. Each row creates or updates a complete site in one transaction: the organization, its instance, the contact user, the allow-list entry, and the client-certificate fingerprint. Re-uploading the same file is idempotent (existing sites are updated, not duplicated).

**Many files at once.** Every site usually sends its own filled-in template, so the upload step takes any number of CSV / XLSX / JSON files (file picker with multiple selection, drag and drop of several files, more files can be added later; at most 50 files, 1 MB each, 10 MB and 1000 rows in total). Each file is parsed on its own through `POST /api/v1/admin/onboarding/parse` (parse and validate only, no database access, nothing written), listed with its type, size, row count and number of skipped rows, and can be removed again (which also removes its rows). A file with an unsupported type, a PEM/private-key block, a formula cell or too many rows is rejected on its own with a message; the other files are unaffected. The rows of all files are merged into the one table, each tagged with its source file. Rows that claim the same identifier, or the same certificate fingerprint under different identifiers, are flagged on both sides (also across files) and block the import until resolved; the server backs this up by failing a repeated identifier in one payload with `DUPLICATE_IDENTIFIER`. The check and the import then run once over the combined rows (so the certificate step-up and the rate limit apply once), and the summary also shows created / updated / failed counts per file.

Columns (CSV header row, first row of the XLSX sheet "Sites") or object keys (JSON). A row whose `organizationIdentifier` starts with `#` is a comment and is ignored (the templates' example row uses this, so uploading an untouched template imports nothing):

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

- The endpoint (`POST /api/v1/admin/onboarding/import`) requires an authenticated IMI admin; anyone else gets `403`. It accepts `text/csv`, `application/json` and an `.xlsx` workbook (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; the first sheet that is not "Help" is read, header in row 1, formula cells are rejected like a leading `=`).
- `?dryRun=true` runs the same parsing and validation and reports per row `created` / `updated` / `failed` (including fingerprint conflicts between rows of the same file) without writing anything. Because it changes nothing, it needs no certificate step-up and does not count against the rate limit. Every result row carries its 1-based data-row number (`row`).
- `POST /api/v1/admin/onboarding/parse` takes the same bodies and returns the validated rows (with their `row` numbers) and the parse errors without touching the database; it needs no step-up and is not rate-limited because it writes nothing.
- The templates are admin-only downloads: `GET /api/v1/admin/onboarding/template.xlsx` and `GET /api/v1/admin/onboarding/template.csv`.
- It is rate-limited (10 requests per 15 minutes per user).
- The body is capped at 1 MB (`413`) and 1000 rows (`413`).
- A file that contains a PEM block (`-----BEGIN`) is rejected outright (`400`), so a private key or certificate body is never accepted here.
- Cells that start with a formula character (`=`, `+`, `-`, `@`) or a leading tab/CR are rejected, which blocks CSV/spreadsheet formula injection.
- A fingerprint already registered to a different organization is refused for that row (`FINGERPRINT_IN_USE`); a unique index enforces it as a backstop.
- Every imported row is written to the append-only audit log with only the first 16 characters of the fingerprint, never the full value.

A row that fails validation does not abort the import: the response reports a per-row result (`created` / `updated` / `failed` with the reason) plus a summary, and the UI shows the same table so an admin can fix and re-upload only the bad rows. In the table editor the dry-run result is shown on the affected row itself, so the row can be corrected in place and checked again.

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

- All three nginx configs (`nginx.conf`, `nginx.prod.conf`, `nginx.cert-auth.conf`) split `/auth/` into two per-IP classes as defense in depth next to the backend's Redis-backed limits. The brute-force targets (`request-otp`, `verify-otp`, `verify-totp`, `setup-totp`, `confirm-totp`) get 5 requests/minute (burst 3-5). Everything else under `/auth/` (`refresh`, `logout`, `client-cert-login`, `dev-login`, `me`) gets a separate 60 requests/minute zone (burst 30), because `/auth/refresh` runs on every page load and must never lock users out. `/api/` allows 600 requests/minute per IP (burst 200): a canvas page load fires about 12 parallel requests and several users share one hospital NAT address, so this is only a coarse safety net and the per-user backend limit (`RATE_LIMIT_API_MAX`, default 100/min per user) stays the primary control. Normal use (page load about 12 requests, instance switch about 9, polling 2-3/min and paused in background tabs) stays far below that default; raise `RATE_LIMIT_API_MAX` only if your own measurements say otherwise. The frontend shows a single "Too many requests" toast (with the retry time when the server sends `Retry-After`) and never ends the session on a `429`.
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

The portal generates the DSF allow list in the format of the legacy allow-list portal: Organization, Endpoint and OrganizationAffiliation resources as conditional PUTs, plus DELETE entries for removed affiliations. Only approved organizations with at least one certificate and one endpoint are published, because the DSF organization profile requires both.

**Each site contributes the data of its last approved request.** When a site submits for approval, the portal stores next to the review snapshot the data the allow list would publish for it: organization, endpoints, certificate thumbprints (SHA-512, never the PEM), affiliations and removed affiliations. A new version is built from the latest APPROVED request of every site. Consequently an edit that was not submitted and approved (a changed endpoint, a new certificate, a deleted membership) is never published, even when another site's approval creates a version meanwhile. A newer request that is still pending, was rejected or was withdrawn does not drop an already approved site; its previously approved data stays in the list. A site whose latest approved request has active=false is published as withdrawn (DELETE entries). Requests approved before this rule existed are read from their review snapshot; the thumbprints come from the stored certificates with the ids listed in it. The IP address list and the network map follow the same rule.

### DSF process `downloadAllowList` (dsf-process-allow-list)

A site starts the process locally on its own DSF FHIR server (requester `LOCAL_ALL` or a `DSF_ADMIN` practitioner) and sets the Task input `http://dsf.dev/fhir/CodeSystem/allow-list|allow_list` to:

```
https://dsf-management.imi.uni-muenster.de/fhir/Bundle/mine
```

`/fhir/Bundle/mine` is the same address for every site: the portal derives the endpoint from the organization of the presented DSF client certificate (its only endpoint; with several endpoints the single one whose identifier starts with `fhir.`; otherwise `409` with an `AMBIGUOUS_ENDPOINT` OperationOutcome listing the endpoint identifiers). Sites with several endpoints then use the per-endpoint address `https://dsf-management.imi.uni-muenster.de/fhir/Bundle/<endpoint identifier>`, which returns the same body.

The BPE reads that URL with `GET {base}/Bundle/{id}` and `Accept: application/fhir+json`, using the site's DSF client certificate. It then checks the bundle (`checkAllowList`) and posts it as a transaction to its own FHIR server (`insertAllowList`).

The response is the allow list for that endpoint:
- every other approved organization;
- once the site itself is approved, its own affiliations for that endpoint. These reference the site's Organization and Endpoint conditionally, because the site's DSF server already holds them.

The portal's GUI download `GET /api/v1/instances/:id/download/bundle?endpointId=...` (signed) returns the same list.

#### Current link, history and restore

The link above always points at the **current** allow list. The allow list is versioned: every approval (four-eyes, silent consent, or an approved withdrawal) stores a new bundle version together with the network state it was built from. The current list is the receiver view of the latest version. Edits made after an approval (a new certificate, a changed endpoint) do not appear in it until the site has submitted them and the request has been approved; a version created by another site's approval in between still carries the old approved data of this site.

The current read carries `Bundle.meta.versionId` (the version number) and `Bundle.meta.lastUpdated`, plus the headers `ETag: W/"<version>"` and `Last-Modified`. A conditional read with `If-None-Match` answers `304` while the version is unchanged. Before the first approval after the upgrade that introduced versions (migration 024), the portal falls back to the approved state computed on the fly.

Older versions stay readable with the same client certificate and the same endpoint ownership rule (a certificate of one organization cannot read another organization's endpoint):

| Request | Result |
|---------|--------|
| `GET /fhir/Bundle/mine` | Current version, receiver view, for the endpoint derived from the certificate's organization (see above). |
| `GET /fhir/Bundle/<endpoint>` | Current version, receiver view. |
| `GET /fhir/Bundle/<endpoint>/_history` | FHIR `Bundle` of type `history`, newest first, one entry per version without the resource (`fullUrl`, `request`, `response.etag`, `response.lastModified`). `?_count=` limits the list (default 50, maximum 200). |
| `GET /fhir/Bundle/<endpoint>/_history/<version>` | The receiver view of that version, `meta.versionId` set. `404` for an unknown version or a version created before migration 024. |

To apply an old list on a site, set the Task input `allow_list` to the `_history/<version>` URL. The BPE reads it like the current link.

Site users see the same versions in the GUI (`GET /api/v1/instances/:id/bundle-history?endpointId=...`) and download one with `.../download/bundle?endpointId=...&version=<n>`. The response carries `X-Bundle-Version`.

**Restore (four-eyes).** Publishing an old version again is a four-eyes decision. An IMI admin requests it (`POST /api/v1/admin/bundle-versions/:id/restore` with a reason, behind the step-up: TOTP code, or the re-presented client certificate in certificate mode). That only records a pending request, one at a time (`409 ALREADY_PENDING` otherwise). A second admin from a different site (other email domain) approves it (`POST /api/v1/admin/bundle-restores/:rid/approve`, step-up again) or rejects it with a comment (`.../reject`); the requester can withdraw it (`.../cancel`). Nobody approves their own request and the first decision is final. Each step is audited. Only the approval publishes anything. Restore does not rewrite history. It creates a new version (`triggered_by` `RESTORE`, `triggered_by_email` the approving admin, note `Restored from v<N>: <reason>`) with the stored input of the old one, re-rendered and re-signed. That new version is the current list from then on. The live data in the portal is unchanged, so the next approval creates a version from the live state again and replaces the restored list. Versions created before migration 024 have no stored input and cannot be restored (`409 VERSION_NOT_RESTORABLE`).

Requirements on the site:
- **Identifiers.** The organization identifier and the endpoint identifier in the portal must equal the DSF FHIR server's `DEV_DSF_FHIR_SERVER_ORGANIZATION_IDENTIFIER_VALUE` and the host of `DEV_DSF_FHIR_SERVER_BASE_URL`. DSF derives the endpoint identifier from that host. If they differ, the conditional references of the site's own affiliations do not resolve and the whole transaction fails.
- **Client certificate.** The BPE's client certificate must be registered for the organization, either as the login certificate (SHA-512 fingerprint) or in the organization's certificate list. An unregistered certificate gets `403`, no certificate gets `401`. Both errors are FHIR OperationOutcomes, so the BPE logs the reason.
- **Server trust.** The BPE validates the portal's TLS certificate against `DEV_DSF_BPE_FHIR_CLIENT_TRUST_SERVER_CERTIFICATE_CAS`.
  - DSF 2.1.1 ships only D-TRUST, HARICA and USERTrust (Sectigo/GEANT) roots. **Let's Encrypt (ISRG Root X1) is not included.** A default BPE therefore fails with `PKIX path building failed` against a portal that uses a Let's Encrypt certificate.
  - Fix on the portal side: use a certificate from one of these CAs (GEANT TCS via DFN).
  - Fix on each site: add ISRG Root X1 to that trust store.
- **No issuer list.** The front proxy must request the client certificate without an issuer list. Java clients only present a certificate whose issuer appears in a non-empty list.
  - Apache: `SSLVerifyClient optional_no_ca`, without `SSLCACertificateFile` or `SSLCADNRequestFile`.
  - Bundled nginx: `ssl_trusted_certificate`, not `ssl_client_certificate`.

Quick check with a site's DSF certificate (the same read the BPE performs):

```bash
curl --cert dsf-client.crt --key dsf-client.key -H 'Accept: application/fhir+json' \
  https://dsf-management.imi.uni-muenster.de/fhir/Bundle/<endpoint identifier>
```

### Network-wide bundle

`GET /fhir/Bundle` (mTLS, any registered certificate) and `GET /api/v1/download/full-bundle` (GUI) return all approved organizations of the current version, without the receiver view.

### End-to-end test with the real DSF software

`bash scripts/dsf-e2e/run.sh`, with the dev stack running, does the following:
- starts DSF FHIR 2.1.1 with `fhir_proxy`, and BPE 2.1.1 with `dsf-process-allow-list` 1.0.0.1;
- seeds a receiving site and two peers into the dev portal;
- runs `downloadAllowList` six times: through an Apache front configured like production, again in place, after a peer left the hub, after a peer was withdrawn (its Organization, Endpoints and affiliations must be deleted at the receiver), through the repository nginx, and against a server certificate from a CA the BPE does not trust (expected to fail, standing in for Let's Encrypt).

The script needs Docker, OpenSSL and Node on the host and cleans up after itself; `--keep` leaves everything running for inspection. The API-level replay of the hackathon runs in the backend test suite (`hackathon-replay*.test.ts`).

## Removals and deletions

The bundle tells every site what to delete, like the legacy portal does:

- **Withdrawn organizations.** An organization is withdrawn when it is deactivated (the "active" switch in the organization dialog) and that change is approved. From then on every bundle carries `DELETE` for its `Organization`, its `Endpoint`s and its `OrganizationAffiliation`s, so no site keeps trusting its certificate. A pending deactivation deletes nothing yet. A site's own bundle never deletes the site itself, and no `DELETE` is emitted for anything the same bundle still publishes.
- **Memberships** removed in the UI are soft-deleted; the next bundle carries the matching `DELETE` for the affiliation. A daily cron at 09:00 UTC hard-deletes soft-deleted rows older than 90 days, so every site has had time to apply the deletion.
- A conditional `DELETE` that matches nothing at a site is a no-op in DSF, so sites that never had the organization are unaffected.

To opt out of soft-delete retention, set `MEMBERSHIP_SOFT_DELETE_RETENTION_DAYS=0` (cleanup runs every day and removes immediately).

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

## Backup und Wiederherstellung

Zusätzlich zum MySQL-Dump (`scripts/backup-db.sh`, siehe oben) sichert das Portal seinen gesamten Anwendungsstand selbst als JSON. Ein Admin stellt den Zeitplan unter **Admin > Backups** (`/app/admin/backups`) ein; das Einspielen erfolgt bewusst manuell auf dem Server.

### Was gesichert wird

- Jede Tabelle des MySQL-Schemas (die Liste kommt zur Laufzeit aus `information_schema`, neue Tabellen sind automatisch dabei), inklusive `audit_logs`, `users`, Zertifikate (öffentliche PEM), Kontakte, Bundle-Versionen und die Backup-Einstellungen selbst. Es gibt keine Migrations-Buchführungstabelle im Schema (Migrationen werden von Hand angewendet, `.migrations-applied` liegt außerhalb der Datenbank); daher wird nichts ausgenommen. Generierte Spalten werden von MySQL beim Einspielen neu berechnet.
- Format: eine Datei `dsf-allowlist-backup-<UTC-Zeit>-<id>.json.gz` mit `format`, `formatVersion`, `createdAt`, `appVersion`, `schemaVersion` (Nummer der letzten Migration), `tables` (Spalten und Zeilen, Zeitstempel mit Millisekunden, JSON-Spalten als JSON, Binärdaten als base64), `counts` und `sha256` (über den `tables`-Teil). Die Tabellen werden in einem einzigen konsistenten Snapshot gelesen, die Datei wird gestreamt und gzip-komprimiert.
- Nicht gesichert wird Redis (OTP-Codes, Refresh-Tokens, Rate-Limits). Nach einer Wiederherstellung sind daher alle Sitzungen ungültig und alle müssen sich neu anmelden.

### Wo die Dateien liegen

- Verzeichnis im Backend-Container: `BACKUP_DIR` (Standard `/backups`), in den Compose-Dateien als benanntes Volume `backup-data` eingebunden. Es wird kein Port veröffentlicht. Dateien haben Modus `0600`, das Verzeichnis `0700`; geschrieben wird erst in eine Temp-Datei, dann atomar umbenannt.
- Zeitplan (Admin-Seite): aktiv/inaktiv; alle 6 Stunden, alle 12 Stunden oder täglich zu einer Uhrzeit (Europe/Berlin), nie seltener als täglich; Aufbewahrung 7 bis 365 Dateien (Standard 14). Standard nach der Migration: täglich 02:30, 14 Dateien. Das Backend prüft jede Minute, ob ein Backup fällig ist (ein ausgefallener Termin wird nachgeholt); ein Redis-Lock (`backup:lock`) verhindert parallele Läufe. Ein fehlgeschlagener Lauf wird nach 15 Minuten wiederholt und auf der Admin-Seite deutlich angezeigt.
- Jeder Lauf (Zeit, Datei, Größe, SHA-256, Dauer, Status, Fehler) steht in der Tabelle `backup_runs` und im Audit-Log (`BACKUP`: `CREATE` für Läufe, `UPDATE` für Einstellungen, `DOWNLOAD`).

### Verschlüsselung (optional)

Ist `BACKUP_ENCRYPTION_KEY` (64 Hex-Zeichen, z. B. `openssl rand -hex 32`) in `.env.prod` gesetzt, werden neue Dateien mit AES-256-GCM verschlüsselt (`*.json.gz.enc`). Den Schlüssel getrennt von den Dateien aufbewahren (Passwortmanager): ohne ihn ist ein verschlüsseltes Backup unbrauchbar, und beim Wiederherstellen muss derselbe Schlüssel im Backend gesetzt sein. Ohne Schlüssel enthalten die Dateien Kontaktdaten, verschlüsselte TOTP-Secrets und bcrypt-Hashes der Backup-Codes im Klartext (öffentliche Zertifikate, nie private Schlüssel): wie ein Geheimnis behandeln.

### Dateien vom Server holen

```bash
# Liste im Volume
docker compose exec backend ls -l /backups
# Datei auf den Host kopieren (Name aus der Admin-Seite)
docker compose cp backend:/backups/dsf-allowlist-backup-20261005-023000-ab12cd34.json.gz .
# Prüfsumme mit der Admin-Seite vergleichen
sha256sum dsf-allowlist-backup-20261005-023000-ab12cd34.json.gz
```

Alternativ lädt die Admin-Seite die Datei herunter (Step-up, Audit-Eintrag). Kopien gehören auf ein anderes System, nicht nur auf denselben Server.

### Wiederherstellen (manuell, Schritt für Schritt)

1. Backend-Version bereitstellen, die zur Datei passt oder neuer ist. Ein Backup aus einem **neueren** Schema (`schemaVersion` größer als die der Installation) wird abgelehnt. Ein Backup aus einem **älteren** Schema wird akzeptiert, wenn jede enthaltene Tabelle und Spalte noch existiert; sonst bricht das Skript mit einer klaren Meldung ab (dann in eine Datenbank einspielen, deren Migrationsstand dem Backup entspricht). Migrationen werden vom Skript nie automatisch ausgeführt.
2. Prüfen, ohne etwas zu ändern:
   ```bash
   bash scripts/restore-backup.sh dsf-allowlist-backup-20261005-023000-ab12cd34.json.gz --dry-run
   ```
   Eine Datei vom Host wird dazu automatisch in den Container kopiert (`/tmp`). Geprüft werden Format, Version, Zeilenzahlen und SHA-256; ausgegeben werden die Zeilen je Tabelle.
3. Einspielen (ersetzt **alle** Anwendungsdaten der gesicherten Tabellen):
   ```bash
   bash scripts/restore-backup.sh dsf-allowlist-backup-20261005-023000-ab12cd34.json.gz --yes
   ```
   Ist in MySQL das Binärlog aktiv (Standard bei MySQL 8), darf nur ein Konto mit SUPER-Recht die Trigger neu anlegen. Das Skript prüft das vorab und bricht dann ab, **bevor** etwas geändert wird. In dem Fall mit dem MySQL-root-Konto einspielen; das Passwort nicht in die Shell-History schreiben:
   ```bash
   read -rs RESTORE_DB_PASSWORD && export RESTORE_DB_PASSWORD RESTORE_DB_USER=root
   bash scripts/restore-backup.sh dsf-allowlist-backup-20261005-023000-ab12cd34.json.gz --yes
   unset RESTORE_DB_PASSWORD RESTORE_DB_USER
   ```
   Ohne `--yes` passiert nichts (Exit-Code 2). Alles läuft in einer Transaktion mit deaktivierten Fremdschlüsselprüfungen; bei einem Fehler wird vollständig zurückgerollt. Die Trigger der betroffenen Tabellen werden kurz entfernt (damit der append-only `audit_logs` geleert werden kann: die einzige dokumentierte Ausnahme) und danach neu angelegt. Wird der Prozess dabei hart beendet, die Migrationen 013 und 015 erneut anwenden. Tabellen, die nur die Datenbank kennt (z. B. aus einer neueren Migration), bleiben unverändert.
4. Backend neu starten (`docker compose restart backend`). Alle Sitzungen sind ungültig; alle melden sich neu an.

Das Skript liest die gesamte Datei in den Speicher; bei sehr großen `audit_logs` entsprechend Arbeitsspeicher einplanen (Faustregel: das Zehnfache der `.json.gz`-Größe).

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
