#!/usr/bin/env bash
# hackathon-smoke.sh - End-to-end rehearsal for the hackathon cert-auth setup.
#
# Exercises, against a live BASE_URL, everything scripts/hackathon-prepare.sh
# and backend/src/db/seed-hackathon.ts are supposed to have produced: cert
# login for hack1/hack2/hack3, the cert step-up guard, the 4-eyes approval
# state machine, bulk CSV onboarding (including its PEM and formula-injection
# guards), and the FHIR allow-list bundle the DSF UpdateAllowList process
# consumes.
#
# Usage: scripts/hackathon-smoke.sh <BASE_URL> [HACKATHON_DIR] [--keep]
#   BASE_URL       e.g. https://dsf-management.example.de
#   HACKATHON_DIR  directory holding hack1..hack3 .crt/.key
#                  (default: /opt/dsf-allowlist/hackathon, the default output
#                  of scripts/hackathon-prepare.sh)
#   --keep         do not remove the site this script onboards in step 6
#
# Environment overrides:
#   SMOKE_INSECURE=1   add curl --insecure (self-signed / dev TLS certs)
#
# Requires: curl, openssl, and (python3 or jq) for JSON parsing.
#
# Every check prints PASS/FAIL/INFO with the HTTP status and a one-line
# reason. The script exits non-zero on the first FAIL and always prints a
# final summary table. Tokens and fingerprints are never printed in full
# (fingerprints: first 12 hex chars only).
#
# See docs/DEPLOYMENT.md's "Hackathon rehearsal" section for what each check
# proves and what a FAIL there usually means.
set -euo pipefail

# NOTE: unlike hackathon-prepare.sh, MSYS_NO_PATHCONV is intentionally NOT
# exported globally here. This script's curl calls write to mktemp-generated
# /tmp/... paths, and MSYS_NO_PATHCONV=1 disables MSYS's translation of those
# POSIX paths for native Windows binaries (curl.exe included) -- confirmed
# while rehearsing this script under Git Bash on Windows, where every
# `curl -o "$RESP_FILE"` then failed with "curl: (23) Failed writing body".
# It is set narrowly, only around the one openssl -subj "/CN=..." call in
# step 6 below, which is the only place that actually needs it.

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} <BASE_URL> [HACKATHON_DIR] [--keep]

  BASE_URL       Base URL of the deployed cert-auth stack, e.g.
                 https://dsf-management.example.de
  HACKATHON_DIR  Directory holding hack1.crt/.key .. hack3.crt/.key, as
                 written by scripts/hackathon-prepare.sh.
                 Default: /opt/dsf-allowlist/hackathon
  --keep         Skip step 9 (do not remove the site this script onboards
                 in step 6, and skip the post-cleanup 401 check).

Environment overrides:
  SMOKE_INSECURE=1   Add curl --insecure. Needed for a self-signed dev TLS
                     certificate (e.g. the local docker-compose.yml stack).

Requires: curl, openssl, and (python3 or jq).

Example:
  ${SCRIPT_NAME} https://dsf-management.example.de
  SMOKE_INSECURE=1 ${SCRIPT_NAME} https://localhost /tmp/hackathon-scratch
EOF
}

err() { echo "[hackathon-smoke] ERROR: $*" >&2; }

# ─── Argument parsing ──────────────────────────────────────────────────────

KEEP=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
    --keep)
      KEEP=1
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
  esac
done

BASE_URL="${POSITIONAL[0]:-}"
HACKATHON_DIR="${POSITIONAL[1]:-/opt/dsf-allowlist/hackathon}"

if [ -z "$BASE_URL" ]; then
  err "BASE_URL is required"
  usage
  exit 1
fi
BASE_URL="${BASE_URL%/}"

# ─── Dependency checks ─────────────────────────────────────────────────────

command -v curl >/dev/null 2>&1 || { err "curl is required"; exit 1; }
command -v openssl >/dev/null 2>&1 || { err "openssl is required"; exit 1; }

# Mirrors hackathon-prepare.sh's python3_ok/jq_ok: a `command -v` hit alone
# is not enough (a broken interpreter or a Windows App-Execution-Alias stub
# reports "found" yet fails the moment it runs), so probe with a trivial
# invocation before trusting the tool. `python` is also tried after
# `python3`: on Windows, `python3` commonly resolves to a permission-denied
# App-Execution-Alias stub even when a real `python` (3.x) is installed and
# working -- confirmed while rehearsing this script locally.
HAVE_PY=0
HAVE_JQ=0
PY=""
if command -v python3 >/dev/null 2>&1 && python3 -c '' >/dev/null 2>&1; then
  HAVE_PY=1
  PY=python3
elif command -v python >/dev/null 2>&1 && python -c '' >/dev/null 2>&1; then
  HAVE_PY=1
  PY=python
elif command -v jq >/dev/null 2>&1 && printf '{}' | jq . >/dev/null 2>&1; then
  HAVE_JQ=1
fi
if [ "$HAVE_PY" -ne 1 ] && [ "$HAVE_JQ" -ne 1 ]; then
  err "python3, python, or jq is required for JSON parsing (none was found runnable)"
  exit 1
fi

for i in 1 2 3; do
  eval "CRT_${i}=\"\$HACKATHON_DIR/hack${i}.crt\""
  eval "KEY_${i}=\"\$HACKATHON_DIR/hack${i}.key\""
done
for i in 1 2 3; do
  crt_var="CRT_${i}"; key_var="KEY_${i}"
  [ -f "${!crt_var}" ] || { err "missing ${!crt_var} (run scripts/hackathon-prepare.sh first, or pass the right HACKATHON_DIR)"; exit 1; }
  [ -f "${!key_var}" ] || { err "missing ${!key_var}"; exit 1; }
done

# ─── Scratch space ──────────────────────────────────────────────────────────

SCRATCH_DIR="$(mktemp -d)"
cleanup_scratch() { rm -rf "$SCRATCH_DIR"; }
trap cleanup_scratch EXIT

