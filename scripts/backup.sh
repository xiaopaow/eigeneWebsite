#!/usr/bin/env sh
set -eu

MODE="${1:-daily}"
case "$MODE" in
  daily) RETENTION_DAYS=7 ;;
  weekly) RETENTION_DAYS=28 ;;
  monthly) RETENTION_DAYS=93 ;;
  *) echo "Usage: $0 [daily|weekly|monthly]" >&2; exit 2 ;;
esac

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="backups/$MODE/$STAMP"
mkdir -p "$TARGET"

echo "Creating PostgreSQL backup..."
docker compose exec -T db pg_dump -U patchreach -d patchreach -Fc > "$TARGET/database.dump"

echo "Creating upload backup..."
docker compose exec -T app tar -czf - -C /app/uploads . > "$TARGET/uploads.tar.gz"

(cd "$TARGET" && sha256sum database.dump uploads.tar.gz > SHA256SUMS)
find "backups/$MODE" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf {} +

R2_BUCKET=$(sed -n 's/^R2_BUCKET=//p' .env | tail -n 1 | tr -d '\r')
R2_ACCOUNT_ID=$(sed -n 's/^R2_ACCOUNT_ID=//p' .env | tail -n 1 | tr -d '\r')
if [ -n "$R2_BUCKET" ] && [ -n "$R2_ACCOUNT_ID" ]; then
  echo "Syncing encrypted transport to Cloudflare R2..."
  docker compose --profile backup run --rm backup-upload sync /backups "r2:$R2_BUCKET" --checksum
else
  echo "R2 is not configured; backup remains in $TARGET"
fi

echo "Backup complete: $TARGET"
