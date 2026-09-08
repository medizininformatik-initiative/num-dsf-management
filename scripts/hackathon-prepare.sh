#!/usr/bin/env bash
# hackathon-prepare.sh – Repeatable "hackathon" setup for the DSF Allow List
# cert-auth stack: creates N fictional users, each with their own self-signed
# client certificate, a complete dummy site, and IMI admin rights, then feeds
# them to backend/src/db/seed-hackathon.ts to write the database.
#
# Usage: scripts/hackathon-prepare.sh [N] [OUT_DIR]
#   N        number of hackathon users to create (default: 3)
#   OUT_DIR  output directory for certs/keys/manifest (default: /opt/dsf-allowlist/hackathon)
#
# Environment overrides:
#   HACKATHON_P12_PASSWORD   fixed .p12 export password for every user
#                            (default: a random 16-hex-char password PER user,
#                            printed once in the summary below)
#   DSF_COMPOSE              docker compose command prefix used to run the
#                            seed (default: this server's cert-auth + Apache
#                            stack, see docs/DEPLOYMENT.md)
#
# Each user gets: hack<i>@klinik-<i>.example.de / klinik-<i>.example.de, all
# distinct email domains so the 4-eyes approval rule (lib/approvalState.ts:
# site = email domain) lets them approve/reject each other's requests.
#
# Idempotent: re-running regenerates every certificate/key from scratch and
# re-seeds the database. Any .p12 handed out from a previous run is signed
# with a key that no longer exists anywhere and STOPS WORKING the moment you
# re-run this script — re-distribute the new .p12 files after every run.
set -euo pipefail

# Run on a real Debian server (this script's target), this is a no-op.
# It only matters if someone dry-runs this under Git Bash on Windows first,
# where MSYS silently rewrites "/CN=..." into a Windows path (see
# docs/RUN-FROM-IMAGE.md's Windows notes) and breaks the -subj argument below.
export MSYS_NO_PATHCONV=1

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [N] [OUT_DIR]

  N        Number of hackathon users to create (default: 3)
  OUT_DIR  Output directory for certs/keys/manifest (default: /opt/dsf-allowlist/hackathon)

Environment overrides:
  HACKATHON_P12_PASSWORD   Fixed .p12 export password for every user.
                           If unset, a random 16-hex-char password is
                           generated PER user and printed once at the end.
  DSF_COMPOSE              docker compose command prefix used to run the
                           seed. Default:
                           docker compose --env-file /opt/dsf-allowlist/.env.prod \\
                             -f /opt/dsf-allowlist/docker-compose.cert-auth.yml \\
                             -f /opt/dsf-allowlist/docker-compose.apache.yml

Examples:
  ${SCRIPT_NAME}
  ${SCRIPT_NAME} 5 /opt/dsf-allowlist/hackathon-2026

Re-running is idempotent: it regenerates every certificate/key and re-seeds
the database. Previously distributed .p12 files stop working the moment you
re-run this script — hand out the new ones.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

log() { echo "[hackathon] $*"; }
err() { echo "[hackathon] ERROR: $*" >&2; }

command -v openssl >/dev/null 2>&1 || { err "openssl is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { err "docker is required"; exit 1; }

N="${1:-3}"
OUT_DIR="${2:-/opt/dsf-allowlist/hackathon}"

case "$N" in
  ''|*[!0-9]*)
    err "N must be a positive integer, got '${N}'"
    exit 1
    ;;
esac
if [ "$N" -lt 1 ]; then
  err "N must be at least 1, got '${N}'"
  exit 1
fi

# shellcheck disable=SC2034  # DSF_COMPOSE is intentionally split on word boundaries below
DSF_COMPOSE="${DSF_COMPOSE:-docker compose --env-file /opt/dsf-allowlist/.env.prod -f /opt/dsf-allowlist/docker-compose.cert-auth.yml -f /opt/dsf-allowlist/docker-compose.apache.yml}"

PARENT_ORGANIZATION="hackathon-hub.example.de"

mkdir -p "$OUT_DIR"

