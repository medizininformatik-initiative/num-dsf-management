#!/usr/bin/env bash
# update-server.sh - Apply a freshly unpacked source tree (the GitHub zip of
# main) to this server's zip-based, cert-auth + Apache DSF Allow List
# deployment: preserves server-local files (.env.prod, docker-compose.apache.yml,
# hackathon/, certs/, .migrations-applied), copies the new tree in with rsync,
# applies any new db/migrations/*.sql by hand (MySQL only auto-runs them on an
# empty volume), then rebuilds and restarts backend+frontend and waits for the
# backend to report healthy. See docs/DEPLOYMENT.md, "Update Process" >
# "Updating a zip-based deployment (no git on the server)".
#
# Usage: scripts/update-server.sh <NEW_TREE> [--dry-run]
# Run --help for the full usage, environment overrides and step list.
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} <NEW_TREE> [--dry-run]

  NEW_TREE    Path to the unpacked new source tree, e.g.
              /tmp/dsf-new/num-dsf-allowlist-main
  --dry-run   Preview only: does not copy anything, does not touch the
              database, does not rebuild or restart containers. Runs steps
              1-4 in preview mode; steps 5-6 are skipped and reported as such.

Environment overrides:
  DSF_ROOT     Root of the deployed tree on this server.
               Default: /opt/dsf-allowlist
  DSF_COMPOSE  docker compose command prefix used to manage the stack.
               Default (built from \$DSF_ROOT):
                 docker compose --env-file \$DSF_ROOT/.env.prod \\
                   -f \$DSF_ROOT/docker-compose.cert-auth.yml \\
                   -f \$DSF_ROOT/docker-compose.apache.yml

