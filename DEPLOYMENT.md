# JSK HRM & PM — Production Deployment Guide

Production-ready source bundle. Node/TypeScript monorepo (npm workspaces):
NestJS API, React (Vite) web app, background worker, PostgreSQL, Redis,
S3-compatible object storage (MinIO), SMTP.

---

## 1. Server prerequisites

| Component        | Version | Notes                                  |
|------------------|---------|----------------------------------------|
| Node.js          | ≥ 18    | 20 LTS recommended                     |
| npm              | ≥ 9     | ships with Node                        |
| PostgreSQL       | 15+     | any reachable instance                 |
| Redis            | 7+      | background jobs                        |
| MinIO / S3       | any     | file storage (`jsk-files` bucket)      |
| nginx            | stable  | TLS termination + static web + proxy   |
| SMTP             | —       | transactional email                    |

```bash
# create a service user
sudo useradd -r -m -d /opt/jsk -s /usr/sbin/nologin jsk
```

## 2. Unpack & install

```bash
sudo mkdir -p /opt/jsk && sudo chown jsk:jsk /opt/jsk
# upload + unzip the release into /opt/jsk (package.json at /opt/jsk/package.json)
cd /opt/jsk
npm ci --include=dev          # dev deps are required to build TypeScript
```

> `npm ci` uses the committed `package-lock.json` for reproducible installs.

## 3. Configure environment

```bash
cp .env.production.example apps/api/.env
nano apps/api/.env           # fill real secrets
chmod 600 apps/api/.env
```

Required values: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`
(`openssl rand -hex 32`), `S3_*`, `SMTP_*`, `PUBLIC_WEB_ORIGIN`,
`COOKIE_SECURE=true`.

The worker reads the same file via its unit's `EnvironmentFile`.

## 4. Database setup

```bash
cd /opt/jsk
createdb jsk                 # or use your managed Postgres console
npm run db:migrate           # applies db/migrations in order
npm run db:seed              # OPTIONAL — demo/reference data only.
                             # Skip on a real production install unless you
                             # want the initial admin account it provisions.
```

Migrations are idempotent per migration file and tracked by `db/migrate.js`.

## 5. Build

```bash
cd /opt/jsk
# API + shared packages + worker
npm run build:api
npm run build:worker

# Web app — VITE_API_URL is BAKED IN at build time.
# Same-origin deployment (nginx proxies /api → :3000) [recommended]:
VITE_API_URL="" npm run build:web
# Split-origin alternative:
# VITE_API_URL="https://api.example.com" npm run build:web
```

Outputs:
- API → `apps/api/dist/main.js` (listens on port `3000`)
- Worker → `apps/worker/dist/main.js`
- Web → `apps/web/dist/`

## 6. Process management (systemd)

Units are provided in `infra/systemd/`:

```bash
sudo cp infra/systemd/jsk-api.service /etc/systemd/system/
sudo cp infra/systemd/jsk-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jsk-api jsk-worker
systemctl status jsk-api
journalctl -u jsk-api -f          # logs
```

Health check: `curl http://127.0.0.1:3000/health` → `{"status":"ok",...}`.

## 7. Reverse proxy (nginx)

Config template in `infra/nginx/jsk.conf`:

```bash
sudo cp infra/nginx/jsk.conf /etc/nginx/sites-available/jsk.conf
sudo ln -s /etc/nginx/sites-available/jsk.conf /etc/nginx/sites-enabled/
# edit server_name + TLS paths, then:
sudo certbot --nginx -d hrm.example.com     # or bring your own certs
sudo nginx -t && sudo systemctl reload nginx
```

Key requirements encoded in that config:
- `/api/` → `proxy_buffering off` (**mandatory** for the two SSE streams:
  `/api/messages/stream`, `/api/notifications/stream`) and long read timeout.
- SPA fallback `try_files ... /index.html` for client-side routes.
- `client_max_body_size 50m` for uploads.

## 8. Object storage (MinIO example)

```bash
mc alias set prod https://<minio-host>:9000 <access-key> <secret-key>
mc mb prod/jsk-files || true
```

The API auto-ensures the bucket on boot; unreachable storage only warns.

## 9. First login

Browse to `https://hrm.example.com`, log in with the account provisioned by
the seed step (or create one through your admin process). Immediately set a
strong password. Admin area also requires setting the **delete password**
(guarded destructive operations).

## 10. Upgrades

```bash
cd /opt/jsk
sudo systemctl stop jsk-api jsk-worker
# replace source (unzip new release over old, keeping apps/api/.env)
npm ci --include=dev
npm run db:migrate
npm run build:api && npm run build:worker && VITE_API_URL="" npm run build:web
sudo systemctl start jsk-api jsk-worker
```

## 11. Production checklist

- [ ] `SESSION_SECRET` is a fresh random value (not the example)
- [ ] `COOKIE_SECURE=true`, site served over HTTPS
- [ ] DB / Redis / MinIO / SMTP credentials are strong and private
- [ ] `.env` files are `chmod 600` and owned by the service user
- [ ] Firewall: expose only 80/443; keep 3000, 5432, 6379, 9000 internal
- [ ] `PUBLIC_WEB_ORIGIN` matches the exact public URL (CORS)
- [ ] Backups scheduled: Postgres dumps + MinIO data + `.env`
- [ ] Log rotation via journald (default) or your collector
