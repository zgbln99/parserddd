#!/bin/bash
# =============================================================================
# Aktualizacja aplikacji "ddd parser" na serwerze.
#  - pobiera najnowszy kod z galezi,
#  - wykrywa Pythona i (jesli trzeba) doinstalowuje zaleznosci,
#  - zaklada/odswieza usluge systemd (czysty restart + autostart),
#  - restartuje i weryfikuje (HTTP + polaczenie z Samsara).
#
# Uzycie (z katalogu aplikacji):
#   ./update.sh                # galaz domyslna
#   ./update.sh <branch>       # inna galaz
#
# Gunicorn jest uruchamiany jako MODUL Pythona (python -c "... wsgiapp ...")
# zamiast przez skrypt konsolowy — dziala niezaleznie od tego, czy i gdzie
# istnieje plik /usr/local/bin/gunicorn (to powodowalo blad 203/EXEC).
#
# Cala logika jest w main(), zeby bash sparsowal ja w calosci PRZED
# wykonaniem (git reset w trakcie nie psuje dzialajacego skryptu).
# =============================================================================
set -e

main() {
    BRANCH="${1:-claude/youthful-bardeen-4zn5jw}"
    APP_DIR="$(cd "$(dirname "$0")" && pwd)"
    PORT="${PORT:-8000}"
    SERVICE="ddd-reader"
    cd "$APP_DIR"

    echo "== [1/5] Pobieranie kodu ($BRANCH) =="
    git fetch origin "$BRANCH"
    git reset --hard "origin/$BRANCH"     # nie rusza .env ani *.db (nieśledzone)

    echo "== [2/5] Python + zaleznosci =="
    # Najpierw szukamy interpretera, ktory JUZ ma pakiety (np. ten, ktory dzialal
    # wczesniej: /usr/local/bin/python3.12). Dopiero potem instalujemy.
    PYTHON=""
    for cand in \
        "$APP_DIR/venv/bin/python" \
        /usr/local/bin/python3.12 /usr/local/bin/python3 \
        python3.12 python3 python \
        /usr/bin/python3.12 /usr/bin/python3 ; do
        p="$(command -v "$cand" 2>/dev/null || true)"
        [ -n "$p" ] || continue
        if "$p" -c 'import gunicorn, flask, dropbox' 2>/dev/null; then PYTHON="$p"; break; fi
    done

    # Brak gotowego interpretera -> zrob izolowany virtualenv (zalecane przy
    # externally-managed-environment; omija konflikt z debianowym blinker).
    if [ -z "$PYTHON" ]; then
        BASEPY="$(command -v python3.12 || command -v python3 || echo python3)"
        echo "Tworze virtualenv w $APP_DIR/venv (baza: $BASEPY) ..."
        "$BASEPY" -m venv "$APP_DIR/venv" 2>/dev/null \
          || "$BASEPY" -m venv --system-site-packages "$APP_DIR/venv" 2>/dev/null || true
        if [ -x "$APP_DIR/venv/bin/python" ]; then
            "$APP_DIR/venv/bin/python" -m pip install -q --upgrade pip 2>/dev/null || true
            "$APP_DIR/venv/bin/python" -m pip install -q -r requirements.txt gunicorn || true
            "$APP_DIR/venv/bin/python" -c 'import gunicorn, flask, dropbox' 2>/dev/null \
              && PYTHON="$APP_DIR/venv/bin/python"
        fi
    fi

    # Awaryjnie: instalacja systemowa z pominieciem konfliktu (debianowy blinker).
    if [ -z "$PYTHON" ]; then
        BASEPY="$(command -v python3.12 || command -v python3 || echo python3)"
        echo "venv niedostepny — instaluje systemowo (--break-system-packages --ignore-installed):"
        "$BASEPY" -m pip install --break-system-packages --ignore-installed -r requirements.txt gunicorn || true
        "$BASEPY" -c 'import gunicorn, flask, dropbox' 2>/dev/null && PYTHON="$BASEPY"
    fi

    if ! "$PYTHON" -c 'import gunicorn, flask, dropbox' 2>/dev/null; then
        echo "!! BLAD: nie znalazlem Pythona z gunicorn/flask/dropbox. Diagnostyka:"
        for p in /usr/local/bin/python3.12 /usr/local/bin/python3 /usr/bin/python3.12 /usr/bin/python3; do
            [ -x "$p" ] || continue
            printf "   %s : " "$p"; "$p" -c 'import gunicorn,flask,dropbox; print("MA wszystkie")' 2>&1 | head -1
        done
        echo "   pip: $("$PYTHON" -m pip --version 2>&1 | head -1)"
        echo "   Wklej te linie — dobiore wlasciwy interpreter albo poprawie instalacje."
        exit 1
    fi
    echo "Python: $PYTHON"

    echo "== [3/5] Usluga systemd ($SERVICE) =="
    cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=DDD Reader (parserddd)
After=network.target
StartLimitIntervalSec=0

[Service]
User=root
WorkingDirectory=${APP_DIR}
ExecStart=${PYTHON} -c "from gunicorn.app.wsgiapp import run; run()" --bind 0.0.0.0:${PORT} --workers 2 --timeout 120 app:app
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    echo "== [4/5] Restart =="
    pkill -f 'gunicorn.*app:app' 2>/dev/null || true     # ewentualny recznie odpalony gunicorn
    sleep 1
    systemctl daemon-reload
    systemctl reset-failed "$SERVICE" 2>/dev/null || true
    systemctl enable "$SERVICE" >/dev/null 2>&1 || true
    systemctl restart "$SERVICE"
    sleep 2

    echo "== [5/5] Weryfikacja =="
    systemctl --no-pager -l status "$SERVICE" | head -6 || true
    if ! systemctl is-active --quiet "$SERVICE"; then
        echo "!! Usluga nie wstala — ostatnie logi:"
        journalctl -u "$SERVICE" -n 20 --no-pager || true
    fi
    echo "--- Samsara (localhost:${PORT}) ---"
    curl -sS "localhost:${PORT}/api/track/samsara/check" 2>&1 | head -3 || true
    echo ""
    echo ""
    echo "Gotowe. Panel sledzenia: /tracking  (przycisk 'Nowy link' -> wybierz pojazd z Samsary)"
    echo "Kolejne aktualizacje: ./update.sh"
}

main "$@"
