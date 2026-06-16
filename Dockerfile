# syntax=docker/dockerfile:1
# =============================================================================
#  DDD Reader / FleetView — all-in-one container
#
#  Three build stages:
#    1. frontend  — builds the React/Vite SPA (optional HERE map key baked in)
#    2. dddparser — compiles the Go tachograph parser (traconiq/tachoparser)
#    3. runtime   — Python + Gunicorn serving the API *and* the SPA
#
#  The runtime image needs nothing external except (optionally) a Postgres
#  database. By default it uses an embedded SQLite file under /opt/ddd-reader,
#  which should be a mounted volume so data survives container restarts.
# =============================================================================

# ---- Stage 1: build the React frontend --------------------------------------
FROM node:20-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# HERE map tiles are optional; the key is baked into the static build.
ARG VITE_HERE_API_KEY=""
ENV VITE_HERE_API_KEY=${VITE_HERE_API_KEY}
RUN npm run build

# ---- Stage 2: build the Go dddparser ----------------------------------------
FROM golang:1.22-bookworm AS dddparser
RUN git clone --depth 1 https://github.com/traconiq/tachoparser.git /src
WORKDIR /src
# Signatures aren't verified without real certs; create empty placeholders so
# the build succeeds (matches the existing setup.sh behaviour).
RUN mkdir -p internal/pkg/certificates/pks1 internal/pkg/certificates/pks2 \
    && touch internal/pkg/certificates/pks1/dummy.bin internal/pkg/certificates/pks2/dummy.bin \
    && CGO_ENABLED=0 go build -o /dddparser ./cmd/dddparser/

# ---- Stage 3: runtime -------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DDDPARSER_PATH=/usr/local/bin/dddparser \
    FRONTEND_DIR=/app/frontend/dist \
    FLASK_ENV=production \
    GUNICORN_WORKERS=2

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ /app/backend/
COPY --from=dddparser /dddparser /usr/local/bin/dddparser
COPY --from=frontend /build/dist /app/frontend/dist

# Persistent data (SQLite DB, users.json, caches, …) lives here — mount a volume.
RUN mkdir -p /opt/ddd-reader
VOLUME ["/opt/ddd-reader"]

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/ >/dev/null || exit 1

# WorkingDirectory is /app/backend so `from config/core/auth/routes import …`
# resolve, while `backend.compliance` resolves via its own sys.path shim.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-2} --timeout 120 app:app"]
