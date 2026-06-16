#!/usr/bin/env bash
# =============================================================================
#  DDD Reader / FleetView — one-command installer for a fresh Linux server
#
#  Usage (as root, on the target server):
#     git clone <repo-url> ddd-reader && cd ddd-reader
#     sudo bash deploy/install.sh
#
#  Installs Docker if missing, prepares .env (generating a secret key on first
#  run), then builds and starts the stack with docker compose.
#  Re-running it safely updates an existing install.
# =============================================================================
set -euo pipefail

# Resolve repo root (this script lives in deploy/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

say() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$1"; }

# ---------------------------------------------------------------------------
# 1. Docker + compose plugin
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Docker not found — installing via get.docker.com ..."
  curl -fsSL https://get.docker.com | sh
else
  say "Docker present: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
  warn "Docker Compose plugin missing. Install 'docker-compose-plugin' for your distro and re-run."
  exit 1
fi

systemctl enable --now docker >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 2. .env — create from example, generate a secret on first run
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
    sed -i "s|^FLASK_SECRET_KEY=.*|FLASK_SECRET_KEY=${SECRET}|" .env
    say "Generated a random FLASK_SECRET_KEY"
  fi
  warn "Edit .env now and set PORTAL_PASSWORD / ADMIN_PASSWORD / SAMSARA_API_TOKEN etc."
  warn "Then re-run this script (or: docker compose up -d --build)."
  read -rp "Open .env in an editor now? [y/N] " ans
  if [[ "${ans:-N}" =~ ^[Yy]$ ]]; then
    "${EDITOR:-nano}" .env
  else
    exit 0
  fi
else
  say ".env already exists — keeping it"
fi

# ---------------------------------------------------------------------------
# 3. Build & start
# ---------------------------------------------------------------------------
say "Building and starting containers (this can take a few minutes the first time)…"
docker compose up -d --build

APP_PORT="$(grep -E '^APP_PORT=' .env | cut -d= -f2)"
APP_PORT="${APP_PORT:-8000}"

say "Done. Container status:"
docker compose ps

cat <<EOF

=============================================================
 DDD Reader / FleetView is running.

   Local:   http://localhost:${APP_PORT}
   Network: http://<server-ip>:${APP_PORT}

 Useful commands:
   docker compose logs -f app        # live logs
   docker compose restart app        # restart
   docker compose up -d --build      # update after 'git pull'
   docker compose down               # stop (data is kept in the volume)

 For HTTPS, put Caddy / nginx / Cloudflare Tunnel in front — see DEPLOY.md.
=============================================================
EOF
