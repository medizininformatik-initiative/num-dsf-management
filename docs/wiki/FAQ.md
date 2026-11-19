# FAQ

## Setup Issues

### "Port already in use"
Another service is using port 80, 443 or 8025 (the ports the dev compose file publishes).
```bash
# Check what's using port 80
netstat -tlnp | grep :80
# Or change ports in docker-compose.yml
```

### "Database connection failed"
MySQL needs ~30 seconds to start. The backend auto-retries.
```bash
docker compose ps  # Check if db is "healthy"
docker compose logs backend  # Check backend logs
```

### "generate-keys.sh: Permission denied"
```bash
chmod +x scripts/generate-keys.sh
bash scripts/generate-keys.sh
```

## Authentication

### "I lost my TOTP device"
Use one of your 10 backup codes. Each code works once. If all are used, an operator has to reset your TOTP on the server (for admins see `scripts/admin-cert.sh totp-reset` in the [Deployment guide](../DEPLOYMENT.md)).

### "My browser has no client certificate" (certificate sign-in)
Build a `.p12` from your DSF client certificate and its private key and import it into the browser. The sign-in page shows the commands and the steps per browser; the same text is in [Site automation](../automation.md#no-certificate-in-your-browser). Never upload the private key to the portal.

### "PROXY_NOT_TRUSTED" or "NO_CLIENT_CERT" on certificate sign-in
`NO_CLIENT_CERT`: no certificate reached the portal; install it in the browser, restart the browser and pick it. `PROXY_NOT_TRUSTED`: the proxy forwarded certificate headers without the `X-Proxy-Auth` secret; an operator has to fix the proxy configuration (`CLIENT_CERT_PROXY_SECRET`, see [Deployment](../DEPLOYMENT.md)).

### "OTP code expired"
Codes expire after 10 minutes. Request a new one.

### "Rate limited"
Wait 15 minutes. Auth endpoints allow max 5 attempts per 15 minutes.

## Data Management

### "How do I reset the database?"
```bash
docker compose down -v  # Removes all data volumes
docker compose up -d    # Fresh start
# Re-run seeds after reset
```

### "How do I add test data?"
```bash
docker compose exec backend npx ts-node src/db/seed-testdata.ts
```

### "How do I export the IP address list?"
Click "Download allow list" in the top bar and choose "Download IP address list (Excel)".

## Administration

### "How do I add another admin?"
After the first admin exists, `IMI_ADMIN_EMAILS` is ignored. An existing admin
requests a promotion for the target user at `/app/admin/promotions`, and a
**second** admin from a different site approves it (4-eyes, no silent consent).

### "What is the CA blacklist?"
A list of distrusted certificate authorities (subject DN, optionally pinned by
SHA-256 fingerprint), managed at `/app/admin/ca-blacklist`. A certificate upload
whose issuer matches the list is rejected with `CA_BLACKLISTED`.

### "What is the CA whitelist?"
The certificate authorities the DSF accepts in production, seeded at init with
the DSF 2.1.1 defaults (DFN, D-TRUST, GEANT and HARICA, Sectigo/USERTrust,
T-TeleSec and others). Certificates issued by one of them get a DSF CA badge;
others, self-signed test certificates included, are still accepted unless
`CA_WHITELIST_ENFORCE=true`, which rejects them with `CA_NOT_WHITELISTED`.
A whitelisted CA cannot be blacklisted. Both lists apply to uploads and renewals.

### "A site was removed by mistake"
Removal by two admins is permanent in the portal. An operator reverses it in the database, then the site submits a new request; see [Removing a Site](Admin-Guide.md#removing-a-site).

### "Can a site's certificate block be lifted?"
After a false alarm, two admins of different sites can lift the blocks of an incident; see [Security Incidents](Admin-Guide.md#security-incidents).
