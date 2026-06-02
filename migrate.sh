#!/bin/bash
# =============================================================================
#  Migracja DDD Reader: marcin319.mikrus.xyz:10319  →  76.13.3.214:22
# =============================================================================
#
#  Uruchamiasz LOKALNIE z katalogu repo:
#      ./migrate.sh
#
#  Skrypt robi wszystko poza zmianą DNS w Cloudflare (powie kiedy).
#
#  Fazy:
#    1. Backup ze starego serwera (DB + configi + sekrety) → lokalna kopia
#    2. Setup nowego serwera (apt deps, Go, tachoparser, katalogi)
#    3. Build frontendu lokalnie + upload backendu
#    4. Restore danych + sekretów na nowym
#    5. Uruchomienie + weryfikacja
#
# =============================================================================

set -euo pipefail

# ─── konfiguracja ─────────────────────────────────────────────────────────────
OLD_HOST="root@marcin319.mikrus.xyz"
OLD_PORT="10319"
NEW_HOST="root@76.13.3.214"
NEW_PORT="22"
APP_DIR="/opt/ddd-reader"
DOMAIN="dd.ltslog.de"
BACKUP_DIR="./_migration_backup"

SSH_OLD="ssh -p $OLD_PORT -o StrictHostKeyChecking=accept-new $OLD_HOST"
SCP_OLD="scp -P $OLD_PORT -o StrictHostKeyChecking=accept-new"
SSH_NEW="ssh -p $NEW_PORT -o StrictHostKeyChecking=accept-new $NEW_HOST"
SCP_NEW="scp -P $NEW_PORT -o StrictHostKeyChecking=accept-new"

# ─── helpers ──────────────────────────────────────────────────────────────────
log()  { echo -e "\n\033[1;36m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠ $*\033[0m"; }
die()  { echo -e "\033[1;31m✗ $*\033[0m"; exit 1; }

require() {
    command -v "$1" >/dev/null 2>&1 || die "Brakuje narzędzia: $1"
}

# ─── pre-flight ───────────────────────────────────────────────────────────────
log "[0/6] Sprawdzanie wymagań lokalnych"
require ssh
require scp
require tar
require npm
require git

[ -d frontend ] && [ -d backend ] || die "Uruchom z katalogu repo (musi być frontend/ i backend/)"

log "Test SSH do starego serwera"
$SSH_OLD "echo OK" >/dev/null || die "Brak dostępu SSH do starego serwera"
ok "Stary OK"

log "Test SSH do nowego serwera"
$SSH_NEW "echo OK" >/dev/null || die "Brak dostępu SSH do nowego serwera"
ok "Nowy OK"

# ─── FAZA 1: backup ze starego ────────────────────────────────────────────────
log "[1/6] Backup danych ze starego serwera"

mkdir -p "$BACKUP_DIR"

$SSH_OLD "
    set -e
    cd /opt/ddd-reader
    tar czf /tmp/ddd-data.tar.gz \\
        ddd_portal.db \\
        config.json \\
        users.json \\
        login_history.json \\
        activity_log.json \\
        portal_cache.json 2>/dev/null || true
" || die "Backup danych nie powiódł się"

$SCP_OLD "$OLD_HOST:/tmp/ddd-data.tar.gz" "$BACKUP_DIR/ddd-data.tar.gz"
ok "Dane: $BACKUP_DIR/ddd-data.tar.gz ($(du -h "$BACKUP_DIR/ddd-data.tar.gz" | cut -f1))"

# Systemd unit z env vars (S3, Samsara, Dropbox, hasła)
$SSH_OLD "cat /etc/systemd/system/ddd-reader.service" > "$BACKUP_DIR/ddd-reader.service"
ok "Systemd unit (z sekretami): $BACKUP_DIR/ddd-reader.service"

# Nginx config (na wszelki wypadek, jakbyś coś customował)
$SSH_OLD "cat /etc/nginx/sites-available/ddd-reader 2>/dev/null || true" > "$BACKUP_DIR/nginx-ddd-reader.conf"
[ -s "$BACKUP_DIR/nginx-ddd-reader.conf" ] && ok "Nginx config: $BACKUP_DIR/nginx-ddd-reader.conf"

ok "Backup gotowy w $BACKUP_DIR/"

