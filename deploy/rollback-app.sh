#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/deckreps/app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/deckreps/backups}"
ARCHIVE="${BACKUP_ARCHIVE:-}"

if [[ -z "$ARCHIVE" ]]; then
  ARCHIVE="$(ls -1t "${BACKUP_DIR}"/deckreps-app-*.tar.gz 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "No app backup archive found. Set BACKUP_ARCHIVE=/path/to/deckreps-app-*.tar.gz" >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/docker-compose.yml" ]]; then
  echo "${APP_DIR} does not look like the DeckReps app directory" >&2
  exit 1
fi

FAILED_DIR="${APP_DIR}.failed-$(date -u +%Y%m%dT%H%M%SZ)"

cd "$APP_DIR"
docker compose down
cd "$(dirname "$APP_DIR")"
mv "$APP_DIR" "$FAILED_DIR"
tar xzf "$ARCHIVE"
cd "$APP_DIR"
docker compose up -d --build

echo "Rolled back to ${ARCHIVE}"
echo "Failed release moved to ${FAILED_DIR}"
