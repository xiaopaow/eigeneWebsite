#!/usr/bin/env sh
set -eu

docker compose ps
docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health
echo
docker compose exec -T nginx wget -qO- http://127.0.0.1/api/health
echo
echo "Container health checks passed."
