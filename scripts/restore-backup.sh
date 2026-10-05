#!/usr/bin/env bash
# restore-backup.sh - Restore a DSF Allow List application backup (JSON) on the server.
# Thin wrapper around backend/src/scripts/restore-backup.ts inside the backend container.
#
# Usage: scripts/restore-backup.sh <backup-file> [--dry-run] [--yes]
#   <backup-file>  a file name inside the backend's backup directory (/backups), or a
#                  path on this host (it is copied into the container's /tmp first)
#   --dry-run      verify the file and compare it with the database, change nothing
#   --yes          required to actually overwrite the database
#
# Environment:
#   DSF_ROOT     deployed tree, default /opt/dsf-allowlist
#   DSF_COMPOSE  docker compose command prefix, same default as update-server.sh
#   BACKUP_ENCRYPTION_KEY must be set in the backend's environment for .enc files
#
# Restoring replaces ALL application data with the backup and invalidates every
# session. Read docs/DEPLOYMENT.md, "Backup und Wiederherstellung", first.
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ "${FILE#--}" != "$FILE" ]; then
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
shift

DSF_ROOT="${DSF_ROOT:-/opt/dsf-allowlist}"
DSF_COMPOSE="${DSF_COMPOSE:-docker compose --env-file ${DSF_ROOT}/.env.prod -f ${DSF_ROOT}/docker-compose.cert-auth.yml -f ${DSF_ROOT}/docker-compose.apache.yml}"

# shellcheck disable=SC2086
if [ -f "$FILE" ]; then
  TARGET="/tmp/restore-$(basename "$FILE")"
  $DSF_COMPOSE cp "$FILE" "backend:${TARGET}"
else
  TARGET="/backups/${FILE}"
fi

# The production image ships compiled JavaScript, the dev image runs ts-node.
# shellcheck disable=SC2086
if $DSF_COMPOSE exec -T backend test -f dist/scripts/restore-backup.js; then
  $DSF_COMPOSE exec -T backend node dist/scripts/restore-backup.js "$TARGET" "$@"
else
  $DSF_COMPOSE exec -T backend npx ts-node src/scripts/restore-backup.ts "$TARGET" "$@"
fi
