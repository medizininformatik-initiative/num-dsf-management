# DSF Management Portal

Web application for managing the participants of the Data Sharing Framework (DSF) in the German Medical Informatics Initiative (MII) and the Network University Medicine (NUM). The overview and quick start are in the [root README](../../README.md).

## Features

- **Entity graph canvas:** organization, contacts, endpoints, certificates and memberships of a site on one screen.
- **Sign-in:** e-mail one-time code plus TOTP, or client certificate (mTLS; certificate-only in production).
- **Approval workflow:** changes reach the allow list after four-eyes approval by IMI admins, with a risk assessment per request and step-up re-confirmation.
- **FHIR allow list:** DSF-compliant transaction bundles, RS256-signed and versioned (diff, download, four-eyes restore).
- **Certificate management:** upload, renewal wizard, expiry tracking and alerts, CA blacklist and whitelist.
- **Federation map** of all sites, **process marketplace**, **incident register** (NIS2 reporting aid).
- **Append-only audit log** (database triggers).
- Dark mode, German and English interface.

## Pages

- [Getting Started](Getting-Started.md): local setup with Docker Compose
- [Architecture](Architecture.md): runtime topology, authentication, approval and bundle lifecycle
- [API Reference](API-Reference.md): all endpoints
- [Site automation](../automation.md): script-friendly endpoints for certificate renewal
- [Deployment](../DEPLOYMENT.md): production setup, certificate sign-in, proxy, backups
- [Security](Security.md): authentication, transport and data-protection controls
- [Admin Guide](Admin-Guide.md): approval workflow, risk rules, site removal, incidents
- [FAQ](FAQ.md): common questions
- [Architecture decisions](../adr/) and [database documentation](../database/)
