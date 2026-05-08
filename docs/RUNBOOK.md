# Operator Runbook

## Where things live

- **Server**: OVH VPS at `15.204.254.192` (Ubuntu 25.04, kernel 6.14). SSH: `ssh ubuntu@15.204.254.192`
- **Web SPA**: Netlify, deployed automatically from `main`.
- **DB**: PostgreSQL 17 on the same VPS, Unix-socket-only at `/var/run/postgresql`.
- **DNS**: Cloudflare, zone `rpow2.com`. `api.rpow2.com` is DNS-only (proxy off, TTL 60); apex and `www` stay proxied.
- **Email**: Resend.
- **Backups**: restic → Backblaze B2 bucket `rpow2-ovhbackup`, nightly at 03:00 UTC.

## One-page health check

```bash
ssh ubuntu@15.204.254.192 'sudo /usr/local/bin/rpow-status'
```

## Service recovery

Three layers (every layer has been tested):

| Failure mode | Recovery |
|---|---|
| node process crashes / clean exit | systemd restarts in ~2s (`Restart=always`, `RestartSec=2`, up to 10 starts per 5min before pause) |
| node process hung but alive (deadlock, infinite loop) | `rpow-healthcheck.timer` probes `/health` every 90s; after 2 consecutive failures, runs `systemctl restart rpow-server`. Logs to `journalctl -t rpow-healthcheck` |
| nginx / Postgres crash | distro systemd units auto-restart |
| VPS reboot | all rpow services + nginx + postgresql + ufw + fail2ban + certbot.timer + rpow-backup.timer + rpow-healthcheck.timer are `enabled` — they come back on boot |
| TLS cert expiry | `certbot.timer` renews 30 days before expiry, fully unattended via Cloudflare DNS-01 |
| Backup repo corruption | restic does a 5% read-data integrity check on every nightly run; restore drill documented below |

**Recommended addition (not yet wired)**: an external uptime monitor (e.g. free UptimeRobot or healthchecks.io) hitting `https://api.rpow2.com/health` every minute, paging when 3+ consecutive failures. The VPS-internal watchdog can't help if the whole box is dead — only an off-box monitor can.

To inspect the watchdog's recent activity:
```bash
ssh ubuntu@15.204.254.192 'sudo journalctl -t rpow-healthcheck --since "1 hour ago"'
```

## Logs

```bash
ssh ubuntu@15.204.254.192 'sudo journalctl -u rpow-server -f'
ssh ubuntu@15.204.254.192 'sudo tail -f /var/log/nginx/api.rpow2.com.access.log'
ssh ubuntu@15.204.254.192 'sudo tail -f /var/log/nginx/api.rpow2.com.error.log'
ssh ubuntu@15.204.254.192 'sudo tail -f /var/log/postgresql/postgresql-17-main.log'
```

## Deploys

```bash
ssh ubuntu@15.204.254.192 '
  sudo -u rpow bash -c "cd /opt/rpow/repo && \
    git pull origin main && \
    npm ci --workspaces --include-workspace-root --ignore-scripts && \
    npm run build --workspace @rpow/shared && \
    npm run build --workspace @rpow/server" && \
  sudo systemctl restart rpow-server'
```

## Secrets / config files

| File | Mode | Owner | Purpose |
|---|---|---|---|
| `/etc/rpow/server.env` | 0640 | root:rpow | App env (DATABASE_URL, signing keys, Resend, etc.) |
| `/etc/rpow/restic.env` | 0600 | root:root | B2 creds + restic password |
| `/etc/letsencrypt/cloudflare.ini` | 0600 | root:root | Cloudflare API token for DNS-01 |

After editing `server.env`: `sudo systemctl restart rpow-server`.

## Difficulty changes

```bash
ssh ubuntu@15.204.254.192 '
  sudo sed -i "s/^DIFFICULTY_BITS=.*/DIFFICULTY_BITS=30/" /etc/rpow/server.env && \
  sudo systemctl restart rpow-server'
```

## Backup operations