log "Preparing ${N} hackathon user(s) in ${OUT_DIR}"
log "NOTE: this regenerates every certificate/key. Any .p12 handed out from a"
log "      previous run stops working the moment this script re-runs."

# True iff python3/jq are not just present on PATH but actually runnable —
# a `command -v` hit is not enough: a broken interpreter, a permission-denied
# App-Execution-Alias stub (Windows), or a partial install all report "found"
# yet fail the moment they run. Everything below probes with a trivial,
# harmless invocation before trusting the tool with real work.
python3_ok() { command -v python3 >/dev/null 2>&1 && python3 -c '' >/dev/null 2>&1; }
jq_ok() { command -v jq >/dev/null 2>&1 && printf '{}' | jq . >/dev/null 2>&1; }

# Emits a JSON-escaped string literal (including surrounding quotes) for
# arbitrary text read from stdin. Prefers python3/jq (handle every edge case
# correctly); falls back to a manual escape covering backslash, double-quote
# and newline — the only characters a PEM or these fictional names can contain.
json_string() {
  local input
  input="$(cat)"

  if python3_ok; then
    printf '%s' "$input" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read()))'
    return 0
  fi
  if jq_ok; then
    printf '%s' "$input" | jq -Rs .
    return 0
  fi
  printf '%s' "$input" | awk 'BEGIN{printf "\""} {gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); printf "%s\\n", $0} END{printf "\""}'
}

ONBOARDING_CSV="${OUT_DIR}/onboarding.csv"
echo "organizationIdentifier,organizationName,contactEmail,clientCertFingerprint,city,countryCode" > "$ONBOARDING_CSV"

USER_JSON_PARTS=()
SUMMARY_LINES=()

for i in $(seq 1 "$N"); do
  SLUG="hack${i}"
  EMAIL="${SLUG}@klinik-${i}.example.de"
  ORG_ID="klinik-${i}.example.de"
  ORG_NAME="Klinikum ${i} (Hackathon)"
  USER_NAME="Hackathon User ${i}"
  CITY="Musterstadt"
  COUNTRY="DE"

  KEY_FILE="${OUT_DIR}/${SLUG}.key"
  CRT_FILE="${OUT_DIR}/${SLUG}.crt"
  P12_FILE="${OUT_DIR}/${SLUG}.p12"

  log "Generating certificate for ${EMAIL}..."
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -subj "/CN=${EMAIL}/O=Hackathon" \
    -keyout "$KEY_FILE" -out "$CRT_FILE" \
    >/dev/null 2>&1

  if [ -n "${HACKATHON_P12_PASSWORD:-}" ]; then
    USER_P12_PASSWORD="$HACKATHON_P12_PASSWORD"
    PASSWORD_GENERATED=false
  else
    USER_P12_PASSWORD="$(openssl rand -hex 8)"
    PASSWORD_GENERATED=true
  fi
  openssl pkcs12 -export \
    -out "$P12_FILE" -inkey "$KEY_FILE" -in "$CRT_FILE" \
    -passout "pass:${USER_P12_PASSWORD}" \
    >/dev/null 2>&1

  chmod 600 "$KEY_FILE" "$P12_FILE"

  FINGERPRINT_SHA512="$(openssl x509 -in "$CRT_FILE" -outform DER | openssl dgst -sha512 -r | awk '{print $1}')"
  THUMBPRINT_SHA256="$(openssl x509 -in "$CRT_FILE" -outform DER | openssl dgst -sha256 -r | awk '{print $1}')"
  FP_PREFIX="${FINGERPRINT_SHA512:0:16}"

  CERT_JSON="$(json_string < "$CRT_FILE")"
  USER_JSON=$(cat <<EOF
    {
      "email": "${EMAIL}",
      "name": "${USER_NAME}",
      "orgIdentifier": "${ORG_ID}",
      "orgName": "${ORG_NAME}",
      "city": "${CITY}",
      "countryCode": "${COUNTRY}",
      "fingerprintSha512": "${FINGERPRINT_SHA512}",
      "thumbprintSha256": "${THUMBPRINT_SHA256}",
      "certPem": ${CERT_JSON},
      "admin": true
    }
EOF
)
  USER_JSON_PARTS+=("$USER_JSON")

  echo "${ORG_ID},${ORG_NAME},${EMAIL},${FINGERPRINT_SHA512},${CITY},${COUNTRY}" >> "$ONBOARDING_CSV"

  if [ "$PASSWORD_GENERATED" = true ]; then
    SUMMARY_LINES+=("${EMAIL}|${P12_FILE}|${USER_P12_PASSWORD}|${FP_PREFIX}")
  else
    SUMMARY_LINES+=("${EMAIL}|${P12_FILE}|(fixed password from HACKATHON_P12_PASSWORD)|${FP_PREFIX}")
  fi

  log "  [+] ${EMAIL} / ${ORG_ID} (fingerprint ${FP_PREFIX}...)"
