# FAQ

## Setup Issues

### "Port already in use"
Another service is using port 80, 3000, or 3306.
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
Click "Download Allow List" in the top bar → select "IP Address List (Excel)".

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
A whitelisted CA cannot be blacklisted.