- **Nightly**: `rpow-backup.timer` at 03:00 UTC (with up to 5min jitter).
- **Manual**: `ssh ubuntu@15.204.254.192 'sudo /usr/local/bin/rpow-backup'`
- **Restore drill**: `ssh ubuntu@15.204.254.192 'sudo /usr/local/bin/rpow-restore-test'` — restores latest snapshot into a scratch DB and prints row counts. Run weekly to keep restic + creds healthy.
- **List snapshots**: `ssh ubuntu@15.204.254.192 'sudo bash -c "set -a; . /etc/rpow/restic.env; set +a; restic snapshots"'`
- **Retention**: 7 daily, 4 weekly, 6 monthly. 5% read-data integrity check on each backup.

## TLS renewals

Auto-renewing via certbot's systemd timer. No human action needed.

```bash
ssh ubuntu@15.204.254.192 'systemctl list-timers certbot.timer'
ssh ubuntu@15.204.254.192 'sudo certbot renew --dry-run'   # exercise the flow
```

## Rotating the signing key

Edit `RPOW_SIGNING_PRIVATE_KEY_HEX` and `RPOW_SIGNING_PUBLIC_KEY_HEX` in `/etc/rpow/server.env`, then `sudo systemctl restart rpow-server`. Existing minted tokens become unverifiable if the private key changes — coordinate carefully.

## Database access

```bash
# Read-only inspection as ubuntu
ssh ubuntu@15.204.254.192 'sudo -u postgres psql rpow'

# As the rpow_app role over Unix socket (password from .env.vps locally)
DBPW=$(grep '^RPOW_DB_PASSWORD=' .env.vps | cut -d= -f2-)
ssh ubuntu@15.204.254.192 "PGPASSWORD='$DBPW' psql -h /var/run/postgresql -U rpow_app -d rpow"
```

## Common tasks

- **Reset a user's account (testing)**:
  ```sql
  DELETE FROM tokens WHERE owner_email='X';
  DELETE FROM transfers WHERE sender_email='X' OR recipient_email='X';
  DELETE FROM pending_transfers WHERE sender_email='X' OR recipient_email='X';
  DELETE FROM users WHERE email='X';
  ```

## Cloudflare DNS records

- Zone `rpow2.com` ID: `685720286628e21c9b43f260ac6b63bf`
- `api.rpow2.com` A record ID: `34daa777f0dbbdbd1e3c97d6c12e9837` (TTL 60, DNS-only)
- `api.rpow2.com` AAAA record ID: `1cfb2458cc028a8f95bea16a439bff6c` (TTL 60, DNS-only)

To re-flip A record (e.g. failover to a hot-standby VPS):
```bash
CF=$(grep '^CLOUDFLARE_API_TOKEN=' .env | cut -d= -f2-)
curl -X PATCH \
  -H "Authorization: Bearer $CF" -H "Content-Type: application/json" \
  --data '{"content": "<new-ip>"}' \
  https://api.cloudflare.com/client/v4/zones/685720286628e21c9b43f260ac6b63bf/dns_records/34daa777f0dbbdbd1e3c97d6c12e9837
```

## Incident: VPS down or compromised

- Cloudflare DNS will not auto-failover. Existing backups are in B2.
- Recovery sequence: provision new VPS, replay Tasks 1–7 of `docs/superpowers/plans/2026-05-07-fly-to-vps-migration.md`, then `restic restore` the latest snapshot into a fresh `rpow` DB, then flip DNS A/AAAA via the Cloudflare API.
- Cert can be re-issued in minutes via DNS-01 (token already in CF; just put it back at `/etc/letsencrypt/cloudflare.ini`).

## Migration history

- 2026-05-07: spec + plan written.
- 2026-05-08 04:50–04:54 UTC: cutover from Fly.io+Neon to OVH VPS+self-hosted PG17. ~120s user-visible interruption, zero committed-data loss verified by row-count parity gate. Perf: `/mint` p50 went from 84,000ms (Fly+Neon) to 57ms (VPS+local PG).

See `docs/superpowers/specs/2026-05-07-fly-to-vps-migration-design.md` for the full design and `docs/superpowers/plans/2026-05-07-fly-to-vps-migration.md` for the implementation plan.
