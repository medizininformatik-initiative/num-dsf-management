# Site automation

Sites can renew their login certificate without clicking through the portal, for example from a cron job. This page lists the endpoints that are stable for scripting. Approval stays manual: two IMI admins still approve every change.

## Prerequisites

- A certificate registered for login (`useForLogin`, approved). It is your only credential.
- Its private key, available to the script (used only for the TLS handshake, never sent to the API).
- Network access to the portal. The reverse proxy applies an IP allow list; your script must run from an allowed address.
- `curl`, `jq` and `openssl`, or the ready-made script `scripts/site-cert-renew.sh`.

## Authentication

Production runs behind mTLS. Present the client certificate on every request, not only on login.

```sh
BASE=https://dsf-management.example.org
C="--cert site.pem --key site.key"

TOKEN=$(curl -sS $C -X POST "$BASE/auth/client-cert-login" | jq -r .data.accessToken)
curl -sS $C -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/instances"
```

The access token lives 15 minutes and is bound to the certificate: a token used without the same certificate is refused.

## Endpoints

All responses have the form `{ "data": ... }`; errors `{ "error": { "code", "message" } }`.

| Call | Request | Response essentials |
|------|---------|---------------------|
| `POST /auth/client-cert-login` | none | `data.accessToken` |
| `GET /api/v1/instances` | none | `data[]` with `id` (a site login sees only its own instance) |
| `GET /api/v1/instances/:id/certificates` | none | `data[]` with `id`, `subject`, `thumbprint` (SHA-256), `thumbprintSha512`, `valid_until`, `publishInAllowlist`, `useForLogin` (no PEM) |
| `POST /api/v1/instances/:id/certificates` | `{ "pem": "<certificate PEM>" }` | the new certificate row (fields as above) |
| `POST /api/v1/instances/:id/certificates/:cid/renew` | `{ "pem": "<new certificate PEM>" }` | the new certificate row; the old row is replaced and the new one inherits its `publishInAllowlist` and `useForLogin` flags |
| `PATCH /api/v1/instances/:id/certificates/:cid/purpose` | `{ "publishInAllowlist"?: bool, "useForLogin"?: bool }` | the updated row |
| `POST /api/v1/instances/:id/approval/submit` | none | `data.id`, `data.status` (`PENDING`) |
| `GET /api/v1/instances/:id/approval/status` | none | `data.status` (`PENDING`, `APPROVED`, `REJECTED`, `WITHDRAWN`; `data` is `null` if there was never a request), `data.fourEyes.approvals` / `required` |

To find the row of your current certificate, compare `thumbprintSha512` with the lower-case hex of `openssl x509 -in site.pem -outform DER | openssl dgst -sha512 -r`.

## Errors that matter

| Code | HTTP | Meaning |
|------|------|---------|
| `NO_CLIENT_CERT` | 401 | No client certificate reached the portal (TLS or proxy setup). |
| `CERT_NOT_REGISTERED` | 401 | The certificate is not an approved login certificate. |
| `RATE_LIMITED` | 429 | Too many requests; wait and retry (see below). |
| `PRIVATE_KEY_REJECTED` | 400 | The PEM contains a private key. Send the certificate only. |
| `INVALID_PEM`, `CA_CERTIFICATE_REJECTED` | 400 | Not a single end-entity certificate. |
| `CA_BLACKLISTED`, `CA_NOT_WHITELISTED` | 400 | The issuing CA is refused or not on the CA whitelist. |
| `CERT_REGISTERED_ELSEWHERE`, `CERT_BLOCKED` | 409 | The certificate belongs to another site or was blocked after an incident. |
| `CERTIFICATE_NOT_FOUND` | 400 | `:cid` does not belong to this instance. |
| `NO_PUBLISHED_CERTIFICATE` | 400 | On submit: certificates exist but none is published in the allow list. |
| `APPROVAL_ALREADY_PENDING` | 400 | On submit: a request is already open; nothing to do. |
| `INSTANCE_REMOVED` | 400 | The site was removed by two admins and can no longer be approved. |

## Rate limits

Defaults, per 15 minutes unless noted (configurable by the operator):

- `/auth/client-cert-login`: 120 per certificate, plus 30 failed attempts per IP.
- `/api/*`: 100 per minute per user.

A daily or weekly renewal check stays far below both. Log in once per run and reuse the token.

## Renewal timing

The new certificate becomes a login certificate only after approval. Until then, and until it expires, the old certificate keeps working. So:

1. Obtain the replacement certificate well before the old one expires, 30 days by default in the script (`--days`).
2. Run the renewal: register the new certificate with `renew` and submit the approval request.
3. Wait for two admins to approve. Plan for several working days.
4. After approval, switch your service over to the new certificate and key.

If the old certificate expires before approval, automation can no longer log in; renew through the portal with an admin's help instead.

## What stays manual

- The approval itself (two IMI admins, four-eyes).
- Obtaining the replacement certificate from your CA and deploying it.
- Anything that is not listed above.

## Script

```sh
scripts/site-cert-renew.sh --base-url "$BASE" --cert site.pem --key site.key \
    --new-cert new.pem [--days 30] [--force] [--instance <id>] [--dry-run] [--no-submit]
```

It exits `0` on success or when nothing is due, `1` on usage errors, `2` on authentication or network errors, `3` when the API rejects a request, and `4` when the instance is ambiguous or the current certificate is not registered. Tokens and PEM contents are never printed.

## Stability

The endpoints, request fields and response fields listed on this page stay backward compatible: fields are only added, not renamed or removed. A breaking change is announced in the changelog and release notes first. The contract is guarded by the test `backend/src/__tests__/api/automation-contract.test.ts`.
