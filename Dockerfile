# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS web-build

WORKDIR /app

COPY engine/package*.json ./engine/
WORKDIR /app/engine
RUN npm ci
COPY engine ./
RUN npm run build

WORKDIR /app
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend ./

ARG VITE_ENABLE_ADS=false
ARG VITE_REQUIRE_AD_CONSENT=true
ARG VITE_SHOW_AD_PLACEHOLDERS=false
ARG VITE_ADSENSE_CLIENT_ID=
ARG VITE_ADSENSE_SLOT_LEADERBOARD=
ARG VITE_ADSENSE_SLOT_MOBILE_BANNER=
ARG VITE_ADSENSE_SLOT_SIDEBAR=
ARG VITE_ADSENSE_TEST=false
ARG VITE_SHELECTOR_API_BASE=/shelector-api
ARG VITE_SUPPORT_EMAIL=support@deckreps.app
ARG VITE_DONATION_URL=
ARG ADS_TXT_PUBLISHER_ID=

ENV VITE_ENABLE_ADS=${VITE_ENABLE_ADS}
ENV VITE_REQUIRE_AD_CONSENT=${VITE_REQUIRE_AD_CONSENT}
ENV VITE_SHOW_AD_PLACEHOLDERS=${VITE_SHOW_AD_PLACEHOLDERS}
ENV VITE_ADSENSE_CLIENT_ID=${VITE_ADSENSE_CLIENT_ID}
ENV VITE_ADSENSE_SLOT_LEADERBOARD=${VITE_ADSENSE_SLOT_LEADERBOARD}
ENV VITE_ADSENSE_SLOT_MOBILE_BANNER=${VITE_ADSENSE_SLOT_MOBILE_BANNER}
ENV VITE_ADSENSE_SLOT_SIDEBAR=${VITE_ADSENSE_SLOT_SIDEBAR}
ENV VITE_ADSENSE_TEST=${VITE_ADSENSE_TEST}
ENV VITE_SHELECTOR_API_BASE=${VITE_SHELECTOR_API_BASE}
ENV VITE_SUPPORT_EMAIL=${VITE_SUPPORT_EMAIL}
ENV VITE_DONATION_URL=${VITE_DONATION_URL}

RUN npm run build

RUN if [ -n "$ADS_TXT_PUBLISHER_ID" ]; then \
      printf "google.com, %s, DIRECT, f08c47fec0942fa0\n" "$ADS_TXT_PUBLISHER_ID" > /app/frontend/dist/ads.txt; \
    fi

FROM python:3.11-slim AS app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV MAGIC_DB_DIR=/app/runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.prod.txt ./
RUN pip install --no-cache-dir -r requirements.prod.txt

COPY backend ./backend
COPY data ./data
COPY mtg_data ./mtg_data
COPY --from=web-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/runtime

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=5)"

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*' --no-access-log"]