CURL_OPTS=()
if [ "${SMOKE_INSECURE:-0}" = "1" ]; then
  CURL_OPTS+=(-k)
fi

# Small embedded JSON helper (mirrors hackathon-prepare.sh's json_string:
# prefer python3, fall back to jq). Supports the handful of query shapes
# this script needs: scalar-by-dotted-path, array length, and
# find-field-by-match. All three are read-only and tolerate a malformed or
# unexpected body by returning an empty result instead of throwing, so a
# broken response surfaces as a clean FAIL rather than a bash crash.
PYUTIL="$SCRATCH_DIR/jsonutil.py"
cat > "$PYUTIL" <<'PYEOF'
import sys, json

def load(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None

def walk(d, path):
    cur = d
    if not path:
        return cur
    for part in path.split('.'):
        if part == '':
            continue
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except Exception:
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur

def stringify(v):
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    return str(v)

def main():
    mode = sys.argv[1]
    file = sys.argv[2]
    d = load(file)
    if d is None:
        d = {}
    if mode == 'get':
        print(stringify(walk(d, sys.argv[3])))
    elif mode == 'len':
        v = walk(d, sys.argv[3])
        try:
            print(len(v))
        except Exception:
            print(0)
    elif mode == 'find':
        apath, mfield, mvalue, rfield = sys.argv[3:7]
        arr = walk(d, apath)
        result = ''
        if isinstance(arr, list):
            for item in arr:
                if isinstance(item, dict) and stringify(item.get(mfield)) == mvalue:
                    result = stringify(item.get(rfield))
                    break
        print(result)

main()
PYEOF

json_get() { # json_get FILE DOTTED_PATH
  if [ "$HAVE_PY" = 1 ]; then
    "$PY" "$PYUTIL" get "$1" "$2" 2>/dev/null || true
  else
    jq -r ".$2 // empty" "$1" 2>/dev/null || true
  fi
}
json_len() { # json_len FILE DOTTED_PATH
  if [ "$HAVE_PY" = 1 ]; then
    "$PY" "$PYUTIL" len "$1" "$2" 2>/dev/null || echo 0
  else
    jq -r ".$2 | length" "$1" 2>/dev/null || echo 0
  fi
}
json_find_field() { # json_find_field FILE ARRAY_PATH MATCH_FIELD MATCH_VALUE RETURN_FIELD
  if [ "$HAVE_PY" = 1 ]; then
    "$PY" "$PYUTIL" find "$1" "$2" "$3" "$4" "$5" 2>/dev/null || true
  else
    jq -r --arg mv "$4" ".$2[]? | select((.$3|tostring)==\$mv) | .$5" "$1" 2>/dev/null | head -n1 || true
  fi
}

# curl_json METHOD URL [extra curl args...]
# Sets HTTP_STATUS and RESP_FILE. Never raises under set -e: a connection
# failure (curl itself exiting non-zero) becomes HTTP_STATUS=000 so callers
# can turn it into a normal FAIL line instead of a bash stack trace.
curl_json() {
  local method="$1" url="$2"
  shift 2
  RESP_FILE="$(mktemp "$SCRATCH_DIR/resp.XXXXXX")"
  local rc=0
  set +e
  HTTP_STATUS="$(curl -sS -o "$RESP_FILE" -w '%{http_code}' --connect-timeout 10 --max-time 60 \
    -X "$method" "${CURL_OPTS[@]}" "$@" "$url")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    HTTP_STATUS="000"
  fi
}

mask() { # mask STRING -> first 12 chars + ellipsis (never print full tokens/fingerprints)
  local s="$1"
  echo "${s:0:12}..."
}

# All three nginx configs (nginx.conf, nginx.prod.conf, nginx.cert-auth.conf)
# put a tight leaky-bucket limit_req on the whole /auth/ prefix (rate=5r/m,
# burst 3-5, nodelay) -- a defense-in-depth throttle independent of the
# backend's own Redis-backed otpRateLimit. Confirmed empirically: about 4
# requests to an /auth/* path go through immediately, then each further one
# needs roughly 13s before nginx stops answering 429. This script makes 9
# such calls in total (3 logins, 3 /auth/me, the no-cert negative check, the
# freshly onboarded cert's login, the post-cleanup cert check), so calls
# beyond the free burst are paced to avoid a spurious FAIL that has nothing
# to do with application correctness.
AUTH_ZONE_CALLS=0
throttle_auth_zone() {
  AUTH_ZONE_CALLS=$((AUTH_ZONE_CALLS + 1))
  if [ "$AUTH_ZONE_CALLS" -gt 3 ]; then
    sleep 13
  fi
}

# ─── PASS / FAIL / INFO bookkeeping ────────────────────────────────────────

declare -a SUMMARY=()
PASS_COUNT=0
TOTAL_COUNT=0

print_summary() {
  echo
  echo "=== Summary ($PASS_COUNT/$TOTAL_COUNT checks passed) ==="
  local row lvl status name reason
  for row in "${SUMMARY[@]}"; do
    IFS='|' read -r lvl status name reason <<< "$row"
    printf '%-4s [%-3s] %-42s %s\n' "$lvl" "$status" "$name" "$reason"
  done
}

pass() { # pass NAME HTTP_STATUS REASON
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "PASS [$2] $1 -- $3"
  SUMMARY+=("PASS|$2|$1|$3")
}

fail() { # fail NAME HTTP_STATUS REASON
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  echo "FAIL [$2] $1 -- $3"
  SUMMARY+=("FAIL|$2|$1|$3")
  print_summary
  echo
  echo "Hackathon rehearsal FAILED at: $1"
  exit 1
}

info() { # info NAME REASON
  echo "INFO [--] $1 -- $2"
  SUMMARY+=("INFO|--|$1|$2")
}

# ─── Step 1: reachability ──────────────────────────────────────────────────

curl_json GET "$BASE_URL/health/ready"
DB_OK="$(json_get "$RESP_FILE" db)"
REDIS_OK="$(json_get "$RESP_FILE" redis)"
if [ "$HTTP_STATUS" = "200" ] && [ "$DB_OK" = "ok" ] && [ "$REDIS_OK" = "ok" ]; then
  pass "1-health-ready" "$HTTP_STATUS" "db=ok redis=ok"
else
  fail "1-health-ready" "$HTTP_STATUS" "expected 200 db=ok redis=ok, got db=$DB_OK redis=$REDIS_OK"
fi

# ─── Step 2: cert login for hack1/hack2/hack3 ──────────────────────────────
# backend/src/routes/auth.routes.ts POST /auth/client-cert-login

declare -A TOKEN
declare -A EMAIL
declare -A ORG_ID
for i in 1 2 3; do
  EMAIL[$i]="hack${i}@klinik-${i}.example.de"
  ORG_ID[$i]="klinik-${i}.example.de"
done

for i in 1 2 3; do
  crt_var="CRT_${i}"; key_var="KEY_${i}"
  throttle_auth_zone
  curl_json POST "$BASE_URL/auth/client-cert-login" --cert "${!crt_var}" --key "${!key_var}"
  RESP_EMAIL="$(json_get "$RESP_FILE" data.email)"
  TOKEN[$i]="$(json_get "$RESP_FILE" data.accessToken)"
  if [ "$HTTP_STATUS" = "200" ] && [ "${RESP_EMAIL,,}" = "${EMAIL[$i],,}" ] && [ -n "${TOKEN[$i]}" ]; then
    pass "2-login-hack${i}" "$HTTP_STATUS" "logged in as ${RESP_EMAIL}"
  else
    fail "2-login-hack${i}" "$HTTP_STATUS" "expected 200 email=${EMAIL[$i]}, got email=${RESP_EMAIL} err=$(json_get "$RESP_FILE" error.code)"
  fi
done

# ─── Step 3: /auth/me, /api/v1/instances, /api/v1/instances/:id/organization

declare -A INSTANCE_ID
CROSS_TENANT_NOTED=0
for i in 1 2 3; do
  # /auth/me
  throttle_auth_zone
  curl_json GET "$BASE_URL/auth/me" -H "Authorization: Bearer ${TOKEN[$i]}"
  ME_EMAIL="$(json_get "$RESP_FILE" data.email)"
  IS_ADMIN="$(json_get "$RESP_FILE" data.isAdmin)"
  if [ "$HTTP_STATUS" = "200" ] && [ "$IS_ADMIN" = "true" ] && [ "${ME_EMAIL,,}" = "${EMAIL[$i],,}" ]; then
    pass "3-me-hack${i}" "$HTTP_STATUS" "email=${ME_EMAIL} isAdmin=true"
  else
    fail "3-me-hack${i}" "$HTTP_STATUS" "expected isAdmin=true for ${EMAIL[$i]}, got email=$ME_EMAIL isAdmin=$IS_ADMIN"
  fi

  # /api/v1/instances -- every hackathon user is an IMI admin, and
  # instances.service.ts's listForUser() grants admins cross-tenant
  # visibility (list ALL instances, not just the caller's own) -- see
  # backend/src/services/instances.service.ts:35-59. So this can NOT be
  # "exactly one instance"; it asserts the list CONTAINS the user's own
  # instance instead.
  curl_json GET "$BASE_URL/api/v1/instances" -H "Authorization: Bearer ${TOKEN[$i]}"
  MY_INSTANCE_ID="$(json_find_field "$RESP_FILE" data "label" "${ORG_ID[$i]}" id)"
  TOTAL_INSTANCES="$(json_len "$RESP_FILE" data)"
  if [ "$HTTP_STATUS" = "200" ] && [ -n "$MY_INSTANCE_ID" ]; then
    INSTANCE_ID[$i]="$MY_INSTANCE_ID"
    pass "3-instances-hack${i}" "$HTTP_STATUS" "list contains ${ORG_ID[$i]} (id ${MY_INSTANCE_ID}); $TOTAL_INSTANCES total visible (admin cross-tenant view)"
    if [ "$CROSS_TENANT_NOTED" -eq 0 ] && [ "$TOTAL_INSTANCES" -gt 1 ] 2>/dev/null; then
      info "3-admin-visibility" "GET /api/v1/instances returns $TOTAL_INSTANCES instances for an admin, not just their own (instances.service.ts:35-59) -- by design, not a bug"
      CROSS_TENANT_NOTED=1
    fi
  else
    fail "3-instances-hack${i}" "$HTTP_STATUS" "expected the list to contain an instance labelled ${ORG_ID[$i]}"
  fi

  # /api/v1/instances/:id/organization
  curl_json GET "$BASE_URL/api/v1/instances/${INSTANCE_ID[$i]}/organization" -H "Authorization: Bearer ${TOKEN[$i]}"
  ORG_IDENTIFIER="$(json_get "$RESP_FILE" data.identifier)"
  if [ "$HTTP_STATUS" = "200" ] && [ "$ORG_IDENTIFIER" = "${ORG_ID[$i]}" ]; then
    pass "3-org-hack${i}" "$HTTP_STATUS" "organization identifier=${ORG_IDENTIFIER}"
  else
    fail "3-org-hack${i}" "$HTTP_STATUS" "expected identifier=${ORG_ID[$i]}, got $ORG_IDENTIFIER"
  fi
done

# ─── Step 4: negative auth checks ──────────────────────────────────────────

# 4a. POST /auth/client-cert-login with no client certificate presented at all.
throttle_auth_zone
curl_json POST "$BASE_URL/auth/client-cert-login"
ERR_CODE="$(json_get "$RESP_FILE" error.code)"
if [ "$HTTP_STATUS" = "401" ]; then
  pass "4a-no-cert-login" "$HTTP_STATUS" "code=$ERR_CODE"
else
  fail "4a-no-cert-login" "$HTTP_STATUS" "expected 401, got $HTTP_STATUS (code=$ERR_CODE)"
fi

# 4b. A valid bearer token (cert-authenticated session, amr=cert) but the
# cert itself is NOT re-presented on this specific request. Proves a stolen
# access token alone cannot satisfy the step-up guard for a sensitive write.
# backend/src/middleware/stepUp.middleware.ts checkStepUp(): authMethod
# 'cert' branch requires extractClientCert(req) to succeed and resolve to
# the SAME user id; with no cert headers on this request it returns
# CERT_STEP_UP_FAILED (401) before admin-users.service ever runs.
curl_json POST "$BASE_URL/api/v1/admin/users" \
  -H "Authorization: Bearer ${TOKEN[1]}" \
  -H "Content-Type: application/json" \
  --data '{"email":"smoke-negative-4b@klinik-1-smoke.example.de"}'
ERR_CODE="$(json_get "$RESP_FILE" error.code)"
if [ "$HTTP_STATUS" = "401" ] && [ "$ERR_CODE" = "CERT_STEP_UP_FAILED" ]; then
  pass "4b-stolen-token-no-cert" "$HTTP_STATUS" "code=$ERR_CODE (stolen token alone cannot satisfy cert step-up)"
else
  fail "4b-stolen-token-no-cert" "$HTTP_STATUS" "expected 401 CERT_STEP_UP_FAILED, got $HTTP_STATUS code=$ERR_CODE"
fi

# 4c. POST /auth/request-otp -- the cert-auth Apache/nginx config returns a
# hard 403 for the whole OTP entry surface before it ever reaches Express
# (see docs/DEPLOYMENT.md's Apache section and nginx/nginx.cert-auth.conf).
# On a standard (non-cert-auth) stack this route is open and always answers
# 200 (auth.routes.ts never reveals whitelist status), so anything other
# than 403 is reported as INFO, not FAIL.
throttle_auth_zone
curl_json POST "$BASE_URL/auth/request-otp" \
  -H "Content-Type: application/json" \
  --data '{"email":"smoke-otp-check@example.de"}'
if [ "$HTTP_STATUS" = "403" ]; then
  pass "4c-otp-path-closed" "$HTTP_STATUS" "OTP entrypoint closed by the reverse proxy, as expected on a cert-auth deployment"
else
  info "4c-otp-path-closed" "got $HTTP_STATUS instead of 403 -- fine on a standard (non-cert-auth) stack, otherwise check the reverse-proxy config in docs/DEPLOYMENT.md"
fi

# ─── Step 5: four-eyes approval ────────────────────────────────────────────
# backend/src/lib/approvalState.ts deriveStatus()/validateApproval() and
# backend/src/services/approval.service.ts approveRequest() drive this.
# Two things this rehearsal derives from the source rather than assuming:
#
#   1. There is NO "can't approve your own site's request" rule anywhere in
#      this path (grepped for OWN_SITE/SELF_APPROVE: the only SELF_APPROVE
#      guard in the codebase is admin-promotions.service.ts:110, an
#      unrelated feature). So hack1 CAN sign its own pending request; it
#      just counts as the first of the two signatures needed.
#   2. deriveStatus() promotes to APPROVED once 2 signatures from 2
#      DIFFERENT sites exist (approvalState.ts:38) -- confirmed by the
#      existing test "second cross-site sign-off resolves the request ->
#      APPROVED" in backend/src/__tests__/api/admin-approval.routes.test.ts:247-268,
#      which asserts exactly 2 signatures. A THIRD admin therefore never
#      gets to be the one who approves it: approveRequest() checks
#      `request.status !== 'PENDING'` (approval.service.ts:175) BEFORE it
#      even looks at who is signing, so any attempt after the 2nd
#      cross-site approval -- a new admin or a repeat of one who already
#      signed -- gets REQUEST_FINALIZED, never ALREADY_DECIDED or APPROVED.
#      ALREADY_DECIDED is reachable only for a repeat signature while the
#      request is STILL pending (i.e. before the 2nd distinct site signs).
#
# This also means klinik-2 and klinik-3's OWN pending requests (seeded
# alongside klinik-1's) need to be resolved too, or they will never reach
# APPROVED and step 7's bundle check would wrongly fail for them.

get_approval_status() { # get_approval_status USER_INDEX -> sets AS_ID, AS_STATUS
  local i="$1" crt_var key_var
  crt_var="CRT_${i}"; key_var="KEY_${i}"
  curl_json GET "$BASE_URL/api/v1/instances/${INSTANCE_ID[$i]}/approval/status" \
    -H "Authorization: Bearer ${TOKEN[$i]}" --cert "${!crt_var}" --key "${!key_var}"
  AS_ID="$(json_get "$RESP_FILE" data.id)"
  AS_STATUS="$(json_get "$RESP_FILE" data.status)"
}

approve_as() { # approve_as APPROVER_INDEX REQUEST_ID -> sets AP_STATUS, AP_REASON, AP_ERR (HTTP_STATUS global)
  local approver="$1" rid="$2" crt_var key_var
  crt_var="CRT_${approver}"; key_var="KEY_${approver}"
  curl_json POST "$BASE_URL/api/v1/admin/approval/$rid/approve" \
    -H "Authorization: Bearer ${TOKEN[$approver]}" \
    -H "Content-Type: application/json" \
    --data '{}' \
    --cert "${!crt_var}" --key "${!key_var}"
  AP_STATUS="$(json_get "$RESP_FILE" data.status)"
  AP_REASON="$(json_get "$RESP_FILE" data.reason)"
  AP_ERR="$(json_get "$RESP_FILE" error.code)"
}

declare -A RID
for i in 1 2 3; do
  get_approval_status "$i"
  if [ "$HTTP_STATUS" = "200" ] && [ "$AS_STATUS" = "PENDING" ] && [ -n "$AS_ID" ]; then
    RID[$i]="$AS_ID"
    pass "5-seed-pending-rid${i}" "$HTTP_STATUS" "hack${i}'s own request is PENDING as seeded"
  else
    fail "5-seed-pending-rid${i}" "$HTTP_STATUS" "expected a PENDING approval request for hack${i}'s instance, got status=$AS_STATUS"
  fi
done

# 5.0: the admin pending list surfaces hack1's request (task explicitly
# names this endpoint; the request id above came from the simpler
# per-instance /approval/status route to avoid depending on the exact
# in-transit shape of the JSON snapshot column).
curl_json GET "$BASE_URL/api/v1/admin/approval/pending" \
  -H "Authorization: Bearer ${TOKEN[1]}" --cert "$CRT_1" --key "$KEY_1"
FOUND_STATUS="$(json_find_field "$RESP_FILE" data "id" "${RID[1]}" status)"
if [ "$HTTP_STATUS" = "200" ] && [ "$FOUND_STATUS" = "PENDING" ]; then
  pass "5-pending-list-contains-rid1" "$HTTP_STATUS" "GET /admin/approval/pending lists hack1's request as PENDING"
else
  fail "5-pending-list-contains-rid1" "$HTTP_STATUS" "expected rid1 to appear PENDING in the admin pending list, got status=$FOUND_STATUS"
fi

# 5a. hack1 approves its own request (own-site approval is allowed; see
# comment block above) -> first signature, status stays PENDING.
approve_as 1 "${RID[1]}"
if [ "$HTTP_STATUS" = "200" ] && [ "$AP_STATUS" = "PENDING" ] && [ "$AP_REASON" = "AWAITING_SECOND_OR_SILENT_CONSENT" ]; then
  pass "5a-hack1-self-approve-rid1" "$HTTP_STATUS" "own-site approval allowed (no self-check in approval.service.ts); status=PENDING"
else
  fail "5a-hack1-self-approve-rid1" "$HTTP_STATUS" "expected 200 PENDING/AWAITING_SECOND_OR_SILENT_CONSENT, got status=$AP_STATUS reason=$AP_REASON err=$AP_ERR"
fi

# 5b. hack1 approves the SAME still-pending request again -> ALREADY_DECIDED.
approve_as 1 "${RID[1]}"
if [ "$HTTP_STATUS" = "409" ] && [ "$AP_ERR" = "ALREADY_DECIDED" ]; then
  pass "5b-hack1-duplicate-approve-rid1" "$HTTP_STATUS" "same admin re-signing a still-PENDING request -> ALREADY_DECIDED"
else
  fail "5b-hack1-duplicate-approve-rid1" "$HTTP_STATUS" "expected 409 ALREADY_DECIDED, got $HTTP_STATUS $AP_ERR"
fi

# 5c. hack2 (different site) approves -> 2nd distinct site -> APPROVED.
approve_as 2 "${RID[1]}"
if [ "$HTTP_STATUS" = "200" ] && [ "$AP_STATUS" = "APPROVED" ]; then
  pass "5c-hack2-cross-site-approve-rid1" "$HTTP_STATUS" "2nd distinct site (klinik-2) finalizes to APPROVED with only 2 signatures"
else
  fail "5c-hack2-cross-site-approve-rid1" "$HTTP_STATUS" "expected 200 APPROVED, got status=$AP_STATUS err=$AP_ERR"
fi

# 5d. hack3 tries to approve the now-APPROVED request -> REQUEST_FINALIZED,
# never APPROVED and never ALREADY_DECIDED (see comment block above).
approve_as 3 "${RID[1]}"
if [ "$HTTP_STATUS" = "409" ] && [ "$AP_ERR" = "REQUEST_FINALIZED" ]; then
  pass "5d-hack3-late-approve-rid1" "$HTTP_STATUS" "request already APPROVED before hack3 could sign -> REQUEST_FINALIZED"
else
  fail "5d-hack3-late-approve-rid1" "$HTTP_STATUS" "expected 409 REQUEST_FINALIZED, got $HTTP_STATUS $AP_ERR (status=$AP_STATUS)"
fi

# 5e. hack2 (who already signed) tries again after finalization -> the
# status-not-pending check runs first, so this is also REQUEST_FINALIZED,
# not ALREADY_DECIDED.
approve_as 2 "${RID[1]}"
if [ "$HTTP_STATUS" = "409" ] && [ "$AP_ERR" = "REQUEST_FINALIZED" ]; then
  pass "5e-hack2-repeat-after-finalized-rid1" "$HTTP_STATUS" "post-finalization retry -> REQUEST_FINALIZED (status check precedes the duplicate-signature check)"
else
  fail "5e-hack2-repeat-after-finalized-rid1" "$HTTP_STATUS" "expected 409 REQUEST_FINALIZED, got $HTTP_STATUS $AP_ERR"
fi

# 5f/5g. Resolve klinik-2's and klinik-3's own pending requests too (2
# distinct-site signatures each), so all three sites are genuinely APPROVED
# ahead of step 7's bundle check.
approve_as 1 "${RID[2]}"
if [ "$HTTP_STATUS" = "200" ] && [ "$AP_STATUS" = "PENDING" ]; then
  pass "5f-hack1-approve-rid2" "$HTTP_STATUS" "1st signature on klinik-2's own request"
else
  fail "5f-hack1-approve-rid2" "$HTTP_STATUS" "expected 200 PENDING, got status=$AP_STATUS err=$AP_ERR"
fi
approve_as 3 "${RID[2]}"
if [ "$HTTP_STATUS" = "200" ] && [ "$AP_STATUS" = "APPROVED" ]; then
  pass "5g-hack3-approve-rid2" "$HTTP_STATUS" "2nd distinct-site signature -> APPROVED"
else
  fail "5g-hack3-approve-rid2" "$HTTP_STATUS" "expected 200 APPROVED, got status=$AP_STATUS err=$AP_ERR"
fi

approve_as 1 "${RID[3]}"
if [ "$HTTP_STATUS" = "200" ] && [ "$AP_STATUS" = "PENDING" ]; then
  pass "5h-hack1-approve-rid3" "$HTTP_STATUS" "1st signature on klinik-3's own request"
else
  fail "5h-hack1-approve-rid3" "$HTTP_STATUS" "expected 200 PENDING, got status=$AP_STATUS err=$AP_ERR"
fi
approve_as 2 "${RID[3]}"
if [ "$HTTP_STATUS" = "200" ] && [ "$AP_STATUS" = "APPROVED" ]; then
  pass "5i-hack2-approve-rid3" "$HTTP_STATUS" "2nd distinct-site signature -> APPROVED"
else
  fail "5i-hack2-approve-rid3" "$HTTP_STATUS" "expected 200 APPROVED, got status=$AP_STATUS err=$AP_ERR"
fi

# ─── Step 6: bulk CSV onboarding ───────────────────────────────────────────
# backend/src/routes/onboarding.routes.ts + services/onboarding.service.ts

SMOKE_ORG="klinik-vier-smoke.example.de"
SMOKE_EMAIL="smoke@klinik-vier-smoke.example.de"
SMOKE_CERT_DIR="$SCRATCH_DIR/smoke-cert"
mkdir -p "$SMOKE_CERT_DIR"
SMOKE_CRT="$SMOKE_CERT_DIR/smoke-vier.crt"
SMOKE_KEY="$SMOKE_CERT_DIR/smoke-vier.key"

# MSYS2_ARG_CONV_EXCL (not MSYS_NO_PATHCONV) so only the "/CN=..." argument
# is left untranslated under Git Bash on Windows; MSYS_NO_PATHCONV would also
# stop $SMOKE_KEY/$SMOKE_CRT (real /tmp/... paths) from being translated for
# openssl.exe, and openssl would fail to open them for writing. No-op on a
# real Linux/macOS shell.
MSYS2_ARG_CONV_EXCL="/CN=" openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -subj "/CN=${SMOKE_EMAIL}/O=Hackathon-Smoke" \
  -keyout "$SMOKE_KEY" -out "$SMOKE_CRT" \
  >/dev/null 2>&1
SMOKE_FP="$(openssl x509 -in "$SMOKE_CRT" -outform DER | openssl dgst -sha512 -r | awk '{print $1}')"
info "6-generate-smoke-cert" "generated ${SMOKE_ORG} throwaway cert, fingerprint $(mask "$SMOKE_FP")"

# Best-effort idempotency guard: remove a leftover whitelist entry from a
# previous, possibly-interrupted run so "created" below is meaningful. Not
# scored PASS/FAIL -- a 404 (nothing to remove) is the expected common case.
curl_json DELETE "$BASE_URL/api/v1/admin/users/$SMOKE_EMAIL" \
  -H "Authorization: Bearer ${TOKEN[1]}" --cert "$CRT_1" --key "$KEY_1" >/dev/null 2>&1 || true
if [ "$HTTP_STATUS" = "200" ]; then
  info "6-pre-clean" "removed a leftover ${SMOKE_EMAIL} whitelist entry from a previous run"
fi

CSV_HEADER="organizationIdentifier,organizationName,contactEmail,clientCertFingerprint,city,countryCode"
CSV_CREATE="$SCRATCH_DIR/onboard-create.csv"
{
  echo "$CSV_HEADER"
  echo "${SMOKE_ORG},Klinikum Vier (Smoke),${SMOKE_EMAIL},${SMOKE_FP},Musterstadt,DE"
} > "$CSV_CREATE"

# 6a. First upload -> created.
curl_json POST "$BASE_URL/api/v1/admin/onboarding/import" \
  -H "Authorization: Bearer ${TOKEN[1]}" \
  -H "Content-Type: text/csv" \
  --cert "$CRT_1" --key "$KEY_1" \
  --data-binary @"$CSV_CREATE"
CREATED="$(json_get "$RESP_FILE" data.summary.created)"
ROW_ACTION="$(json_find_field "$RESP_FILE" data.rows identifier "$SMOKE_ORG" action)"
if [ "$HTTP_STATUS" = "200" ] && [ "$CREATED" = "1" ] && [ "$ROW_ACTION" = "created" ]; then
  pass "6a-onboard-create" "$HTTP_STATUS" "summary.created=1, row action=created"
else
  fail "6a-onboard-create" "$HTTP_STATUS" "expected summary.created=1 action=created, got created=$CREATED action=$ROW_ACTION"
fi

# 6b. Re-upload the SAME csv -> idempotent update, not a duplicate create.
curl_json POST "$BASE_URL/api/v1/admin/onboarding/import" \
  -H "Authorization: Bearer ${TOKEN[1]}" \
  -H "Content-Type: text/csv" \
  --cert "$CRT_1" --key "$KEY_1" \
  --data-binary @"$CSV_CREATE"
UPDATED="$(json_get "$RESP_FILE" data.summary.updated)"
ROW_ACTION="$(json_find_field "$RESP_FILE" data.rows identifier "$SMOKE_ORG" action)"
if [ "$HTTP_STATUS" = "200" ] && [ "$UPDATED" = "1" ] && [ "$ROW_ACTION" = "updated" ]; then
  pass "6b-onboard-idempotent-update" "$HTTP_STATUS" "summary.updated=1, row action=updated"
else
  fail "6b-onboard-idempotent-update" "$HTTP_STATUS" "expected summary.updated=1 action=updated, got updated=$UPDATED action=$ROW_ACTION"
fi

# 6c. The freshly onboarded site can sign in with its own cert straight away.
throttle_auth_zone
curl_json POST "$BASE_URL/auth/client-cert-login" --cert "$SMOKE_CRT" --key "$SMOKE_KEY"
NEW_EMAIL="$(json_get "$RESP_FILE" data.email)"
if [ "$HTTP_STATUS" = "200" ] && [ "${NEW_EMAIL,,}" = "${SMOKE_EMAIL,,}" ]; then
  pass "6c-onboard-new-cert-login" "$HTTP_STATUS" "freshly onboarded cert logs in as ${NEW_EMAIL}"
else
  fail "6c-onboard-new-cert-login" "$HTTP_STATUS" "expected 200 email=${SMOKE_EMAIL}, got $NEW_EMAIL"
fi

# 6d. A PEM anywhere in the upload is rejected outright (file-level guard,
# runs before any row parsing) -- onboarding.service.ts parseOnboardingFile().
curl_json POST "$BASE_URL/api/v1/admin/onboarding/import" \
  -H "Authorization: Bearer ${TOKEN[1]}" \
  -H "Content-Type: text/csv" \
  --cert "$CRT_1" --key "$KEY_1" \
  --data-binary @"$SMOKE_CRT"
ERR_CODE="$(json_get "$RESP_FILE" error.code)"
if [ "$HTTP_STATUS" = "400" ] && [ "$ERR_CODE" = "PEM_NOT_ALLOWED" ]; then
  pass "6d-onboard-pem-reject" "$HTTP_STATUS" "code=$ERR_CODE"
else
  fail "6d-onboard-pem-reject" "$HTTP_STATUS" "expected 400 PEM_NOT_ALLOWED, got $HTTP_STATUS $ERR_CODE"
fi

# 6e. A row whose organizationName starts with a formula character is
# reported as a parse error, not imported (CSV/Excel formula-injection
# guard) -- onboarding.service.ts hasNoFormulaInjectionPrefix().
FORMULA_FP="$(openssl rand -hex 64)"
CSV_FORMULA="$SCRATCH_DIR/onboard-formula.csv"
{
  echo "$CSV_HEADER"
  echo "formula-guard-smoke.example.de,=cmd|'/C calc'!A1,smoke-formula@formula-guard-smoke.example.de,${FORMULA_FP},Musterstadt,DE"
} > "$CSV_FORMULA"
curl_json POST "$BASE_URL/api/v1/admin/onboarding/import" \
  -H "Authorization: Bearer ${TOKEN[1]}" \
  -H "Content-Type: text/csv" \
  --cert "$CRT_1" --key "$KEY_1" \
  --data-binary @"$CSV_FORMULA"
PARSE_ERRORS="$(json_len "$RESP_FILE" data.parseErrors)"
CREATED="$(json_get "$RESP_FILE" data.summary.created)"
if [ "$HTTP_STATUS" = "200" ] && [ "$PARSE_ERRORS" -ge 1 ] 2>/dev/null && [ "$CREATED" = "0" ]; then
  pass "6e-onboard-formula-guard" "$HTTP_STATUS" "row rejected as a parse error (formula-injection guard), nothing imported"
else
  fail "6e-onboard-formula-guard" "$HTTP_STATUS" "expected 200 with >=1 parseErrors and created=0, got parseErrors=$PARSE_ERRORS created=$CREATED"
fi

# ─── Step 7: allow-list bundle (what DownloadAllowList consumes) ──────────
# backend/src/routes/fhir.routes.ts + services/fhir.service.ts

curl_json GET "$BASE_URL/fhir/Bundle?identifier=http://dsf.dev/fhir/CodeSystem/allow-list|allow_list" \
  --cert "$CRT_1" --key "$KEY_1"
RESOURCE_TYPE="$(json_get "$RESP_FILE" resourceType)"
if [ "$HTTP_STATUS" = "200" ] && [ "$RESOURCE_TYPE" = "Bundle" ]; then
  pass "7a-bundle-fetch" "$HTTP_STATUS" "resourceType=Bundle"
else
  fail "7a-bundle-fetch" "$HTTP_STATUS" "expected 200 resourceType=Bundle, got $RESOURCE_TYPE"
fi

BUNDLE_TEXT="$(cat "$RESP_FILE")"
MISSING=""
for needle in "klinik-1.example.de" "klinik-2.example.de" "klinik-3.example.de" "hackathon-hub.example.de"; do
  case "$BUNDLE_TEXT" in
    *"$needle"*) ;;
    *) MISSING="$MISSING $needle" ;;
  esac
