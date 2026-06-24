#!/bin/bash
# =============================================================================
# Aktualizacja aplikacji "ddd parser" na serwerze.
#  - pobiera najnowszy kod z galezi,
#  - zaklada/odswieza usluge systemd (czysty restart + autostart po reboocie),
#  - restartuje i weryfikuje (HTTP + polaczenie z Samsara).
#
# Uzycie (z katalogu aplikacji):
#   ./update.sh                # galaz domyslna
#   ./update.sh <branch>       # inna galaz
#
# Cala logika jest w funkcji main(), zeby bash sparsowal ja w calosci PRZED
# wykonaniem — dzieki temu "git reset" w trakcie nie psuje dzialania skryptu.
# =============================================================================
set -e

main() {
    BRANCH="${1:-claude/youthful-bardeen-4zn5jw}"
    APP_DIR="$(cd "$(dirname "$0")" && pwd)"
    GUNICORN="$(command -v gunicorn || echo /usr/local/bin/gunicorn)"
    PORT="${PORT:-8000}"
    SERVICE="ddd-reader"

    cd "$APP_DIR"

    echo "== [1/4] Pobieranie kodu ($BRANCH) =="
    git fetch origin "$BRANCH"
    git reset --hard "origin/$BRANCH"     # nie rusza .env ani *.db (sa nieśledzone)

    echo "== [2/4] Usluga systemd ($SERVICE) =="
    cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=DDD Reader (parserddd)
After=network.target

[Service]
User=root
WorkingDirectory=${APP_DIR}
ExecStart=${GUNICORN} --bind 0.0.0.0:${PORT} --workers 2 --timeout 120 app:app
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    echo "== [3/4] Restart =="
    # zatrzymaj ewentualnego recznie odpalonego gunicorna (zwolnij port)
    pkill -f "gunicorn.*app:app" 2>/dev/null || true
    sleep 1
    systemctl daemon-reload
    systemctl enable "$SERVICE" >/dev/null 2>&1 || true
    systemctl restart "$SERVICE"
    sleep 2

    echo "== [4/4] Weryfikacja =="
    systemctl --no-pager -l status "$SERVICE" | head -6 || true
    echo "--- Samsara (localhost:${PORT}) ---"
    curl -sS "localhost:${PORT}/api/track/samsara/check" 2>&1 | head -3 || true
    echo ""
    echo ""
    echo "Gotowe. Panel sledzenia: /tracking  (przycisk 'Nowy link' -> wybierz pojazd z Samsary)"
    echo "Kolejne aktualizacje: ./update.sh"
}

main "$@"
