# Deployment — DDD Reader / FleetView

The whole app (Python API + Go tachograph parser + React frontend) ships as a
single Docker image. On a new server you only need **Docker**; everything else
is built inside the container.

Minimum server: ~2 GB RAM, 2 vCPU, 5 GB disk (the first build downloads Node,
Go and Python layers). Any Debian/Ubuntu VPS works (Hetzner, Contabo, OVH, a
DigitalOcean droplet, etc.) — this replaces the Mikrus host.

---

## 1. One-command install (recommended)

On a fresh server, as root:

```bash
git clone <YOUR-REPO-URL> ddd-reader
cd ddd-reader
sudo bash deploy/install.sh
```

The script will:
1. install Docker + the Compose plugin if missing,
2. create `.env` from `.env.example` and generate a random `FLASK_SECRET_KEY`,
3. let you edit secrets, then build and start everything.

When it finishes, the app is on `http://<server-ip>:8000`.

---

## 2. Manual install

```bash
cp .env.example .env
# edit .env — set PORTAL_PASSWORD, ADMIN_PASSWORD, SAMSARA_API_TOKEN, …
# generate a secret:  openssl rand -hex 32   → FLASK_SECRET_KEY
docker compose up -d --build
```

Check it:

```bash
docker compose ps
docker compose logs -f app
```

---

## 3. Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `APP_PORT` | Host port (container always listens on 8000). |
| `GUNICORN_WORKERS` | Worker processes (≈ 2 × CPU cores + 1). |
| `FLASK_SECRET_KEY` | Signs sessions — **must** be random. |
| `PORTAL_PASSWORD` / `ADMIN_PASSWORD` | Login passwords. |
| `SAMSARA_API_TOKEN` | Fleet GPS / vehicles (EU token). Empty = disabled. |
| `VITE_HERE_API_KEY` | HERE map layers (build-time — rebuild after change). |
| `MEGA_S4_*` | S3-compatible storage for DDD files. |
| `OPENAI_API_KEY` | Optional AI features. |
| `DATABASE_URL` | Empty = embedded SQLite. Set for Postgres (see below). |

> `VITE_HERE_API_KEY` is baked into the static frontend at build time, so after
> changing it you must rebuild: `docker compose up -d --build`.

---

## 4. Data & backups

All persistent data (SQLite DB, `users.json`, activity log, caches) lives in the
`ddd-data` Docker volume mounted at `/opt/ddd-reader`. It survives
`docker compose down` and image rebuilds.

Back it up:

```bash
docker run --rm -v ddd-reader_ddd-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/ddd-backup-$(date +%F).tar.gz -C /data .
```

Restore:

```bash
docker run --rm -v ddd-reader_ddd-data:/data -v "$PWD":/backup alpine \
  sh -c "cd /data && tar xzf /backup/ddd-backup-YYYY-MM-DD.tar.gz"
```

(Volume name is `<project>_ddd-data`; check with `docker volume ls`.)

---

## 4b. Migrating from an old server (systemd/nginx → Docker)

If you already run DDD Reader the old way on another server (app in
`/opt/ddd-reader`, started by systemd), move everything — data **and** secrets —
in one go. Run this **on the new server**, from the repo root, once Docker is
installed:

```bash
# bash deploy/migrate.sh <old_user@host> [ssh_port] [old_app_dir]
APP_PORT=4009 bash deploy/migrate.sh root@srv15.mikr.us 12345
```

It will, over SSH:
1. pull the data files from the old `/opt/ddd-reader` (SQLite DB, `users.json`,
   logs, `config.json`, caches),
2. read the old systemd unit + `.flask_secret` and write the tokens/passwords
   (`SAMSARA_API_TOKEN`, `PORTAL_PASSWORD`, `FLASK_SECRET_KEY`, MEGA S4, …) into
   `.env`,
3. build the image, load the data into the Docker volume, and start the stack.

Notes:
- `VITE_HERE_API_KEY` doesn't exist on the old server — add it to `.env` and
  rebuild (`docker compose up -d --build`) if you want HERE maps.
- Reusing the old `FLASK_SECRET_KEY` keeps existing login sessions valid.
- Keep the old server running until you've confirmed the new one works, then
  repoint your domain / Cloudflare Tunnel to the new server.
- Re-running the script is safe; set `APP_PORT=4009` (or your port) as shown.

## 5. Updating

```bash
git pull
docker compose up -d --build
```

The SQLite schema auto-migrates on start (`CREATE TABLE IF NOT EXISTS …`), so no
manual migration step is needed.

---

## 6. HTTPS

**Option A — Caddy (automatic Let's Encrypt).** Point a domain's A record at the
server, then:

```bash
export DOMAIN=fleet.example.com
export ACME_EMAIL=you@example.com
docker compose -f docker-compose.yml -f deploy/docker-compose.caddy.yml up -d --build
```

Caddy handles certificates and proxies to the app on 80/443.

**Option B — Cloudflare Tunnel.** Keep the app on `127.0.0.1:8000` and run
`cloudflared` pointing at it — TLS terminates at Cloudflare (this mirrors the
previous `dd.ltslog.de` setup).

**Option C — existing nginx.** Reverse-proxy your domain to
`http://127.0.0.1:8000`.

---

## 7. PostgreSQL (optional)

SQLite is fine for a single instance. For Postgres:

1. Uncomment the `db` service and `ddd-pg` volume in `docker-compose.yml`.
2. Set in `.env`: `DATABASE_URL=postgresql://ddd:CHANGE_ME@db:5432/ddd`
   (matching the password in the `db` service).
3. `docker compose up -d`.

---

## 8. Troubleshooting

- **Logs:** `docker compose logs -f app`
- **Shell in the container:** `docker compose exec app bash`
- **dddparser check:** `docker compose exec app dddparser --help`
- **Health:** `docker compose ps` shows `healthy` once `/` responds.
- **Port in use:** change `APP_PORT` in `.env` and `docker compose up -d`.
