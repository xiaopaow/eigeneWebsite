#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "FAIL: .env does not exist. Copy .env.example and configure it." >&2
  exit 1
fi

value() {
  sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r'
}

fail=0
require_value() {
  name="$1"
  current=$(value "$name")
  if [ -z "$current" ] || echo "$current" | grep -Eqi 'example\.com|change-this|replace-with|your-domain'; then
    echo "FAIL: $name is missing or still contains a placeholder." >&2
    fail=1
  else
    echo "OK: $name is configured."
  fi
}

require_value APP_URL
require_value POSTGRES_PASSWORD
require_value JWT_SECRET
require_value ADMIN_EMAIL
require_value ADMIN_PASSWORD
require_value INQUIRY_TO_EMAIL
require_value SMTP_HOST
require_value SMTP_FROM
require_value CLOUDFLARE_TUNNEL_TOKEN

case "$(value APP_URL)" in
  https://*) ;;
  *) echo "FAIL: APP_URL must use https:// in production." >&2; fail=1 ;;
esac

if [ "$(value PAYPAL_ENV)" = "live" ]; then
  require_value PAYPAL_CLIENT_ID
  require_value PAYPAL_CLIENT_SECRET
  require_value PAYPAL_WEBHOOK_ID
fi

if grep -Rqs 'REPLACE_BEFORE_LAUNCH' public/*.html; then
  echo "FAIL: public policy pages still contain REPLACE_BEFORE_LAUNCH markers." >&2
  fail=1
fi

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "FAIL: .env is tracked by Git." >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "Production preflight failed." >&2
  exit 1
fi

echo "Production configuration preflight passed. No secret values were printed."
