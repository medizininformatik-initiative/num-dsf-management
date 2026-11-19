#!/usr/bin/env bash
# site-cert-renew.sh - renew a site's login certificate in the DSF Allow List portal.
#
# Logs in with the CURRENT login certificate (mTLS), registers the replacement
# certificate as a renewal of it, and submits the approval request. Approval
# itself stays with two IMI admins. Run it from cron well before the current
# certificate expires: the new one only becomes a login certificate after approval.
#
# Usage:
#   site-cert-renew.sh --base-url https://dsf-management.example.org \
#       --cert current.pem --key current.key --new-cert replacement.pem \
#       [--days 30] [--force] [--instance <id>] [--dry-run] [--no-submit]
#
# Env fallbacks: BASE_URL, CERT, KEY, NEW_CERT, DAYS, INSTANCE.
# Needs: curl, jq, openssl.
#
# Exit codes: 0 ok / nothing to do, 1 usage, 2 auth or network error,
#             3 API rejected the request or an approval request is already pending,
#             4 ambiguous instance / certificate not found.
# Neither tokens nor PEM contents are ever printed.
set -euo pipefail

BASE_URL="${BASE_URL:-}"
CERT="${CERT:-}"
KEY="${KEY:-}"
NEW_CERT="${NEW_CERT:-}"
DAYS="${DAYS:-30}"
INSTANCE="${INSTANCE:-}"
FORCE=0
DRY_RUN=0
SUBMIT=1

die() { echo "error: $2" >&2; exit "$1"; }

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) BASE_URL="${2:?}"; shift 2 ;;
    --cert) CERT="${2:?}"; shift 2 ;;
    --key) KEY="${2:?}"; shift 2 ;;
    --new-cert) NEW_CERT="${2:?}"; shift 2 ;;
    --days) DAYS="${2:?}"; shift 2 ;;
    --instance) INSTANCE="${2:?}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --submit) SUBMIT=1; shift ;;
    --no-submit) SUBMIT=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die 1 "unknown argument: $1" ;;
  esac
done

for tool in curl jq openssl; do
  command -v "$tool" >/dev/null 2>&1 || die 1 "$tool is required"
done
[ -n "$BASE_URL" ] && [ -n "$CERT" ] && [ -n "$KEY" ] && [ -n "$NEW_CERT" ] \
  || { usage >&2; die 1 "--base-url, --cert, --key and --new-cert are required"; }
case "$DAYS" in ''|*[!0-9]*) die 1 "--days must be a number" ;; esac
[ -r "$CERT" ] && [ -r "$KEY" ] && [ -r "$NEW_CERT" ] || die 1 "cert/key files must be readable"
if grep -q "PRIVATE KEY" "$NEW_CERT"; then
  die 1 "--new-cert contains a private key; pass the certificate only"
fi
BASE_URL="${BASE_URL%/}"

# Still valid for longer than the threshold? (-checkend exits 0 if so; portable, no date maths)
openssl x509 -in "$CERT" -noout >/dev/null 2>&1 || die 1 "cannot read --cert"
echo "current certificate: $(openssl x509 -in "$CERT" -noout -enddate)"
if openssl x509 -in "$CERT" -noout -checkend $((DAYS * 86400)) >/dev/null && [ "$FORCE" -eq 0 ]; then
  echo "nothing to do (valid for more than $DAYS days)"
  exit 0
fi

# SHA-512 of the DER certificate, lower-case hex: the API's thumbprintSha512.
cur_fp="$(openssl x509 -in "$CERT" -outform DER | openssl dgst -sha512 -r | cut -d' ' -f1)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
body="$work/body"

# api METHOD PATH [JSON]: sets $status and writes the response to $body.
# Every call carries the client certificate; the token goes via a header file
# so it never appears in the process list.
api() {
  local method="$1" path="$2" data="${3:-}" args=()
  args=(-sS --cert "$CERT" --key "$KEY" -X "$method" -o "$body" -w '%{http_code}' --max-time 30)
  [ -n "${TOKEN:-}" ] && args+=(-H "@$work/auth")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data-binary "@$data")
  status="$(curl "${args[@]}" "$BASE_URL$path")" || die 2 "network error calling $path"
}

rejected() {
  die 3 "$1 failed (HTTP $status): $(jq -r '.error.code // "unknown"' "$body" 2>/dev/null || echo unknown)"
}

TOKEN=""
api POST /auth/client-cert-login
[ "$status" = 200 ] || die 2 "login failed (HTTP $status): $(jq -r '.error.code // "unknown"' "$body" 2>/dev/null || echo unknown)"
TOKEN="$(jq -r '.data.accessToken // empty' "$body")"
[ -n "$TOKEN" ] || die 2 "login returned no access token"
printf 'Authorization: Bearer %s\n' "$TOKEN" > "$work/auth"

# Instance: given, else the single one.
if [ -z "$INSTANCE" ]; then
  api GET /api/v1/instances
  [ "$status" = 200 ] || rejected "listing instances"
  count="$(jq '.data | length' "$body")"
  [ "$count" -eq 1 ] || die 4 "found $count instances; pass --instance <id>"
  INSTANCE="$(jq -r '.data[0].id' "$body")"
fi
case "$INSTANCE" in *[!A-Za-z0-9-]*|'') die 1 "invalid instance id" ;; esac

# Certificate row of the current certificate.
api GET "/api/v1/instances/$INSTANCE/certificates"
[ "$status" = 200 ] || rejected "listing certificates"
cert_id="$(jq -r --arg fp "$cur_fp" '[.data[] | select(.thumbprintSha512 == $fp)][0].id // empty' "$body")"
[ -n "$cert_id" ] || die 4 "current certificate is not registered for this instance"

# A pending request would be superseded by the renewal's snapshot: do not renew then.
api GET "/api/v1/instances/$INSTANCE/approval/status"
[ "$status" = 200 ] || rejected "approval status"
if [ "$(jq -r '.data.status // empty' "$body")" = "PENDING" ]; then
  die 3 "an approval request is pending; ask an admin to decide or withdraw it first"
fi

new_fp="$(openssl x509 -in "$NEW_CERT" -outform DER 2>/dev/null | openssl dgst -sha512 -r | cut -d' ' -f1)"
[ -n "$new_fp" ] || die 1 "cannot read --new-cert"
[ "$new_fp" != "$cur_fp" ] || die 1 "--new-cert is the same certificate as --cert"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry run: would renew certificate $cert_id of instance $INSTANCE with the new certificate"
  [ "$SUBMIT" -eq 1 ] && echo "dry run: would submit the approval request"
  exit 0
fi

jq -n --rawfile pem "$NEW_CERT" '{pem: $pem}' > "$work/renew.json"
api POST "/api/v1/instances/$INSTANCE/certificates/$cert_id/renew" "$work/renew.json"
[ "$status" = 200 ] || rejected "renewal"
echo "certificate renewed (new thumbprint ${new_fp:0:16}...)"

if [ "$SUBMIT" -eq 1 ]; then
  api POST "/api/v1/instances/$INSTANCE/approval/submit"
  [ "$status" = 200 ] || rejected "approval submit"
  echo "approval request submitted"
fi

api GET "/api/v1/instances/$INSTANCE/approval/status"
[ "$status" = 200 ] || rejected "approval status"
echo "approval status: $(jq -r '.data.status // "none"' "$body")"
echo "the new certificate becomes a login certificate after two admins approved"