done
if [ -z "$MISSING" ]; then
  pass "7b-bundle-contains-sites" "$HTTP_STATUS" "klinik-1/2/3.example.de and hackathon-hub.example.de all present"
else
  fail "7b-bundle-contains-sites" "$HTTP_STATUS" "missing from bundle:$MISSING (did step 5 actually reach APPROVED for all three?)"
fi

case "$BUNDLE_TEXT" in
  *'"resourceType":"OrganizationAffiliation"'*)
    pass "7c-bundle-has-affiliation" "$HTTP_STATUS" "at least one OrganizationAffiliation entry present"
    ;;
  *)
    fail "7c-bundle-has-affiliation" "$HTTP_STATUS" "no OrganizationAffiliation entry found in the bundle"
    ;;
esac

# Bulk onboarding alone does NOT create an approval_requests row (confirmed
# by reading onboarding.service.ts's importSites -- it never touches that
# table) and generateFullBundle() requires the instance's LATEST approval
# request to be APPROVED (fhir.service.ts:258-262, and the regression test
# fhir-bundle-latest-approval.test.ts). So the site onboarded in step 6 must
# be ABSENT here -- if it ever shows up, onboarding has started silently
# bypassing the approval gate, which would be a real regression.
case "$BUNDLE_TEXT" in
  *"$SMOKE_ORG"*)
    fail "7d-bundle-excludes-unapproved-onboarding" "$HTTP_STATUS" "${SMOKE_ORG} appeared in the bundle despite never being approved -- approval gate bypass regression"
    ;;
  *)
    pass "7d-bundle-excludes-unapproved-onboarding" "$HTTP_STATUS" "${SMOKE_ORG} correctly absent (onboarding alone does not approve a site)"
    ;;
