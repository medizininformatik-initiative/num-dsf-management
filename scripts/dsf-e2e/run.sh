#!/usr/bin/env bash
# dsf-e2e/run.sh – Replays the DSF side of the hackathon with the real DSF
# software: a receiving site (DSF FHIR 2.1.1, fhir_proxy, BPE 2.1.1 with
# dsf-process-allow-list 1.0.0.1) starts DownloadAllowList with the Task input
#   https://<portal>/fhir/Bundle/fhir.klinik-e2e.example.de
# and must download the allow list from the local dev portal with its DSF
# client certificate (mTLS) and apply it to its FHIR server.
#
# Usage (repo root, dev stack running via `docker compose up -d`):
#   bash scripts/dsf-e2e/run.sh [--keep]
# --keep leaves the DSF containers and the seeded portal sites in place.
#
# Scenarios and expected outcome:
#   apache        Apache front configured like production    -> completed, peers applied
#   apache-again  the same download a second time            -> completed, updated in place
#   leave-hub     a peer leaves the hub in the portal        -> completed, affiliation deleted
#   nginx         repository nginx/nginx.conf as front       -> completed
#   untrusted     server cert from a CA the BPE does not trust
#                 (stands in for Let's Encrypt)              -> failed
#
# The portal sites are seeded with the production hackathon seed and approved
# directly in the database; the four-eyes flow itself is covered by the jest
# replay tests (backend/src/__tests__/api/hackathon-replay*.test.ts).
# Dependencies: docker compose, openssl, node (host), curl (inside bpe-app).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash: keep container paths such as /certs untouched

# pwd -W yields C:/... under Git Bash, which docker.exe understands.
HERE="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
ROOT="$(cd "$HERE/../.." && (pwd -W 2>/dev/null || pwd))"
WORK="$HERE/.work"
CERTS="$WORK/certs"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

COMPOSE=(docker compose -p dsf-e2e -f "$HERE/docker-compose.yml")
DEV=(docker compose -f "$ROOT/docker-compose.yml")

RECEIVER=klinik-e2e.example.de
RECEIVER_EP="fhir.$RECEIVER"
PEER1=klinik-e2e-peer1.example.de
PEER2=klinik-e2e-peer2.example.de
HUB=hackathon-hub-e2e.example.de
FHIR="https://fhir.$RECEIVER/fhir"
ORG_SID=http://dsf.dev/sid/organization-identifier
EP_SID=http://dsf.dev/sid/endpoint-identifier
PLUGIN=dsf-process-allow-list-1.0.0.1.jar
PLUGIN_URL="https://github.com/datasharingframework/dsf-process-allow-list/releases/download/v1.0.0.1/$PLUGIN"
PLUGIN_SHA256=fc41756eed40fabf68ca2a4f9aad0c2923343d6a8c2c52e57de815191e244738

FAILURES=0
SUMMARY=()

log() { printf '\n== %s\n' "$*"; }
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then
    printf '   ok   %s\n' "$1"
  else
    printf '   FAIL %s: expected %s, got %s\n' "$1" "$3" "$2"
    FAILURES=$((FAILURES + 1))
  fi
}
jsonq() { # jsonq <js-expression over j> < json
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
const r=new Function("j","return ("+process.argv[1]+")")(j);
console.log(typeof r==="string"?r:JSON.stringify(r));})' "$1"
}

# ---------------------------------------------------------------- certificates
# Every certificate is issued from a CSR with an explicit extension file:
# `openssl req -x509` would add the config's default v3_ca extensions, and
# BouncyCastle (DSF) rejects certificates with a repeated extension.
issue() { # issue <name> <subject> <ext lines> <signer: self|ca-name>
  openssl req -new -newkey rsa:2048 -nodes -keyout "$1.key" -out "$1.csr" -subj "$2" 2>/dev/null
  printf '%b' "$3" > "$1.ext"
  if [ "$4" = self ]; then
    openssl x509 -req -in "$1.csr" -signkey "$1.key" -days 30 -sha256 \
      -extfile "$1.ext" -out "$1.crt" 2>/dev/null
  else
    openssl x509 -req -in "$1.csr" -CA "$4.crt" -CAkey "$4.key" -CAcreateserial \
      -days 30 -sha256 -extfile "$1.ext" -out "$1.crt" 2>/dev/null
  fi
  rm -f "$1.csr" "$1.ext"
}