done

MANIFEST_FILE="${OUT_DIR}/manifest.json"
{
  IFS=,
  USERS_JOINED="${USER_JSON_PARTS[*]}"
  unset IFS
  printf '{\n'
  printf '  "parentOrganization": "%s",\n' "$PARENT_ORGANIZATION"
  printf '  "users": [\n%s\n  ]\n' "$USERS_JOINED"
  printf '}\n'
} > "$MANIFEST_FILE"

# Sanity-check the manifest we just built before invoking the (expensive)
# containerized seed — catches a broken json_string fallback early with a
# clear error instead of a confusing failure inside the container. Only a
# tool confirmed runnable (python3_ok/jq_ok) gets to fail the build; if
# neither works, skip this best-effort check (seed-hackathon.js validates
# the manifest again with zod regardless).
if python3_ok; then
  python3 -m json.tool "$MANIFEST_FILE" >/dev/null || { err "manifest.json is not valid JSON"; exit 1; }
elif jq_ok; then
  jq . "$MANIFEST_FILE" >/dev/null || { err "manifest.json is not valid JSON"; exit 1; }
else
  log "python3/jq unavailable — skipping manifest.json pre-check (seed-hackathon.js validates it too)"
fi

log "Wrote ${MANIFEST_FILE} and ${ONBOARDING_CSV}"

log "Seeding the database (${N} user(s))..."
# shellcheck disable=SC2086  # DSF_COMPOSE is a multi-word command prefix by design
$DSF_COMPOSE run --rm -v "${OUT_DIR}:/hackathon:ro" backend \
  node dist/db/seed-hackathon.js /hackathon/manifest.json

echo
echo "=== Hackathon users ready ==="
printf '%-38s %-45s %-20s %s\n' "EMAIL" "P12 FILE" "P12 PASSWORD" "FINGERPRINT"
for line in "${SUMMARY_LINES[@]}"; do
  IFS='|' read -r s_email s_p12 s_pw s_fp <<< "$line"
  printf '%-38s %-45s %-20s %s...\n' "$s_email" "$s_p12" "$s_pw" "$s_fp"
done

cat <<EOF

Next steps:
  1. Import each .p12 into a browser (double-click it, or use the browser's
     certificate manager) using the password shown above.
  2. Open the portal in that browser — the matching client certificate signs
     the user straight in, no login screen.
  3. Each user is an IMI admin: they can onboard new sites (Administration >
     Onboarding) and approve/reject each other's pending requests. Different
     email domains satisfy the 4-eyes rule, so any two hackathon users can
     approve the same request.
  4. Fetch the allow-list bundle over mTLS with the raw cert/key (not the
     .p12), e.g. for hack1:
       curl --cert ${OUT_DIR}/hack1.crt --key ${OUT_DIR}/hack1.key \\
         "https://<host>/fhir/Bundle?identifier=http://dsf.dev/fhir/CodeSystem/allow-list|allow_list"

Bonus: ${ONBOARDING_CSV} is ready to upload at /app/admin/onboarding if you
want to onboard these same sites through the admin UI instead.
EOF
