#!/usr/bin/env bash
# admin-cert.sh - Last-resort recovery of admin certificate access on the server.
# Thin wrapper around backend/src/scripts/admin-cert.ts inside the backend container.
#
# Usage:
#   scripts/admin-cert.sh add <email> <cert.pem> [--label X]
#   scripts/admin-cert.sh list [email]
#   scripts/admin-cert.sh remove <fingerprint-prefix> --yes
#   scripts/admin-cert.sh totp-reset <email> --yes
#
#   add     registers a PUBLIC certificate (PEM) for an e-mail that already has a
#           verified admin grant; <cert.pem> is a path on this host (copied into
#           the container first). Granting admin rights stays a four-eyes process.
#   list    shows admin certificates with their expiry
#   remove  deletes one admin certificate by (a prefix of) its SHA-512 fingerprint
#   totp-reset  clears the TOTP of an admin who lost phone and TAN list; they set it up
#           again at the next certificate login
#
# Environment:
#   DSF_ROOT     deployed tree, default /opt/dsf-allowlist
#   DSF_COMPOSE  docker compose command prefix, same default as update-server.sh
#
# Use it only when no colleague can register a certificate in the portal; read
# docs/DEPLOYMENT.md, "Admin-Zertifikat abgelaufen oder verloren", first.
set -euo pipefail

CMD="${1:-}"
if [ -z "$CMD" ] || [ "${CMD#--}" != "$CMD" ]; then
  sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
shift

DSF_ROOT="${DSF_ROOT:-/opt/dsf-allowlist}"
DSF_COMPOSE="${DSF_COMPOSE:-docker compose --env-file ${DSF_ROOT}/.env.prod -f ${DSF_ROOT}/docker-compose.cert-auth.yml -f ${DSF_ROOT}/docker-compose.apache.yml}"

ARGS=("$@")
TARGET=""
if [ "$CMD" = "add" ] && [ "${#ARGS[@]}" -ge 2 ] && [ -f "${ARGS[1]}" ]; then
  TARGET="/tmp/admin-cert-$$.pem"
  # shellcheck disable=SC2086
  $DSF_COMPOSE cp "${ARGS[1]}" "backend:${TARGET}"
  ARGS[1]="$TARGET"
fi

run() {
  # The production image ships compiled JavaScript, the dev image runs ts-node.
  # shellcheck disable=SC2086
  if $DSF_COMPOSE exec -T backend test -f dist/scripts/admin-cert.js; then
    $DSF_COMPOSE exec -T backend node dist/scripts/admin-cert.js "$CMD" ${ARGS[@]+"${ARGS[@]}"}
  else
    $DSF_COMPOSE exec -T backend npx ts-node src/scripts/admin-cert.ts "$CMD" ${ARGS[@]+"${ARGS[@]}"}
  fi
}

STATUS=0
run || STATUS=$?
if [ -n "$TARGET" ]; then
  # shellcheck disable=SC2086
  $DSF_COMPOSE exec -T backend rm -f "$TARGET" || true
fi
exit "$STATUS"
