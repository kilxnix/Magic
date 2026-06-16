#!/usr/bin/env bash
# Weekly automatic card-database refresh for deckreps.app.
#
# Runs the full Scryfall data pipeline (bulk download -> extract -> flavor
# names -> draft pools -> embeddings -> FAISS index) inside a one-off app
# container with the host mtg_data mounted, verifies the artifacts are in
# sync, then rebuilds and restarts the web/shelector services. On any
# failure the previous artifacts are restored and the services are left
# untouched.
#
# Installed at /opt/deckreps/refresh_cards.sh, scheduled via root crontab.
# Logs: /opt/deckreps/refresh_cards.log
set -u

APP_DIR=/opt/deckreps/app
DATA_DIR=$APP_DIR/mtg_data
BACKUP_DIR=$DATA_DIR/backup_prev
LOCK_FILE=/tmp/deckreps_refresh_cards.lock
LOG_FILE=/opt/deckreps/refresh_cards.log
IMAGE=magic-brains:latest
ARTIFACTS="cards_min.jsonl card_embeddings.npy card_embeddings_meta.json card_index.faiss flavor_names.json draft_cards.jsonl"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*" >> "$LOG_FILE"; }

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "SKIP: previous refresh still running"
  exit 0
fi

log "=== card data refresh started ==="

run_step() {
  local step="$1"
  log "step: $step"
  docker run --rm \
    -v "$DATA_DIR":/app/mtg_data \
    "$IMAGE" python -m data.data_pipeline $step --force >> "$LOG_FILE" 2>&1
}

# Backup current artifacts (only the deployable ones; bulk JSONs are scratch).
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
for f in $ARTIFACTS; do
  [ -f "$DATA_DIR/$f" ] && cp "$DATA_DIR/$f" "$BACKUP_DIR/$f"
done

restore_backup() {
  log "RESTORING previous artifacts"
  for f in $ARTIFACTS; do
    [ -f "$BACKUP_DIR/$f" ] && cp "$BACKUP_DIR/$f" "$DATA_DIR/$f"
  done
}

for step in "download" "download-default" "sets" "extract" "extract-flavors" "extract-draft" "embed" "index"; do
  if ! run_step "$step"; then
    log "FAILED at step: $step"
    restore_backup
    exit 1
  fi
done

# Verify cards / embeddings / index are in sync before deploying.
if ! docker run --rm -v "$DATA_DIR":/app/mtg_data "$IMAGE" python -c "
import json, numpy as np, faiss
cards = sum(1 for l in open('mtg_data/cards_min.jsonl', encoding='utf-8') if l.strip())
emb = np.load('mtg_data/card_embeddings.npy', mmap_mode='r')
idx = faiss.read_index('mtg_data/card_index.faiss')
meta = json.load(open('mtg_data/card_embeddings_meta.json'))
assert cards == emb.shape[0] == idx.ntotal == len(meta['ids']), (cards, emb.shape, idx.ntotal, len(meta['ids']))
assert cards > 30000, f'suspiciously few cards: {cards}'
flavors = json.load(open('mtg_data/flavor_names.json'))
assert len(flavors) > 100, f'suspiciously few flavor names: {len(flavors)}'
print(f'sync OK: {cards} cards, {len(flavors)} flavor names')
" >> "$LOG_FILE" 2>&1; then
  log "FAILED: artifact sync verification"
  restore_backup
  exit 1
fi

# Rebuild the image (mtg_data is baked in) and restart services.
cd "$APP_DIR" || exit 1
if ! docker compose build web >> "$LOG_FILE" 2>&1; then
  log "FAILED: docker compose build"
  restore_backup
  exit 1
fi
docker compose up -d web shelector >> "$LOG_FILE" 2>&1

for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/health || true)
  if [ "$code" = "200" ]; then
    log "=== refresh complete, health 200 ==="
    exit 0
  fi
  sleep 10
done

log "FAILED: health check after restart — rolling back data and rebuilding"
restore_backup
docker compose build web >> "$LOG_FILE" 2>&1
docker compose up -d web shelector >> "$LOG_FILE" 2>&1
exit 1