What this script does, in order:
  1. Preflight checks (NEW_TREE looks right, \$DSF_ROOT/.env.prod exists,
     rsync/docker present, the stack's db service is running).
  2. Infers \$DSF_ROOT/.migrations-applied from the current migrations
     directory if it does not exist yet (one-time baseline, recorded on a
     real run; a --dry-run never writes it).
  3. Copies NEW_TREE over \$DSF_ROOT with 'rsync -a' (no --delete at the top
     level), preserving .env.prod, .env, docker-compose.apache.yml, hackathon/,
     .migrations-applied, certs/, node_modules/ and .git/. The pure source
     directories backend/src and frontend/src are then mirrored exactly
     (--delete), so files removed in the repository cannot break the build.
  4. Applies any db/migrations/*.sql not yet recorded in
     .migrations-applied, in filename order, stopping at the first failure.
  5. Rebuilds and restarts the backend and frontend containers.
  6. Waits (up to ~90s) for the backend to report healthy.

Re-running with the same tree is safe: unchanged files are left alone by
rsync and already-applied migrations are skipped (the rebuild/restart in
step 5 always runs again).

Examples:
  ${SCRIPT_NAME} /tmp/dsf-new/num-dsf-allowlist-main --dry-run
  ${SCRIPT_NAME} /tmp/dsf-new/num-dsf-allowlist-main
EOF
}

log() { echo "[update-server] $*"; }
err() { echo "[update-server] ERROR: $*" >&2; }
step() { echo; echo "[update-server] Step $1/6: $2"; }

# --- Argument parsing --------------------------------------------------
NEW_TREE=""
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -*)
      err "unknown option: $1"
      usage >&2
      exit 1
      ;;
    *)
      if [ -z "$NEW_TREE" ]; then
        NEW_TREE="$1"
      else
        err "unexpected extra argument: $1"
        exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$NEW_TREE" ]; then
  err "NEW_TREE is required"
  usage >&2
  exit 1
fi
NEW_TREE="${NEW_TREE%/}"

DSF_ROOT="${DSF_ROOT:-/opt/dsf-allowlist}"
# shellcheck disable=SC2034  # DSF_COMPOSE is intentionally split on word boundaries below
DSF_COMPOSE="${DSF_COMPOSE:-docker compose --env-file ${DSF_ROOT}/.env.prod -f ${DSF_ROOT}/docker-compose.cert-auth.yml -f ${DSF_ROOT}/docker-compose.apache.yml}"

is_applied() {
  local name="$1" a
  for a in "${APPLIED[@]}"; do
    [ "$a" = "$name" ] && return 0
  done
  return 1
}

# --- Step 1: Preflight ---------------------------------------------------
step 1 "Preflight checks"

[ -d "$NEW_TREE" ] || { err "NEW_TREE '$NEW_TREE' is not a directory"; exit 1; }

for marker in docker-compose.cert-auth.yml backend/Dockerfile frontend/Dockerfile db/migrations; do
  [ -e "$NEW_TREE/$marker" ] || { err "NEW_TREE is missing '$marker' - is this the unpacked repo root?"; exit 1; }
done

[ -f "$DSF_ROOT/.env.prod" ] || { err "$DSF_ROOT/.env.prod not found - the server environment file must already exist"; exit 1; }

command -v rsync >/dev/null 2>&1 || { err "rsync is required on this server"; exit 1; }
command -v docker >/dev/null 2>&1 || { err "docker is required on this server"; exit 1; }

# shellcheck disable=SC2086
if ! $DSF_COMPOSE ps --status running --services 2>/dev/null | grep -qx db; then
  err "the 'db' service is not running under: $DSF_COMPOSE"
  err "start the stack first, then re-run this script"
  exit 1
fi

log "Preflight checks passed"

# --- Step 2: Migration bookkeeping ---------------------------------------
step 2 "Migration bookkeeping"

MIGRATIONS_APPLIED_FILE="$DSF_ROOT/.migrations-applied"
APPLIED=()

if [ -f "$MIGRATIONS_APPLIED_FILE" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && APPLIED+=("$line")
  done < "$MIGRATIONS_APPLIED_FILE"
  log "Using existing $MIGRATIONS_APPLIED_FILE (${#APPLIED[@]} migration(s) recorded)"
else
  for f in "$DSF_ROOT/db/migrations"/*.sql; do
    [ -e "$f" ] || continue
    APPLIED+=("$(basename "$f")")
  done
  log "WARNING: $MIGRATIONS_APPLIED_FILE not found - inferring baseline from the ${#APPLIED[@]} migration(s) already in $DSF_ROOT/db/migrations"
  if [ "$DRY_RUN" = true ]; then
    log "dry-run: not writing $MIGRATIONS_APPLIED_FILE (a real run will create it)"
  else
    : > "$MIGRATIONS_APPLIED_FILE"
    for m in "${APPLIED[@]}"; do
      echo "$m" >> "$MIGRATIONS_APPLIED_FILE"
    done
    log "Wrote baseline to $MIGRATIONS_APPLIED_FILE"
  fi
fi

# --- Step 3: Copy ---------------------------------------------------------
step 3 "Copy $NEW_TREE into $DSF_ROOT"

# Patterns with a leading / are anchored to the tree root. Without it rsync
# matches the name at EVERY depth: a bare "hackathon/" also dropped
# backend/src/db/hackathon/ and broke the backend build (2026-09-10).
RSYNC_EXCLUDES=(
  --exclude /.env.prod
  --exclude /.env
  --exclude /docker-compose.apache.yml
  --exclude /hackathon/
  --exclude /.migrations-applied
  --exclude /certs/
  --exclude node_modules/
  --exclude .git/
)

# Pure source directories: nothing server-local lives here, and a file removed
# in the repository must disappear on the server too, or tsc still compiles it
# (2026-10-06: removed pages broke the frontend build).
MIRROR_DIRS=(backend/src frontend/src)

if [ "$DRY_RUN" = true ]; then
  log "dry-run: previewing changes rsync would make (nothing is copied or deleted)"
  RSYNC_OUT="$(rsync -a -n --itemize-changes "${RSYNC_EXCLUDES[@]}" "$NEW_TREE/" "$DSF_ROOT/")"
  CHANGES=()
  if [ -n "$RSYNC_OUT" ]; then
    while IFS= read -r line; do
      CHANGES+=("$line")
    done <<< "$RSYNC_OUT"
  fi
  for d in "${MIRROR_DIRS[@]}"; do
    while IFS= read -r line; do
      case "$line" in *deleting*) CHANGES+=("$d/: $line") ;; esac
    done < <(rsync -a -n --delete --itemize-changes "$NEW_TREE/$d/" "$DSF_ROOT/$d/")
  done
  if [ "${#CHANGES[@]}" -eq 0 ]; then
    log "No files would change"
  else
    log "${#CHANGES[@]} file(s)/dir(s) would be created or updated:"
    printf '  %s\n' "${CHANGES[@]:0:20}"
    if [ "${#CHANGES[@]}" -gt 20 ]; then
      log "  ... and $((${#CHANGES[@]} - 20)) more"
    fi
  fi
else
  rsync -a "${RSYNC_EXCLUDES[@]}" "$NEW_TREE/" "$DSF_ROOT/"
  for d in "${MIRROR_DIRS[@]}"; do
    rsync -a --delete "$NEW_TREE/$d/" "$DSF_ROOT/$d/"
  done
  # Guard against exclude patterns that silently match nested paths (see the
  # note above RSYNC_EXCLUDES): every source directory must exist in the target.
  while IFS= read -r d; do
    if [ ! -d "$DSF_ROOT/$d" ]; then
      echo "ERROR: copy incomplete, $DSF_ROOT/$d is missing (check RSYNC_EXCLUDES)" >&2
      exit 1
    fi
  done < <(cd "$NEW_TREE" && find backend/src frontend/src db scripts -type d 2>/dev/null)
  log "Copy complete"
fi

# --- Step 4: Apply pending migrations -------------------------------------
step 4 "Apply pending database migrations"

PENDING=()
for f in "$NEW_TREE/db/migrations"/*.sql; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  is_applied "$name" || PENDING+=("$name")
done

if [ "${#PENDING[@]}" -eq 0 ]; then
  log "No pending migrations"
elif [ "$DRY_RUN" = true ]; then
  log "${#PENDING[@]} pending migration(s) (dry-run, not applied):"
  printf '  - %s\n' "${PENDING[@]}"
else
  DB_ROOT_PASSWORD="$(grep -E '^DB_ROOT_PASSWORD=' "$DSF_ROOT/.env.prod" | tail -1 | cut -d= -f2- | tr -d '\r')"
  DB_NAME="$(grep -E '^DB_NAME=' "$DSF_ROOT/.env.prod" | tail -1 | cut -d= -f2- | tr -d '\r')"
  [ -n "$DB_ROOT_PASSWORD" ] || { err "DB_ROOT_PASSWORD not set in $DSF_ROOT/.env.prod"; exit 1; }
  [ -n "$DB_NAME" ] || { err "DB_NAME not set in $DSF_ROOT/.env.prod"; exit 1; }

  log "${#PENDING[@]} pending migration(s) to apply"
  for name in "${PENDING[@]}"; do
    file="$NEW_TREE/db/migrations/$name"
    log "Applying $name (mysql -u root -p**** ${DB_NAME}) ..."
    # shellcheck disable=SC2086
    if ! $DSF_COMPOSE exec -T -e MYSQL_PWD="$DB_ROOT_PASSWORD" db mysql -u root "$DB_NAME" < "$file"; then
      err "migration $name FAILED - later migrations were NOT applied"
      exit 1
    fi
    echo "$name" >> "$MIGRATIONS_APPLIED_FILE"
    log "Applied $name"
  done
fi

if [ "$DRY_RUN" = true ]; then
  step 5 "Rebuild and roll (skipped - dry-run)"
  step 6 "Wait for health (skipped - dry-run)"
  echo
  log "Dry run complete. Nothing on $DSF_ROOT or the running stack was changed."
  exit 0
fi

# --- Step 5: Rebuild and roll ---------------------------------------------
step 5 "Rebuild and roll"

# shellcheck disable=SC2086
$DSF_COMPOSE build backend frontend
# shellcheck disable=SC2086
$DSF_COMPOSE up -d --no-deps backend frontend

# --- Step 6: Wait for health -----------------------------------------------
step 6 "Wait for backend health"

MAX_WAIT=90
INTERVAL=5
ELAPSED=0
HEALTH_JSON=""

while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  # shellcheck disable=SC2086
  if HEALTH_JSON="$($DSF_COMPOSE exec -T backend wget -qO- http://localhost:3000/health/ready 2>/dev/null)"; then
    [ -n "$HEALTH_JSON" ] && break
  fi
  HEALTH_JSON=""
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ -n "$HEALTH_JSON" ]; then
  log "Backend is healthy:"
  echo "$HEALTH_JSON"
else
  err "backend did not report healthy within ${MAX_WAIT}s"
fi

log "Current stack status:"
# shellcheck disable=SC2086
$DSF_COMPOSE ps

if [ -z "$HEALTH_JSON" ]; then
  exit 1
fi

log "Update complete"
