# Security Policy

The DSF Management Portal is operated by the Institute of Medical Informatics (IMI), University of Münster, for the German Medical Informatics Initiative (MII) and the Network University Medicine (NUM). It holds organizational, technical and contact data of research sites: network membership, X.509 certificates, FHIR endpoints and contact details.

A compromise can leak contact data of staff, inject endpoints or certificates into the allow list that downstream DSF nodes accept as authoritative, or block the onboarding of sites. Please report even low-impact issues, since they can be chained.

## Reporting a vulnerability

Do **not** open a public GitHub issue for a security problem.

1. **Preferred:** open a private advisory at
   <https://github.com/medizininformatik-initiative/num-dsf-management/security/advisories/new>.
   The report stays private until a fix is ready.
2. **Without a GitHub account:** contact the institute via
   <https://www.medizin.uni-muenster.de/imi/das-institut.html> and mention "DSF Management Portal security report" in the subject.

Include as much of the following as you can:

- a one-sentence summary of the impact
- the affected component (`frontend/`, `backend/`, `nginx/`, `db/migrations/`, Docker configuration, a CI workflow) and the version or commit (`git rev-parse HEAD` or the release tag)
- minimal, reproducible steps, for example a `curl` command, and a proof of concept with any real data redacted
- what an attacker could do (read or write data, code execution, persistence)
- optionally a suggested fix, and the name you want credited (pseudonyms are fine)

## What happens next

| Step | Target |
|---|---|
| Acknowledgement of the report | within 48 hours |
| Severity assessment and plan | within 7 days |
| Fix | Critical within 7 days, High within 14 days, Medium within 30 days, Low in the next minor release |

Severity follows CVSS: **Critical** (authentication bypass on admin routes, code execution, SQL injection exposing users or contacts, disclosure of a signing key), **High** (privileged-route bypass with limited reach, mass enumeration of contacts, CSRF on state-changing endpoints, JWT signature flaws), **Medium** (stored XSS in admin-only views, IDOR on a few records, audit-log integrity issues with reduced impact), **Low** (disclosure of non-sensitive metadata, log spoofing).

We keep the reporter informed at each step: triage result, fix branch, release tag and the date the advisory is published. Reporters are credited in the release notes and the GitHub advisory unless they ask not to be.

If a vulnerability may affect MII/NUM-wide infrastructure beyond one deployment (a shared cryptographic library, the FHIR bundle format, the PKI chain), IMI coordinates with the network operators before publication. The embargo can then extend to 60-90 days; the reporter is consulted and told at least 14 days before the planned publication.

## Scope

In scope:

- **Frontend** (`frontend/`): XSS, CSRF, broken auth-state handling, secrets in bundles.
- **Backend** (`backend/`): authentication bypass, IDOR, SQL injection (Knex prepared statements are used, but please test), SSRF, command injection, deserialization.
- **nginx** (`nginx/`): header bypass, rate-limit evasion, TLS downgrade, request smuggling.
- **Authentication:** OTP entropy and replay, TOTP window, backup-code reuse, session fixation, refresh-token replay, client-certificate handling.
- **Audit log integrity:** anything that lets a privileged user erase or rewrite entries.
- **Approval workflow:** bypassing the admin gate or four-eyes rule, snapshot tampering.
- **Database migrations** (`db/migrations/`) and **CI/CD** (`.github/workflows/`), including secret leakage and code execution triggered by untrusted pull-request input.
- **FHIR allow-list bundle:** content forgery, signature mismatch, leakage of contact data.

Out of scope:

- already disclosed third-party CVEs with an upstream fix (report upstream; we bump the dependency)
- issues that need physical access to a server, or social engineering of staff
- self-XSS and non-default browser configurations (disabled CSP, malicious extensions)
- spreadsheet formula injection in exported XLSX files
- denial of service through expensive requests or resource exhaustion
- missing headers without a concrete attack path
- findings in documentation or comments, unless they reveal credentials

## Safe harbor

IMI will not pursue or support legal action against good-faith research that stays within this policy. To stay within it:

- test only against your own local `docker compose` stack or a test deployment, never a production allow list or real participant data
- do not access, modify, exfiltrate or destroy data that is not yours, and do not degrade the service for others
- do not social-engineer staff, partner organizations or downstream nodes
- stop once you have a working proof of concept and report it
- keep the report confidential until the agreed embargo ends

We do not run a paid bug-bounty program. Unsolicited "pay us and we will tell you" messages are not vulnerability reports.

## Questions

For questions about this policy that are not vulnerability reports, open a regular GitHub issue or contact IMI through the institute's official channels.