esac

# No client certificate at all -> unauthenticated, machine-to-machine route.
curl_json GET "$BASE_URL/fhir/Bundle?identifier=http://dsf.dev/fhir/CodeSystem/allow-list|allow_list"
if [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ]; then
  pass "7e-bundle-no-cert" "$HTTP_STATUS" "unauthenticated request rejected"
else
  fail "7e-bundle-no-cert" "$HTTP_STATUS" "expected 401/403 without a client certificate"
fi

# ─── Step 8: GUI bundle download + IP-address Excel export ────────────────
# backend/src/routes/download.routes.ts

curl_json GET "$BASE_URL/api/v1/download/full-bundle" \
  -H "Authorization: Bearer ${TOKEN[1]}" --cert "$CRT_1" --key "$KEY_1"
BODY_SIZE="$(wc -c < "$RESP_FILE" | tr -d ' ')"
if [ "$HTTP_STATUS" = "200" ] && [ "$BODY_SIZE" -gt 0 ] 2>/dev/null; then
  pass "8a-gui-full-bundle" "$HTTP_STATUS" "non-empty body (${BODY_SIZE} bytes)"
else
  fail "8a-gui-full-bundle" "$HTTP_STATUS" "expected 200 with a non-empty body, got ${BODY_SIZE} bytes"
