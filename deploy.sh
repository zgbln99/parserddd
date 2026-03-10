#!/bin/bash
# =============================================================================
# Skrypt deploymentu aplikacji DDD Reader na VPS mikr.us
# Uzycie: ./deploy.sh <user@host> <port_ssh> <port_http>
#
# Przyklad:
#   ./deploy.sh root@srv15.mikr.us 12345 20080
#
# Parametry:
#   user@host  - uzytkownik i adres VPS (np. root@srv15.mikr.us)
#   port_ssh   - port SSH do polaczenia
#   port_http  - port przekierowany na mikr.us na ktory trafi ruch HTTP
# =============================================================================

set -e

if [ "$#" -lt 3 ]; then
    echo "Uzycie: $0 <user@host> <port_ssh> <port_http>"
    echo ""
    echo "Przyklad: $0 root@srv15.mikr.us 12345 20080"
    echo ""
    echo "  port_ssh  - port SSH z maila powitalnego mikr.us"
    echo "  port_http - port przekierowany z IPv4 (z panelu mikr.us)"
    exit 1
fi

REMOTE="$1"
SSH_PORT="$2"
HTTP_PORT="$3"
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

# Wykryj menedzera pakietow
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
APP_DIR="/opt/ddd-reader"

if [ -f /usr/local/bin/dddparser ]; then
    echo "dddparser juz istnieje, pomijam budowanie."
else
    TMPDIR=$(mktemp -d)
    cd "$TMPDIR"
    git clone --depth 1 https://github.com/traconiq/tachoparser.git
    cd tachoparser

    # Minimalne pliki certyfikatow (sygnatury nie beda weryfikowane)
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
APP_DIR="/opt/ddd-reader"
cd "\$APP_DIR"

if [ ! -d venv ]; then
    python3 -m venv venv
fi
./venv/bin/pip install -q flask gunicorn
echo "Srodowisko Python gotowe."
REMOTE_SCRIPT

echo "=== [5/6] Konfiguracja systemd + nginx ==="
$SSH_CMD "bash -s $HTTP_PORT" <<'REMOTE_SCRIPT'
set -e
HTTP_PORT="$1"
APP_DIR="/opt/ddd-reader"

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
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Konfiguracja nginx
cat > /etc/nginx/sites-available/ddd-reader <<EOF
server {
    listen ${HTTP_PORT};
    listen [::]:80;

    client_max_body_size 16M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Wlacz konfiguracje nginx
mkdir -p /etc/nginx/sites-enabled
ln -sf /etc/nginx/sites-available/ddd-reader /etc/nginx/sites-enabled/ddd-reader

# Usun domyslna konfiguracje jesli istnieje
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
echo " Deployment zakonczony pomyslnie!"
echo "=========================================="
echo ""
echo " Aplikacja dostepna pod adresem:"
echo "   http://${REMOTE#*@}:${HTTP_PORT}"
echo ""
echo " Jesli masz subdomene mikr.us:"
echo "   https://twoja-subdomena.mikr.us"
echo ""
echo " Komendy serwisowe (przez SSH):"
echo "   systemctl status ddd-reader"
echo "   systemctl restart ddd-reader"
echo "   journalctl -u ddd-reader -f"
echo "=========================================="
