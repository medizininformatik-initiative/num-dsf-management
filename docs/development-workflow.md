# Development workflow

Trunk-based: `main` is protected and always deployable. There is no long-lived
dev branch.

## Branches

Short-lived branches off `main`, named `feat/*`, `fix/*`, `docs/*` or `chore/*`
(optionally with the issue number, e.g. `fix/123-totp-redirect`). Open a pull
request early, keep it small, delete the branch after merge (done automatically).

## Commits and pull requests

- Fine-grained commits in Conventional Commits form (`feat(auth): ...`,
  lower-case subject). `commitlint` runs in the pre-commit/commit-msg hook.
- The **PR title** must also be a Conventional Commit; the `PR Title` check
  enforces it. With squash-merge it becomes the commit on `main` and the
  release-please changelog entry.
- Merge with **rebase** (keeps the fine-grained commits) or **squash**.
  Merge commits are disabled; `main` has linear history.
- Link the issue in the PR description (`Closes #123`).

## Review and required checks

One approval, including a CODEOWNERS review (`.github/CODEOWNERS`), stale
approvals are dismissed on new pushes. The branch must be up to date and these
checks must pass:

`Security Audit`, `Backend Lint`, `Backend Tests`, `Frontend Lint`,
`Frontend Tests`, `frontend-e2e`, `frontend-contract`, `frontend-bundle`,
`Format Check`, `Secret Scan`, `Docker Image (build + downloadable bundle)`,
`PR Title`.

Informational (not required): `CodeQL`, `Dependency Review`. Repository admins
can bypass the ruleset through a pull request (needed for release PRs, see below).

## Labels and triage

Defined in `.github/labels.tsv`: type (`bug`, `feature`, `security`, `docs`,
`ops`, `dependencies`, `refactor`, `test`), priority (`p1`-`p3`), status
(`needs-triage`, `blocked`) and area (`backend`, `frontend`, `allow-list`,
`auth`, `incidents`, `marketplace`, `infra`). Issue templates apply `needs-triage`
plus a type; triage replaces `needs-triage` with a priority and an area.
Security problems are reported privately, see `SECURITY.md`.

## Release flow

1. Merged commits on `main` feed release-please, which keeps a release PR open
   (version bump + `CHANGELOG.md`).
2. Merging the release PR creates the tag `vX.Y.Z` and a GitHub release.
3. `release.yml` builds and publishes the Docker images for that tag.
4. Deploy the tag to production (below).

Pull requests opened by `GITHUB_TOKEN` do not trigger workflows, so for the
release PR close and reopen it (or push an empty commit) to get the required
checks, then merge as admin.

## Deployment

The production server is not reachable from the internet, so there is no
push-based deploy. Update by **pulling on the server** after a release: run
`scripts/update-server.sh <unpacked-release-tree>` by hand (see
`docs/DEPLOYMENT.md`), or have a systemd timer on the server fetch the latest
release tag and run it. A self-hosted runner is deliberately not used: on a
public repository a pull request from a fork can run arbitrary code on that
runner, which would sit inside the institute network. The `production`
environment (required reviewer, tags `v*` only) is there for any future
deploy job.

## One-time setup after the repository is made public

Rulesets, environment protection, secret scanning and CodeQL need a public repo
(or GitHub Pro). As repo admin with `gh` authenticated:

```bash
bash scripts/setup-github.sh --dry-run   # review
bash scripts/setup-github.sh             # apply; safe to re-run
```

It sets merge options, labels, the `main` and `v*` tag rulesets, the
`production` environment, private vulnerability reporting, Dependabot security
updates, and secret scanning with push protection. Steps the plan does not
support print `skipped`.