fi

CT_FILE="$SCRATCH_DIR/ip-list-headers"
RESP_FILE_XLSX="$(mktemp "$SCRATCH_DIR/resp.XXXXXX")"
set +e
HTTP_STATUS="$(curl -sS -D "$CT_FILE" -o "$RESP_FILE_XLSX" -w '%{http_code}' --connect-timeout 10 --max-time 60 \
  -X GET "${CURL_OPTS[@]}" \
  -H "Authorization: Bearer ${TOKEN[1]}" --cert "$CRT_1" --key "$KEY_1" \
  "$BASE_URL/api/v1/download/ip-address-list")"
rc=$?
set -e
[ "$rc" -ne 0 ] && HTTP_STATUS="000"
XLSX_SIZE="$(wc -c < "$RESP_FILE_XLSX" 2>/dev/null | tr -d ' ')"
XLSX_SIZE="${XLSX_SIZE:-0}"
if grep -qi 'content-type:.*spreadsheetml' "$CT_FILE" 2>/dev/null; then
  IS_SPREADSHEET=1
else
  IS_SPREADSHEET=0
fi
if [ "$HTTP_STATUS" = "200" ] && [ "$IS_SPREADSHEET" = "1" ] && [ "$XLSX_SIZE" -gt 1024 ] 2>/dev/null; then
  pass "8b-ip-address-excel" "$HTTP_STATUS" "spreadsheet content-type, ${XLSX_SIZE} bytes"
