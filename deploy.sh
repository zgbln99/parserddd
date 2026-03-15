#!/bin/bash
# =============================================================================
# Skrypt deploymentu aplikacji DDD Reader
# Uzycie: ./deploy.sh <user@host> <port_ssh>
#
# Przyklad:
#   ./deploy.sh root@srv15.mikr.us 12345
#
# Aplikacja dostepna przez Cloudflare na dd.ltslog.de
# Nginx serwuje statyczny frontend + proxy API do Gunicorn
# =============================================================================

set -e

if [ "$#" -lt 2 ]; then
    echo "Uzycie: $0 <user@host> <port_ssh>"
    echo ""
    echo "Przyklad: $0 root@srv15.mikr.us 12345"
    exit 1
fi

REMOTE="$1"
SSH_PORT="$2"
APP_DIR="/opt/ddd-reader"

SSH_CMD="ssh -p $SSH_PORT $REMOTE"
SCP_CMD="scp -P $SSH_PORT"

# ---------------------------------------------------------------------------
# [1/7] Build frontend locally
# ---------------------------------------------------------------------------
echo "=== [1/7] Budowanie frontendu ==="
(cd frontend && npm ci --silent && npm run build)
echo "Frontend zbudowany."

# ---------------------------------------------------------------------------
# [2/7] Upload files
# ---------------------------------------------------------------------------
echo "=== [2/7] Przesylanie plikow na serwer ==="
$SSH_CMD "mkdir -p $APP_DIR/static"

# Backend files
$SCP_CMD backend/app.py backend/samsara_sync.py backend/requirements.txt "$REMOTE:$APP_DIR/"

# Frontend build
$SCP_CMD -r frontend/dist/* "$REMOTE:$APP_DIR/static/"

echo "Pliki przeslane."

# ---------------------------------------------------------------------------
# [3/7] Install system dependencies
# ---------------------------------------------------------------------------
echo "=== [3/7] Instalacja zaleznosci systemowych ==="
$SSH_CMD "bash -s" <<'REMOTE_SCRIPT'
set -e
export DEBIAN_FRONTEND=noninteractive

if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq python3 python3-pip python3-venv golang-go git nginx > /dev/null 2>&1 || true
elif command -v apk &>/dev/null; then
    apk update
    apk add python3 py3-pip go git nginx
fi
echo "Zaleznosci systemowe zainstalowane."
REMOTE_SCRIPT

# ---------------------------------------------------------------------------
# [4/7] Build dddparser
# ---------------------------------------------------------------------------
echo "=== [4/7] Budowanie dddparser na serwerze ==="
$SSH_CMD "bash -s" <<'REMOTE_SCRIPT'
set -e
if [ -f /usr/local/bin/dddparser ]; then
    echo "dddparser juz istnieje, pomijam budowanie."
else
    TMPDIR=$(mktemp -d)
    cd "$TMPDIR"
    git clone --depth 1 https://github.com/traconiq/tachoparser.git
    cd tachoparser
    mkdir -p internal/pkg/certificates/pks1 internal/pkg/certificates/pks2
    touch internal/pkg/certificates/pks1/dummy.bin internal/pkg/certificates/pks2/dummy.bin
    go build -o /usr/local/bin/dddparser ./cmd/dddparser/
    cd /
    rm -rf "$TMPDIR"
    echo "dddparser zbudowany pomyslnie."
fi
REMOTE_SCRIPT

# ---------------------------------------------------------------------------
# [5/7] Python venv + deps
# ---------------------------------------------------------------------------
echo "=== [5/7] Konfiguracja srodowiska Python ==="
$SSH_CMD "bash -s" <<REMOTE_SCRIPT
set -e
cd "$APP_DIR"
if [ ! -d venv ]; then
    python3 -m venv venv
fi
./venv/bin/pip install -q -r requirements.txt
echo "Srodowisko Python gotowe."
REMOTE_SCRIPT

# ---------------------------------------------------------------------------
# [6/7] systemd + nginx
# ---------------------------------------------------------------------------
echo "=== [6/7] Konfiguracja systemd + nginx ==="
$SSH_CMD "bash -s" <<'REMOTE_SCRIPT'
set -e
APP_DIR="/opt/ddd-reader"

# Flask secret key (jednorazowo)
if [ ! -f "$APP_DIR/.flask_secret" ]; then
    python3 -c "import secrets; print(secrets.token_hex(32))" > "$APP_DIR/.flask_secret"
fi
FLASK_SECRET=$(cat "$APP_DIR/.flask_secret")

# Serwis systemd — Gunicorn serves API + SPA fallback
cat > /etc/systemd/system/ddd-reader.service <<EOF
[Unit]
Description=DDD Driver Card Reader
After=network.target

[Service]
User=root
WorkingDirectory=/opt/ddd-reader
ExecStart=/opt/ddd-reader/venv/bin/gunicorn --bind 127.0.0.1:8000 --workers 2 --timeout 60 app:app
Environment=DDDPARSER_PATH=/usr/local/bin/dddparser
Environment=FLASK_SECRET_KEY=$FLASK_SECRET
Environment=SAMSARA_API_TOKEN=$SAMSARA_TOKEN
Environment=DROPBOX_REFRESH_TOKEN=$DROPBOX_REFRESH_TOKEN
Environment=PORTAL_PASSWORD=$PORTAL_PASSWORD
Environment=FRONTEND_DIR=/opt/ddd-reader/static
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Nginx — serwuje statyczny frontend + proxy API
cat > /etc/nginx/sites-available/ddd-reader <<'NGINX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name dd.ltslog.de;

    client_max_body_size 16M;

    # Cloudflare real IP
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

    # API i stare endpointy -> Flask
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Backward compat: old portal/upload endpoints
    location /portal/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /upload {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Static assets (JS/CSS/images) — cache aggressively
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # SPA fallback: all other routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX_EOF

mkdir -p /etc/nginx/sites-enabled
ln -sf /etc/nginx/sites-available/ddd-reader /etc/nginx/sites-enabled/ddd-reader
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable ddd-reader
systemctl restart ddd-reader
nginx -t && systemctl restart nginx

echo "Uslugi uruchomione pomyslnie."
REMOTE_SCRIPT

# ---------------------------------------------------------------------------
# [7/7] Verify
# ---------------------------------------------------------------------------
echo "=== [7/7] Weryfikacja ==="
$SSH_CMD "systemctl status ddd-reader --no-pager -l | head -15"

echo ""
echo "=========================================="
echo " Deployment zakonczony!"
echo "=========================================="
echo ""
echo " https://dd.ltslog.de"
echo ""
echo " Komendy serwisowe (przez SSH):"
echo "   systemctl status ddd-reader"
echo "   systemctl restart ddd-reader"
echo "   journalctl -u ddd-reader -f"
echo "=========================================="
