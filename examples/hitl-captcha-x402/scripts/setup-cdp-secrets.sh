#!/usr/bin/env bash
# Upload CDP facilitator secrets to the hitl-captcha-x402 worker.
#
# Uses EXISTING credentials from the Cloud Agents dashboard — does NOT create
# new wallets or API keys.
#
# Required env (from Cursor Cloud / dashboard):
#   CDP_KEY_ID          Secret API key ID (organizations/.../apiKeys/...)
#   CDP_KEY_SECRET      Secret API key PEM (-----BEGIN EC PRIVATE KEY-----)
#   SERVER_ADDRESS      Legacy external payment wallet (NOT a new CDP server wallet)
#
# Optional:
#   NTFY_TOPIC          ntfy.sh topic for mobile alerts
#
# The CDP SDK requires PKCS#8 format (BEGIN PRIVATE KEY). Portal downloads often
# use EC format (BEGIN EC PRIVATE KEY) — this script converts automatically.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

: "${CDP_KEY_ID:?Set CDP_KEY_ID}"
: "${CDP_KEY_SECRET:?Set CDP_KEY_SECRET}"
: "${SERVER_ADDRESS:?Set SERVER_ADDRESS (legacy payment wallet)}"

command -v openssl >/dev/null || { echo "openssl required"; exit 1; }

PEM_FILE="$(mktemp)"
PKCS8_FILE="$(mktemp)"
trap 'rm -f "$PEM_FILE" "$PKCS8_FILE"' EXIT

printf '%s' "$CDP_KEY_SECRET" >"$PEM_FILE"
openssl pkcs8 -topk8 -nocrypt -in "$PEM_FILE" -out "$PKCS8_FILE"

cd "$ROOT"

printf '%s' "$CDP_KEY_ID" | pnpm exec wrangler secret put CDP_API_KEY_ID
cat "$PKCS8_FILE" | pnpm exec wrangler secret put CDP_API_KEY_SECRET
printf '%s' "$SERVER_ADDRESS" | pnpm exec wrangler secret put SERVER_ADDRESS

if [[ -n "${NTFY_TOPIC:-}" ]]; then
  pnpm exec wrangler deploy --var "NTFY_TOPIC:${NTFY_TOPIC}"
else
  pnpm exec wrangler deploy
fi

echo
echo "Secrets uploaded. Legacy payment wallet: $SERVER_ADDRESS"
echo "Verify: curl -X POST https://<worker>/api/solve-captcha -H 'Content-Type: application/json' -d '{\"url\":\"https://example.com\"}'"
echo "Expect HTTP 402 with network eip155:8453 and payTo=$SERVER_ADDRESS"