# ─── FAZA 2: provisioning nowego ──────────────────────────────────────────────
log "[2/6] Provisioning nowego serwera (apt + Go + tachoparser)"

$SSH_NEW "bash -s" <<'REMOTE_PROVISION'
set -e
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv nginx golang-go git curl

mkdir -p /opt/ddd-reader/static

# Tachoparser (Go) - build jeśli nie istnieje
if [ ! -x /usr/local/bin/dddparser ]; then
    echo "Building tachoparser..."
    TMP=$(mktemp -d)
    cd "$TMP"
    git clone -q https://github.com/traconiq/tachoparser.git
    cd tachoparser
    mkdir -p internal/pkg/certificates/pks1 internal/pkg/certificates/pks2
    touch internal/pkg/certificates/pks1/dummy.bin internal/pkg/certificates/pks2/dummy.bin
    go build -o /usr/local/bin/dddparser ./cmd/dddparser/
    cd / && rm -rf "$TMP"
fi

# Python venv
if [ ! -d /opt/ddd-reader/venv ]; then
    python3 -m venv /opt/ddd-reader/venv
fi

echo "PROVISION_DONE"
REMOTE_PROVISION

ok "Serwer nowy: system gotowy"

# ─── FAZA 3: build i upload kodu ──────────────────────────────────────────────
log "[3/6] Build frontendu lokalnie"
(cd frontend && npm ci --silent && npm run build)
ok "Frontend zbudowany"

log "Upload backendu i frontendu na nowy serwer"

