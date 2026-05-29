#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/deckreps/app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/deckreps/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"

tar \
  --exclude='frontend/node_modules' \
  --exclude='engine/node_modules' \
  --exclude='.git' \
  -czf "${BACKUP_DIR}/deckreps-app-${STAMP}.tar.gz" \
  -C "$(dirname "$APP_DIR")" \
  "$(basename "$APP_DIR")"

find "$BACKUP_DIR" -name 'deckreps-app-*.tar.gz' -mtime +14 -delete

echo "Created ${BACKUP_DIR}/deckreps-app-${STAMP}.tar.gz"
