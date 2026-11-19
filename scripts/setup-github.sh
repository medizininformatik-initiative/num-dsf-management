#!/usr/bin/env bash
# setup-github.sh - Apply the repository settings, labels, rulesets, the
# production environment and the security features described in
# docs/development-workflow.md. Idempotent: safe to re-run.
#
# Usage: scripts/setup-github.sh [--dry-run] [owner/repo]
#   --dry-run   print every change instead of applying it
#   owner/repo  defaults to the repository of the current checkout
#
# Requires: gh (authenticated with repo admin rights). Labels are read from
# .github/labels.tsv. Features that need a public repo or GitHub Pro
# (rulesets, environment protection, secret scanning, ...) print
# "skipped (needs public repo or GitHub Pro)" instead of aborting.
set -uo pipefail

DRY=0
REPO=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) REPO="$a" ;;
  esac
done

cd "$(dirname "$0")/.."
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
OWNER="${REPO%%/*}"
DEFAULT_BRANCH="main"

# Required status checks: job names from .github/workflows/*.yml.
CHECKS=(
  "Security Audit" "Backend Lint" "Backend Tests" "Frontend Lint" "Frontend Tests"
  "frontend-e2e" "frontend-contract" "frontend-bundle" "Format Check" "Secret Scan"
  "Docker Image (build + downloadable bundle)" "PR Title"
)

say() { printf '%s\n' "$*"; }

# api_try <label> <method> <path> [json-body]
# Runs one gh api call; 403/404/422 from plan limits is reported as skipped.
api_try() {
  local label="$1" method="$2" path="$3" body="${4:-}" out rc
  if [ "$DRY" = 1 ]; then
    say "[dry-run] $label: $method $path"
    [ -n "$body" ] && printf '%s\n' "$body" | sed 's/^/    /'
    return 0
  fi
  if [ -n "$body" ]; then
    out=$(printf '%s' "$body" | gh api -X "$method" "$path" --input - 2>&1); rc=$?
  else
    out=$(gh api -X "$method" "$path" 2>&1); rc=$?
  fi
  if [ $rc -eq 0 ]; then
    say "ok       $label"
  elif printf '%s' "$out" | grep -qE 'HTTP (403|404|422)|Upgrade to|not available|must be enabled'; then
    say "skipped  $label (needs public repo or GitHub Pro)"
  else
    say "FAILED   $label: $(printf '%s' "$out" | head -2 | tr '\n' ' ')"
  fi
}

# ---- repository settings ------------------------------------------------
api_try "repo settings" PATCH "repos/$REPO" '{
  "delete_branch_on_merge": true,
  "allow_merge_commit": false,
  "allow_squash_merge": true,
  "allow_rebase_merge": true,
  "allow_auto_merge": true,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "PR_BODY"
}'

# ---- labels ---------------------------------------------------------------
existing=""
[ "$DRY" = 0 ] && existing=$(gh label list -R "$REPO" -L 200 --json name -q '.[].name')
while IFS=$'\t' read -r name color desc; do
  case "$name" in ''|'#'*) continue ;; esac
  if [ "$DRY" = 1 ]; then
    say "[dry-run] label: $name #$color"
  elif printf '%s\n' "$existing" | grep -Fxq "$name"; then
    gh label edit "$name" -R "$REPO" --color "$color" --description "$desc" >/dev/null && say "ok       label updated: $name"
  else
    gh label create "$name" -R "$REPO" --color "$color" --description "$desc" >/dev/null && say "ok       label created: $name"
  fi
done < .github/labels.tsv

# ---- rulesets -------------------------------------------------------------
checks_json=""
for c in "${CHECKS[@]}"; do
  checks_json="$checks_json{\"context\":\"$c\"},"
done
checks_json="[${checks_json%,}]"

# upsert_ruleset <name> <json>: update by name if it exists, else create.
upsert_ruleset() {
  local name="$1" body="$2" id=""
  if [ "$DRY" = 0 ]; then
    id=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id" 2>/dev/null | grep -E "^[0-9]+$" | head -1)
  fi
  if [ -n "$id" ]; then
    api_try "ruleset $name (update)" PUT "repos/$REPO/rulesets/$id" "$body"
  else
    api_try "ruleset $name (create)" POST "repos/$REPO/rulesets" "$body"
  fi
}

# actor_id 5 = the built-in "Admin" repository role; 15368 = the GitHub Actions
# app (release-please creates the vX.Y.Z tag with GITHUB_TOKEN).
upsert_ruleset "main protection" '{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["refs/heads/'"$DEFAULT_BRANCH"'"], "exclude": []}},
  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request"}],
  "rules": [
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 1,
      "dismiss_stale_reviews_on_push": true,
      "require_code_owner_review": true,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false}},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": true,
      "required_status_checks": '"$checks_json"'}},
    {"type": "required_linear_history"},
    {"type": "non_fast_forward"},
    {"type": "deletion"}
  ]
}'

upsert_ruleset "release tags" '{
  "name": "release tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["refs/tags/v*"], "exclude": []}},
  "bypass_actors": [
    {"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"},
    {"actor_id": 15368, "actor_type": "Integration", "bypass_mode": "always"}
  ],
  "rules": [{"type": "creation"}, {"type": "update"}, {"type": "deletion"}]
}'

# ---- production environment ----------------------------------------------
# Reviewer of production deployments: REVIEWER=<login>, else the signed-in user
# (the repository owner may be an organization, which cannot review).
owner_id=""
[ "$DRY" = 0 ] && owner_id=$(gh api "users/${REVIEWER:-$(gh api user --jq .login)}" --jq .id 2>/dev/null)
api_try "environment production" PUT "repos/$REPO/environments/production" '{
  "reviewers": [{"type": "User", "id": '"${owner_id:-0}"'}],
  "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}
}'
if [ "$DRY" = 1 ] || gh api "repos/$REPO/environments/production" >/dev/null 2>&1; then
  api_try "environment production: allow tags v*" POST \
    "repos/$REPO/environments/production/deployment-branch-policies" '{"name": "v*", "type": "tag"}'
fi

# ---- security features ----------------------------------------------------
api_try "private vulnerability reporting" PUT "repos/$REPO/private-vulnerability-reporting"
api_try "dependabot alerts" PUT "repos/$REPO/vulnerability-alerts"
api_try "dependabot security updates" PUT "repos/$REPO/automated-security-fixes"
api_try "secret scanning + push protection" PATCH "repos/$REPO" '{
  "security_and_analysis": {
    "secret_scanning": {"status": "enabled"},
    "secret_scanning_push_protection": {"status": "enabled"}
  }
}'

say "done${DRY:+ }$([ "$DRY" = 1 ] && echo '(dry run, nothing changed)')"