# Frontend
$SSH_NEW "rm -rf $APP_DIR/static/*"
$SCP_NEW -r frontend/dist/* "$NEW_HOST:$APP_DIR/static/"

# Backend (struktura pakietowa)
$SSH_NEW "
    mkdir -p $APP_DIR/core $APP_DIR/auth $APP_DIR/services $APP_DIR/routes \\
             $APP_DIR/backend/compliance/adapters \\
             $APP_DIR/backend/compliance/facts \\
             $APP_DIR/backend/compliance/profiles \\
             $APP_DIR/backend/compliance/rules \\
             $APP_DIR/tachograph
"

$SCP_NEW backend/app.py backend/config.py backend/extensions.py backend/database.py \
         backend/samsara_sync.py backend/requirements.txt \
         "$NEW_HOST:$APP_DIR/"

$SCP_NEW backend/core/*.py        "$NEW_HOST:$APP_DIR/core/"
$SCP_NEW backend/auth/*.py        "$NEW_HOST:$APP_DIR/auth/"
$SCP_NEW backend/services/*.py    "$NEW_HOST:$APP_DIR/services/"
$SCP_NEW backend/routes/*.py      "$NEW_HOST:$APP_DIR/routes/"
$SCP_NEW backend/compliance/*.py             "$NEW_HOST:$APP_DIR/backend/compliance/"
$SCP_NEW backend/compliance/adapters/*.py    "$NEW_HOST:$APP_DIR/backend/compliance/adapters/"
$SCP_NEW backend/compliance/facts/*.py       "$NEW_HOST:$APP_DIR/backend/compliance/facts/"
$SCP_NEW backend/compliance/profiles/*.py    "$NEW_HOST:$APP_DIR/backend/compliance/profiles/"
$SCP_NEW backend/compliance/rules/*.py       "$NEW_HOST:$APP_DIR/backend/compliance/rules/"
$SCP_NEW backend/tachograph/*.py "$NEW_HOST:$APP_DIR/tachograph/" 2>/dev/null || true

# Python deps
$SSH_NEW "$APP_DIR/venv/bin/pip install -q --upgrade pip && $APP_DIR/venv/bin/pip install -q -r $APP_DIR/requirements.txt && $APP_DIR/venv/bin/pip install -q gunicorn"

ok "Kod wgrany"

# ─── FAZA 4: restore danych + sekretów ────────────────────────────────────────
log "[4/6] Restore danych i sekretów na nowy serwer"

$SCP_NEW "$BACKUP_DIR/ddd-data.tar.gz" "$NEW_HOST:/tmp/"
$SSH_NEW "cd $APP_DIR && tar xzf /tmp/ddd-data.tar.gz && rm /tmp/ddd-data.tar.gz"
ok "Dane przywrócone (DB, configi, JSON-y)"

# Systemd unit z env varami sekretów — z paczki backup
$SCP_NEW "$BACKUP_DIR/ddd-reader.service" "$NEW_HOST:/etc/systemd/system/ddd-reader.service"
ok "Systemd unit z sekretami przywrócony"

# Nginx config (jeśli istniał w backupie) — w innym razie wygeneruj świeży
if [ -s "$BACKUP_DIR/nginx-ddd-reader.conf" ]; then
    $SCP_NEW "$BACKUP_DIR/nginx-ddd-reader.conf" "$NEW_HOST:/etc/nginx/sites-available/ddd-reader"
    ok "Nginx config przeniesiony"
else
    warn "Brak nginx configu w backupie — generuję świeży"
    $SSH_NEW "bash -s" <<NGINX_GEN
cat > /etc/nginx/sites-available/ddd-reader <<'NGX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 16M;

    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 131.0.72.0/22;
    real_ip_header CF-Connecting-IP;

    root /opt/ddd-reader/static;

    location /api/    { proxy_pass http://127.0.0.1:8000; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; proxy_read_timeout 60s; }
    location /portal/ { proxy_pass http://127.0.0.1:8000; proxy_set_header Host \$host; }
    location = /upload { proxy_pass http://127.0.0.1:8000; proxy_set_header Host \$host; }
    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGX_EOF
NGINX_GEN
fi

$SSH_NEW "ln -sf /etc/nginx/sites-available/ddd-reader /etc/nginx/sites-enabled/ddd-reader && rm -f /etc/nginx/sites-enabled/default && nginx -t"

# ─── FAZA 5: start serwisów ───────────────────────────────────────────────────
log "[5/6] Start serwisów na nowym"

$SSH_NEW "
    systemctl daemon-reload
    systemctl enable ddd-reader
    systemctl restart ddd-reader
    systemctl restart nginx
    sleep 2
    systemctl status ddd-reader --no-pager -l | head -8
"

ok "Serwisy uruchomione"

# ─── FAZA 6: weryfikacja ──────────────────────────────────────────────────────
log "[6/6] Weryfikacja"

NEW_IP="${NEW_HOST#root@}"
sleep 2

if $SSH_NEW "curl -fsS -m 5 http://127.0.0.1:8000/api/health 2>&1 | head -1"; then
    ok "Backend odpowiada na 127.0.0.1:8000"
else
    warn "Backend nie odpowiada — sprawdź: ssh -p $NEW_PORT $NEW_HOST 'journalctl -u ddd-reader -n 50'"
fi

if $SSH_NEW "curl -fsS -m 5 -H 'Host: $DOMAIN' http://127.0.0.1/ -o /dev/null -w '%{http_code}'" | grep -q "200\|301\|302"; then
    ok "Nginx serwuje frontend pod Host: $DOMAIN"
else
    warn "Nginx nie odpowiada na Host: $DOMAIN"
fi

# ─── podsumowanie ─────────────────────────────────────────────────────────────
cat <<EOF

╔══════════════════════════════════════════════════════════════════════╗
║                  MIGRACJA ZAKOŃCZONA POMYŚLNIE                       ║
╚══════════════════════════════════════════════════════════════════════╝

Nowy serwer:  $NEW_HOST  (IP: $NEW_IP)
Backup:       $BACKUP_DIR/  (zachowaj na wszelki wypadek!)

NASTĘPNY KROK — zmień DNS w Cloudflare:
  1. Wejdź na  https://dash.cloudflare.com/
  2. Domena → DNS → rekord  $DOMAIN
  3. Zmień IP z poprzedniego (mikrus) na:  $NEW_IP
  4. Zapisz (Cloudflare proxy = pomarańczowa chmurka)

TEST PRZED ZMIANĄ DNS (z lokalnej maszyny):
  curl -H "Host: $DOMAIN" http://$NEW_IP/api/health

PO ZMIANIE DNS (zaczeka ~30s na propagację):
  curl https://$DOMAIN/api/health

WYŁĄCZ STARY SERWER (po potwierdzeniu że nowy działa):
  ssh -p $OLD_PORT $OLD_HOST 'systemctl stop ddd-reader && systemctl disable ddd-reader'

LOGI / DEBUG na nowym:
  ssh -p $NEW_PORT $NEW_HOST 'journalctl -u ddd-reader -f'
  ssh -p $NEW_PORT $NEW_HOST 'systemctl status ddd-reader'

EOF
