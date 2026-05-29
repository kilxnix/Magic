#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/deckreps/backups}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-app}"
VOLUME_NAME="${VOLUME_NAME:-${COMPOSE_PROJECT_NAME}_magic-brains-runtime}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"

docker run --rm \
  -v "${VOLUME_NAME}:/runtime:ro" \
  -v "${BACKUP_DIR}:/backup" \
  alpine:3.20 \
  tar -czf "/backup/deckreps-runtime-${STAMP}.tar.gz" -C /runtime .

find "$BACKUP_DIR" -name 'deckreps-runtime-*.tar.gz' -mtime +14 -delete

echo "Created ${BACKUP_DIR}/deckreps-runtime-${STAMP}.tar.gz"
