#!/bin/bash
# =============================================================================
# Skrypt deploymentu aplikacji DDD Reader
# Uzycie: ./deploy.sh <user@host> <port_ssh>
#
# Przyklad:
#   ./deploy.sh root@srv15.mikr.us 12345
#
# Aplikacja bedzie dostepna przez Cloudflare na ddd.ltslog.de
# Nginx slucha na porcie 80, Cloudflare zapewnia SSL
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

echo "=== [1/6] Przesylanie plikow na serwer ==="
$SSH_CMD "mkdir -p $APP_DIR/templates"
$SCP_CMD app.py requirements.txt setup.sh "$REMOTE:$APP_DIR/"
$SCP_CMD templates/index.html "$REMOTE:$APP_DIR/templates/"

echo "=== [2/6] Instalacja zaleznosci systemowych ==="
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

echo "=== [3/6] Budowanie dddparser na serwerze ==="
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

echo "=== [4/6] Konfiguracja srodowiska Python ==="
$SSH_CMD "bash -s" <<REMOTE_SCRIPT
set -e
cd "$APP_DIR"
if [ ! -d venv ]; then
    python3 -m venv venv
fi
./venv/bin/pip install -q -r requirements.txt
echo "Srodowisko Python gotowe."
REMOTE_SCRIPT

echo "=== [5/6] Konfiguracja systemd + nginx ==="
$SSH_CMD "bash -s" <<'REMOTE_SCRIPT'
set -e
APP_DIR="/opt/ddd-reader"

# Generowanie losowego klucza sesji Flask (jednorazowo)
if [ ! -f "$APP_DIR/.flask_secret" ]; then
    python3 -c "import secrets; print(secrets.token_hex(32))" > "$APP_DIR/.flask_secret"
fi
FLASK_SECRET=$(cat "$APP_DIR/.flask_secret")

# Serwis systemd
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
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Konfiguracja nginx dla ddd.ltslog.de (Cloudflare proxy = SSL na Cloudflare)
cat > /etc/nginx/sites-available/ddd-reader <<'NGINX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name ddd.ltslog.de;

    client_max_body_size 16M;

    # Cloudflare real IP headers
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

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
NGINX_EOF

# Wlacz konfiguracje nginx
mkdir -p /etc/nginx/sites-enabled
ln -sf /etc/nginx/sites-available/ddd-reader /etc/nginx/sites-enabled/ddd-reader
rm -f /etc/nginx/sites-enabled/default

# Reload/restart
systemctl daemon-reload
systemctl enable ddd-reader
systemctl restart ddd-reader
nginx -t && systemctl restart nginx

echo "Uslugi uruchomione pomyslnie."
REMOTE_SCRIPT

echo "=== [6/6] Weryfikacja ==="
$SSH_CMD "systemctl status ddd-reader --no-pager -l | head -15"

echo ""
echo "=========================================="
echo " Deployment zakonczony!"
echo "=========================================="
echo ""
echo " Teraz skonfiguruj DNS w Cloudflare:"
echo ""
echo "   Typ:     A"
echo "   Nazwa:   ddd"
echo "   Adres:   <IP twojego serwera>"
echo "   Proxy:   ON (pomaranczowa chmurka)"
echo ""
echo " SSL w Cloudflare > SSL/TLS:"
echo "   Tryb: Flexible (lub Full jesli masz certyfikat)"
echo ""
echo " Po konfiguracji DNS:"
echo "   https://ddd.ltslog.de"
echo ""
echo " Komendy serwisowe (przez SSH):"
echo "   systemctl status ddd-reader"
echo "   systemctl restart ddd-reader"
echo "   journalctl -u ddd-reader -f"
echo "=========================================="
