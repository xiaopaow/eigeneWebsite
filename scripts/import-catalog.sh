#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "Usage: $0 migration/YYYYMMDDTHHMMSSZ" >&2
  exit 2
fi

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE=$(CDPATH= cd -- "$1" && pwd)
cd "$ROOT_DIR"

(cd "$SOURCE" && sha256sum -c SHA256SUMS)
COUNT=$(docker compose exec -T db psql -U patchreach -d patchreach -Atc 'SELECT COUNT(*) FROM products')
if [ "$COUNT" != "0" ]; then
  echo "Refusing import: production products table is not empty ($COUNT rows)." >&2
  exit 1
fi

docker compose exec -T db psql -v ON_ERROR_STOP=1 -U patchreach -d patchreach < "$SOURCE/products.sql"
docker compose exec -T app sh -c 'rm -rf /app/uploads/* && tar -xzf - -C /app/uploads' < "$SOURCE/uploads.tar.gz"

echo "Catalog import complete. Orders and inquiries were not imported."