else
  fail "8b-ip-address-excel" "$HTTP_STATUS" "expected 200 spreadsheet >1KB, got spreadsheet=$IS_SPREADSHEET size=${XLSX_SIZE}"
fi

# ─── Step 9: cleanup ────────────────────────────────────────────────────────
# There is no admin API endpoint that deletes an organization/instance
# outright (checked every routes/*.ts DELETE handler). The cleanest
# available mechanism is DELETE /api/v1/admin/users/:email, which removes
# the email_whitelist row and revokes sessions immediately (real, API-driven
# cleanup of the login/security surface). Fully removing the residual
# organizations/instances/users rows needs direct DB access; the exact
# statement is printed below, mirroring the teardown SQL documented for the
# hackathon seed itself in docs/DEPLOYMENT.md.

if [ "$KEEP" -eq 1 ]; then
  info "9-cleanup" "--keep passed: leaving ${SMOKE_ORG} / ${SMOKE_EMAIL} in place"
  info "9-cleanup-sql" "to remove it later: DELETE FROM email_whitelist WHERE email = '${SMOKE_EMAIL}'; DELETE FROM users WHERE email = '${SMOKE_EMAIL}'; -- cascades to instances/organizations"
else
  curl_json DELETE "$BASE_URL/api/v1/admin/users/$SMOKE_EMAIL" \
    -H "Authorization: Bearer ${TOKEN[1]}" --cert "$CRT_1" --key "$KEY_1"
  if [ "$HTTP_STATUS" = "200" ]; then
    pass "9a-cleanup-whitelist-remove" "$HTTP_STATUS" "removed ${SMOKE_EMAIL} from email_whitelist and revoked its sessions"
  else
    fail "9a-cleanup-whitelist-remove" "$HTTP_STATUS" "expected 200 removing ${SMOKE_EMAIL} from the whitelist, got $(json_get "$RESP_FILE" error.code)"
  fi
  info "9b-cleanup-sql" "full removal still needs: DELETE FROM users WHERE email = '${SMOKE_EMAIL}'; -- cascades to instances/organizations (audit_logs is append-only and intentionally untouched)"

  # Post-cleanup: the removed site's cert must no longer authenticate.
  throttle_auth_zone
  curl_json POST "$BASE_URL/auth/client-cert-login" --cert "$SMOKE_CRT" --key "$SMOKE_KEY"
  ERR_CODE="$(json_get "$RESP_FILE" error.code)"
  if [ "$HTTP_STATUS" = "401" ]; then
    pass "9c-post-cleanup-cert-401" "$HTTP_STATUS" "removed site's cert now rejected (code=$ERR_CODE)"
  else
    fail "9c-post-cleanup-cert-401" "$HTTP_STATUS" "expected 401 for the removed site's cert, got $HTTP_STATUS $ERR_CODE"
  fi
fi

# ─── Done ───────────────────────────────────────────────────────────────────

print_summary
echo
echo "$PASS_COUNT/$TOTAL_COUNT checks passed"
echo "Hackathon rehearsal PASSED"
