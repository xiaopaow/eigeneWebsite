#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="migration/$STAMP"
mkdir -p "$TARGET"

docker compose exec -T db pg_dump -U patchreach -d patchreach \
  --data-only --table=products --column-inserts > "$TARGET/products.sql"
docker compose exec -T app tar -czf - -C /app/uploads . > "$TARGET/uploads.tar.gz"
(cd "$TARGET" && sha256sum products.sql uploads.tar.gz > SHA256SUMS)

echo "Catalog export created at $TARGET"
echo "It contains products and uploads only; orders and inquiries are excluded."
