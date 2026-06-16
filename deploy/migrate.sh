#!/usr/bin/env bash
# =============================================================================
#  Migrate an existing (systemd/nginx) DDD Reader install to this Docker setup.
#
#  Run this ON THE NEW server, from the repo root, after `docker compose` is
#  available. It pulls everything from the OLD server over SSH:
#    • data files from /opt/ddd-reader (SQLite DB, users.json, logs, config)
#    • secrets/tokens from the old systemd unit + .flask_secret  → into .env
#  then loads the data into the Docker volume and starts the stack.
#
#  Usage:
#     bash deploy/migrate.sh <old_user@host> [ssh_port] [old_app_dir]
#
#  Examples:
#     bash deploy/migrate.sh root@srv15.mikr.us 12345
#     APP_PORT=4009 bash deploy/migrate.sh root@old.example.com 22 /opt/ddd-reader
#
#  Safe to re-run. Existing .env values you already set are preserved unless the
#  old server provides a non-empty value for the same key.
# =============================================================================
set -euo pipefail

OLD="${1:?old server, e.g. root@srv15.mikr.us}"
PORT="${2:-22}"
OLD_DIR="${3:-/opt/ddd-reader}"
SSH=(ssh -p "$PORT" "$OLD")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

say() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$1"; }

command -v docker >/dev/null || { warn "Docker not installed. Run deploy/install.sh first."; exit 1; }
docker compose version >/dev/null || { warn "docker compose plugin missing."; exit 1; }

# ---------------------------------------------------------------------------
# 1. Pull data files from the old server (tar over SSH, missing files ignored)
# ---------------------------------------------------------------------------
say "Fetching data files from ${OLD}:${OLD_DIR} ..."
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
DATA_FILES=(ddd_portal.db users.json login_history.json activity_log.json config.json portal_cache.json .flask_secret)
"${SSH[@]}" "cd '$OLD_DIR' && tar czf - --ignore-failed-read ${DATA_FILES[*]} 2>/dev/null" > "$TMPD/data.tgz" || true
mkdir -p "$TMPD/data"
tar xzf "$TMPD/data.tgz" -C "$TMPD/data" 2>/dev/null || true
say "Pulled: $(cd "$TMPD/data" && ls -A 2>/dev/null | tr '\n' ' ')"

# ---------------------------------------------------------------------------
# 2. Pull env (systemd unit Environment= lines + .flask_secret) → seed .env
# ---------------------------------------------------------------------------
say "Reading environment from old systemd unit ..."
"${SSH[@]}" "cat /etc/systemd/system/ddd-reader.service 2>/dev/null" > "$TMPD/unit.txt" || true

[ -f .env ] || { cp .env.example .env; say "Created .env from template"; }

# set_env KEY VALUE — replace or append, value written verbatim (no escaping issues)
set_env() {
  local key="$1"; shift; local val="$*"
  [ -z "$val" ] && return 0
  grep -v "^${key}=" .env > "$TMPD/.env.tmp" 2>/dev/null || true
  mv "$TMPD/.env.tmp" .env
  printf '%s=%s\n' "$key" "$val" >> .env
}

# Whitelist of keys worth importing (paths like DDDPARSER_PATH/FRONTEND_DIR are
# intentionally skipped — Docker uses its own).
IMPORT_KEYS=" FLASK_SECRET_KEY PORTAL_PASSWORD ADMIN_PASSWORD SAMSARA_API_TOKEN \
DROPBOX_REFRESH_TOKEN DROPBOX_APP_KEY DROPBOX_APP_SECRET \
MEGA_S4_ACCESS_KEY_ID MEGA_S4_SECRET_ACCESS_KEY MEGA_S4_BUCKET MEGA_S4_ENDPOINT MEGA_S4_REGION \
OPENAI_API_KEY DATABASE_URL VITE_HERE_API_KEY "

found=0
while IFS= read -r line; do
  case "$line" in
    Environment=*)
      kv="${line#Environment=}"
      key="${kv%%=*}"
      val="${kv#*=}"
      if [[ "$IMPORT_KEYS" == *" $key "* ]]; then
        set_env "$key" "$val"
        found=$((found+1))
      fi
      ;;
  esac
done < "$TMPD/unit.txt"

# Fall back to .flask_secret if the unit didn't carry FLASK_SECRET_KEY.
if ! grep -q '^FLASK_SECRET_KEY=..' .env && [ -s "$TMPD/data/.flask_secret" ]; then
  set_env FLASK_SECRET_KEY "$(tr -d '\r\n' < "$TMPD/data/.flask_secret")"
fi

# App port: from $APP_PORT env override, else keep whatever is in .env.
[ -n "${APP_PORT:-}" ] && set_env APP_PORT "$APP_PORT"
say "Imported $found secret(s)/token(s) from old unit into .env"
warn "Review .env before continuing (especially VITE_HERE_API_KEY — not on old server)."

# ---------------------------------------------------------------------------
# 3. Build image, load data into the volume, start
# ---------------------------------------------------------------------------
say "Building image ..."
docker compose build

if [ -n "$(ls -A "$TMPD/data" 2>/dev/null)" ]; then
  say "Loading data into the Docker volume (/opt/ddd-reader) ..."
  docker compose run --rm --no-deps -v "$TMPD/data":/in:ro app \
    sh -c 'cp -a /in/. /opt/ddd-reader/ && rm -f /opt/ddd-reader/.flask_secret && ls -la /opt/ddd-reader'
else
  warn "No data files were pulled — starting with an empty database."
fi

say "Starting ..."
docker compose up -d

APP_PORT_NOW="$(grep -E '^APP_PORT=' .env | cut -d= -f2)"; APP_PORT_NOW="${APP_PORT_NOW:-8000}"
say "Migration done. App on http://<server-ip>:${APP_PORT_NOW}"
docker compose ps
cat <<EOF

Next steps:
  • Verify login + data at http://<server-ip>:${APP_PORT_NOW}
  • Point your domain / Cloudflare Tunnel at the new server
  • Keep the OLD server until you've confirmed everything works
EOF