CA_EXT='basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n'
leaf() { # leaf <name> <subject> <san> <eku> [<ca-name>]
  local ext="basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n"
  ext+="extendedKeyUsage=$4\n"
  [ -n "$3" ] && ext+="subjectAltName=$3\n"
  issue "$1" "$2" "$ext" "${5:-issuing-ca}"
}

gen_certs() {
  [ -f "$CERTS/org-client.crt" ] && return 0
  log "Generating the e2e PKI in $CERTS"
  mkdir -p "$CERTS" && cd "$CERTS"
  issue root-ca "/C=DE/O=DSF E2E/CN=DSF E2E Root CA" "$CA_EXT" self
  issue issuing-ca "/C=DE/O=DSF E2E/CN=DSF E2E Issuing CA" \
    'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n' root-ca
  cat issuing-ca.crt root-ca.crt > ca-chain.crt

  leaf fhir-server "/C=DE/O=Klinik E2E/CN=$RECEIVER_EP" "DNS:$RECEIVER_EP" serverAuth
  leaf org-client "/C=DE/O=Klinik E2E/CN=$RECEIVER_EP" "" clientAuth
  leaf portal-server "/C=DE/O=Portal E2E/CN=allowlist.portal-e2e.example.de" \
    "DNS:allowlist.portal-e2e.example.de" serverAuth
  leaf portal-nginx "/C=DE/O=Portal E2E/CN=allowlist-nginx.portal-e2e.example.de" \
    "DNS:allowlist-nginx.portal-e2e.example.de" serverAuth

  issue untrusted-ca "/C=DE/O=Elsewhere/CN=Untrusted E2E CA" "$CA_EXT" self
  leaf untrusted-server "/C=DE/O=Portal E2E/CN=untrusted.portal-e2e.example.de" \
    "DNS:untrusted.portal-e2e.example.de" serverAuth untrusted-ca
  cat untrusted-server.crt untrusted-ca.crt > untrusted-fullchain.crt
  mv untrusted-fullchain.crt untrusted-server.crt

  for peer in "$PEER1" "$PEER2"; do
    issue "$peer" "/C=DE/O=Peer/CN=dsf-client.$peer" \
      'basicConstraints=CA:FALSE\nextendedKeyUsage=clientAuth\n' self
  done

  mkdir -p "$WORK/nginx-certs"
  cat portal-nginx.crt issuing-ca.crt > "$WORK/nginx-certs/server.crt"
  cp portal-nginx.key "$WORK/nginx-certs/server.key"
  # As shipped: the dev stack's client CA, unrelated to the DSF client issuer.
  cp "$ROOT/certs/client-ca.crt" "$WORK/nginx-certs/client-ca.crt"
  chmod 644 ./*.crt ./*.key "$WORK"/nginx-certs/*
  cd "$ROOT"
}

fp() { openssl x509 -in "$2" -outform DER | openssl dgst "-$1" -hex | awk '{print $NF}'; }

# ---------------------------------------------------------------- portal side
portal_js() { # portal_js <async js body using db>
  "${DEV[@]}" exec -T -e JS="$1" backend node -r ts-node/register/transpile-only -e '
const { db } = require("./src/db/connection");
new Function("db", "return (async () => {" + process.env.JS + "})()")(db)
  .then((out) => { if (out !== undefined) console.log(out); return db.destroy(); })
  .catch((e) => { console.error(e.message); process.exit(1); });'
}

seed_portal() {
  log "Seeding the receiver and two peers into the dev portal (production hackathon seed)"
  RECEIVER_PEM="$CERTS/org-client.crt" PEER1_PEM="$CERTS/$PEER1.crt" PEER2_PEM="$CERTS/$PEER2.crt" \
  FP_R512="$(fp sha512 "$CERTS/org-client.crt")" FP_R256="$(fp sha256 "$CERTS/org-client.crt")" \
  FP_P1512="$(fp sha512 "$CERTS/$PEER1.crt")" FP_P1256="$(fp sha256 "$CERTS/$PEER1.crt")" \
  FP_P2512="$(fp sha512 "$CERTS/$PEER2.crt")" FP_P2256="$(fp sha256 "$CERTS/$PEER2.crt")" \
  node -e '
const fs = require("fs");
const e = process.env;
const user = (org, name, pem, f512, f256) => ({
  email: `dsf-admin@${org}`, name, orgIdentifier: org, orgName: name, city: "Muenster",
  countryCode: "DE", fingerprintSha512: f512, thumbprintSha256: f256,
  certPem: fs.readFileSync(pem, "utf8"), admin: false,
});
process.stdout.write(JSON.stringify({ parentOrganization: process.argv[1], users: [
  user(process.argv[2], "Klinik E2E", e.RECEIVER_PEM, e.FP_R512, e.FP_R256),
  user(process.argv[3], "Peer Eins", e.PEER1_PEM, e.FP_P1512, e.FP_P1256),
  user(process.argv[4], "Peer Zwei", e.PEER2_PEM, e.FP_P2512, e.FP_P2256),
]}));' "$HUB" "$RECEIVER" "$PEER1" "$PEER2" > "$WORK/manifest.json"
  "${DEV[@]}" exec -T backend node -r ts-node/register/transpile-only \
    src/db/seed-hackathon.ts - < "$WORK/manifest.json" | grep -E '\[\+\]|\[!\]|Done' || true
  portal_js "
    const ids = (await db('organizations').whereIn('identifier', ['$RECEIVER', '$PEER1', '$PEER2'])
      .select('instance_id')).map((o) => o.instance_id);
    const n = await db('approval_requests').whereIn('instance_id', ids)
      .update({ status: 'APPROVED', resolved_at: new Date() });
    return 'approved requests: ' + n;"
}

unseed_portal() {
  portal_js "
    const orgs = ['$RECEIVER', '$PEER1', '$PEER2'];
    const emails = orgs.map((o) => 'dsf-admin@' + o);
    const inst = (await db('organizations').whereIn('identifier', orgs).select('instance_id'))
      .map((o) => o.instance_id);
    await db('instances').whereIn('id', inst).del();
    await db('users').whereIn('email', emails).del();
    await db('email_whitelist').whereIn('email', emails).del();
    return 'portal sites removed';" || true
}

# ------------------------------------------------------------------- DSF side
fhir() { # curl against the receiving DSF FHIR server, as the local organization
  "${COMPOSE[@]}" exec -T bpe-app curl -sS --cert /certs/org-client.crt --key /certs/org-client.key \
    --cacert /certs/root-ca.crt -H 'Accept: application/fhir+json' "$@"
}

total() { fhir "$FHIR/$1" | jsonq 'j.total ?? 0'; }

start_dsf() {
  log "Starting DSF FHIR, fhir_proxy, BPE and the portal fronts"
  mkdir -p "$WORK/process"
  if [ ! -f "$WORK/process/$PLUGIN" ]; then
    curl -sSL -o "$WORK/process/$PLUGIN" "$PLUGIN_URL"
  fi
  [ "$(sha256sum "$WORK/process/$PLUGIN" | awk '{print $1}')" = "$PLUGIN_SHA256" ] \
    || { echo "plugin checksum mismatch" >&2; exit 1; }
  "${COMPOSE[@]}" up -d --quiet-pull
  printf '   waiting for the BPE to deploy downloadAllowList '
  for _ in $(seq 1 90); do
    if [ "$(total 'ActivityDefinition?url=http://dsf.dev/bpe/Process/downloadAllowList&status=active' 2>/dev/null)" = "1" ]; then
      echo " ready"
      return 0
    fi
    printf '.'
    sleep 5
  done
  echo " timeout"
  "${COMPOSE[@]}" logs --tail 60 bpe-app fhir-app
  exit 1
}

download() { # download <bundle url> -> prints the final Task status
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local task
  task=$(cat <<EOF
{"resourceType":"Task",
 "meta":{"profile":["http://dsf.dev/fhir/StructureDefinition/task-download-allow-list|1.0"]},
 "instantiatesCanonical":"http://dsf.dev/bpe/Process/downloadAllowList|1.0",
 "status":"requested","intent":"order","authoredOn":"$now",
 "requester":{"type":"Organization","identifier":{"system":"$ORG_SID","value":"$RECEIVER"}},
 "restriction":{"recipient":[{"type":"Organization","identifier":{"system":"$ORG_SID","value":"$RECEIVER"}}]},
 "input":[
  {"type":{"coding":[{"system":"http://dsf.dev/fhir/CodeSystem/bpmn-message","code":"message-name"}]},
   "valueString":"downloadAllowListMessage"},
  {"type":{"coding":[{"system":"http://dsf.dev/fhir/CodeSystem/allow-list","code":"allow_list"}]},
   "valueReference":{"reference":"$1"}}]}
EOF
)
  local id
  id=$(printf '%s' "$task" | fhir -X POST -H 'Content-Type: application/fhir+json' \
    --data-binary @- "$FHIR/Task" | jsonq 'j.id || ("POST failed: " + JSON.stringify(j.issue || j))')
  case "$id" in "POST failed"*) echo "$id" >&2; echo "post-failed"; return ;; esac
  local status=requested
  for _ in $(seq 1 60); do
    status=$(fhir "$FHIR/Task/$id" | jsonq 'j.status')
    case "$status" in completed|failed) break ;; esac
    sleep 3
  done
  if [ "$status" != completed ]; then
    fhir "$FHIR/Task/$id" | jsonq '(j.output || []).map((o) => o.valueString).join(" | ")' >&2
  fi
  echo "$status"
}

scenario() { # scenario <name> <bundle url> <expected status>
  log "Scenario $1: DownloadAllowList from $2"
  local got
  got=$(download "$2")
  check "Task status" "$got" "$3"
  SUMMARY+=("$1: $got (expected $3)")
}

verify_peers() { # verify_peers <expected affiliation count for PEER2>
  for peer in "$PEER1" "$PEER2"; do
    local org
    org=$(fhir "$FHIR/Organization?identifier=$ORG_SID%7C$peer")
    check "$peer applied once" "$(printf '%s' "$org" | jsonq 'j.total')" 1
    check "$peer SHA-512 thumbprint" \
      "$(printf '%s' "$org" | jsonq 'j.entry[0].resource.extension.map((x) => x.valueString).join(",")')" \
      "$(fp sha512 "$CERTS/$peer.crt")"
    check "$peer endpoint" "$(total "Endpoint?identifier=$EP_SID%7Cfhir.$peer")" 1
  done
  local oa="OrganizationAffiliation?primary-organization:identifier=$ORG_SID%7C$HUB"
  check "$PEER1 affiliation (DIC+HRP)" \
    "$(fhir "$FHIR/$oa&participating-organization:identifier=$ORG_SID%7C$PEER1" \
      | jsonq '(j.entry || []).map((e) => e.resource.code.map((c) => c.coding[0].code).join("+")).join(",")')" \
    "DIC+HRP"
  check "$PEER2 affiliations" \
    "$(total "$oa&participating-organization:identifier=$ORG_SID%7C$PEER2")" "$1"
  check "own affiliation via conditional references" \
    "$(total "$oa&participating-organization:identifier=$ORG_SID%7C$RECEIVER&endpoint:identifier=$EP_SID%7C$RECEIVER_EP")" 1
}

cleanup() {
  if [ "$KEEP" = 1 ]; then
    log "--keep: leaving the DSF stack and the portal sites in place"
    return
  fi
  log "Cleaning up"
  "${COMPOSE[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
  unseed_portal
}

# ----------------------------------------------------------------------- main
"${DEV[@]}" exec -T backend true 2>/dev/null \
  || { echo "The dev stack is not running (docker compose up -d)." >&2; exit 1; }
trap cleanup EXIT

gen_certs
seed_portal
start_dsf

scenario apache "https://allowlist.portal-e2e.example.de/fhir/Bundle/$RECEIVER_EP" completed
verify_peers 1

scenario apache-again "https://allowlist.portal-e2e.example.de/fhir/Bundle/$RECEIVER_EP" completed
verify_peers 1

portal_js "await db('memberships').where({ organization_id: '$PEER2' }).update({ deleted_at: new Date() });"
scenario leave-hub "https://allowlist.portal-e2e.example.de/fhir/Bundle/$RECEIVER_EP" completed
verify_peers 0

scenario nginx "https://allowlist-nginx.portal-e2e.example.de/fhir/Bundle/$RECEIVER_EP" completed
scenario untrusted "https://untrusted.portal-e2e.example.de/fhir/Bundle/$RECEIVER_EP" failed

log "Summary"
printf '   %s\n' "${SUMMARY[@]}"
if [ "$FAILURES" -gt 0 ]; then
  echo "   $FAILURES check(s) failed"
  exit 1
fi
echo "   all checks passed"
