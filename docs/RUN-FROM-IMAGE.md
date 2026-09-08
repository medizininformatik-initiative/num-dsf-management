# Run from a prebuilt image bundle

Run the whole DSF Allow-List portal from **prebuilt Docker images** — no source
checkout, no build step. This is the same procedure used on the production VM and
for a quick local smoke-test.

For the full operations reference (env vars, migrations, backups, rotation) see
[DEPLOYMENT.md](DEPLOYMENT.md). This page is the short, self-contained walkthrough.

---

## Where the bundle comes from

| Source | What you get | Retention |
|---|---|---|
| **CI artifact** — every push to `main` | `dsf-allowlist-images-<sha>.tar.gz` (+ `.sha256`), downloaded as a `.zip` from the run's **Summary** page → *Artifacts* | 30 days |
| **GitHub Release** — every tag | the same bundle **plus** a **run-kit** (`dsf-allowlist-runkit-<tag>.tar.gz`) with the compose file, nginx config, `.env.prod.example`, `db/migrations/` and a preset `.image.env` | permanent |

The **image bundle** is only the two container images. To run them you also need
the **run-kit files**: `docker-compose.release.yml`, `nginx/nginx.prod.conf` and
`db/migrations/`. A Release ships them in the run-kit; if you have a repo checkout
you already have them in place.

---

## Prerequisites

- Docker Engine + Compose plugin, **running**.
- The image bundle `dsf-allowlist-images-<tag>.tar.gz`.
- The run-kit files (from the Release run-kit, or from a repo checkout).

---

## Steps

Run these from the directory that holds `docker-compose.release.yml` (the run-kit
folder, or the repo root). Replace `<tag>` with the bundle's tag/sha, e.g. `6830584`.

### 1. Load the images

Offline, from the downloaded bundle:

```bash
sha256sum -c dsf-allowlist-images-<tag>.tar.gz.sha256   # optional integrity check
docker load -i dsf-allowlist-images-<tag>.tar.gz
#  -> Loaded image: ghcr.io/mukeyii/dsf-allowlist-backend:<tag>
#  -> Loaded image: ghcr.io/mukeyii/dsf-allowlist-frontend:<tag>
```

Or, online, pull from the registry instead of loading the file:

```bash
docker pull ghcr.io/mukeyii/dsf-allowlist-backend:<tag>
docker pull ghcr.io/mukeyii/dsf-allowlist-frontend:<tag>
```

### 2. Point Compose at those images

```bash
printf 'IMAGE_OWNER=mukeyii\nIMAGE_TAG=<tag>\n' > .image.env
```

The Release run-kit already includes this file with the correct values.

### 3. Configure secrets (`.env.prod`)

The backend refuses to start without the JWT keypair and TOTP key, so generate
them straight into `.env.prod`:

```bash
cp .env.prod.example .env.prod
openssl genrsa -out jwt_priv.pem 2048
openssl rsa -in jwt_priv.pem -pubout -out jwt_pub.pem
sed -i "s|^JWT_PRIVATE_KEY_BASE64=.*|JWT_PRIVATE_KEY_BASE64=$(base64 -w0 jwt_priv.pem)|" .env.prod
sed -i "s|^JWT_PUBLIC_KEY_BASE64=.*|JWT_PUBLIC_KEY_BASE64=$(base64 -w0 jwt_pub.pem)|" .env.prod
sed -i "s|^TOTP_ENCRYPTION_KEY=.*|TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env.prod
rm jwt_priv.pem jwt_pub.pem
```

Then edit `.env.prod` and set the remaining values:
`DB_ROOT_PASSWORD`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `REDIS_PASSWORD`,
`SMTP_*`, `MAIL_FROM`, `IMI_ADMIN_EMAILS`, `DSF_ENVIRONMENT`.

### 4. TLS certificates

nginx terminates HTTPS and expects **three** files in `certs/`:
`server.crt`, `server.key` **and** `client-ca.crt` (it won't start if
`client-ca.crt` is missing, even though client certs are optional). For a real
deployment use your CA-issued cert; for a local test a self-signed cert is fine:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost"
cp certs/server.crt certs/client-ca.crt   # placeholder so nginx can load the directive
```

### 5. Start

```bash
docker compose --env-file .env.prod --env-file .image.env -f docker-compose.release.yml up -d
docker compose --env-file .env.prod --env-file .image.env -f docker-compose.release.yml ps
```

The stack listens on host ports **80** and **443**.

### 6. Open

Browse to `https://<host>` (or `https://localhost` locally) and accept the
certificate warning if it is self-signed.

---

## Logging in

To actually sign in you additionally need:

- your email in the `email_whitelist` table, and
- a reachable SMTP server — the release stack ships **no** mail container, so OTP
  emails go out through whatever `SMTP_*` points at.

On first boot the backend bootstraps admin grants from `IMI_ADMIN_EMAILS`
(see the *Admin grants & user management* section of
[DEPLOYMENT.md](DEPLOYMENT.md)). Seed a whitelist entry with:

```bash
docker compose --env-file .env.prod --env-file .image.env -f docker-compose.release.yml \
  run --rm backend node dist/db/seed-whitelist.js you@example.com
```

---

## Updating / stopping

```bash
# update: load or pull a newer <tag>, bump IMAGE_TAG in .image.env, then:
docker compose --env-file .env.prod --env-file .image.env -f docker-compose.release.yml up -d

# stop (keep data):
docker compose --env-file .env.prod --env-file .image.env -f docker-compose.release.yml down

# stop and wipe volumes (drops the database!):
docker compose --env-file .env.prod --env-file .image.env -f docker-compose.release.yml down -v
```

---

## Notes for a local test on Windows

- Run the commands in **Git Bash** (not PowerShell) so `openssl`, `sed` and
  `base64 -w0` behave.
- Prefix the `openssl req ... -subj "/CN=localhost"` line with `MSYS_NO_PATHCONV=1`
  so Git Bash doesn't rewrite the `/CN=...` subject into a Windows path.
- The images are `linux/amd64`; Docker Desktop (WSL2 backend) runs them fine.
- The release stack is meant for a server and has no Mailhog. For a full local
  login experience (OTP mail included) use the development compose
  (`docker compose up`) instead — see the project README.
