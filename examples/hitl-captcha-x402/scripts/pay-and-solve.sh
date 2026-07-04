#!/usr/bin/env bash
# Pay for and trigger POST /api/solve-captcha using CDP CLI + x402 v2.
#
# Required env:
#   CDP_KEY_ID, CDP_KEY_SECRET, CDP_WALLET_SECRET
# Optional env:
#   CDP_URL (default: https://api.cdp.coinbase.com/platform/v2)
#   CDP_BUYER_ACCOUNT (default: agentwire-x402-bazaar-buyer)
#
# Usage:
#   ./scripts/pay-and-solve.sh https://hitl-captcha-x402.example.workers.dev https://accounts.hcaptcha.com/demo

set -euo pipefail

WORKER="${1:?worker base URL, e.g. https://hitl-captcha-x402.example.workers.dev}"
TARGET="${2:?target page URL with a CAPTCHA}"
BUYER="${CDP_BUYER_ACCOUNT:-agentwire-x402-bazaar-buyer}"
ENDPOINT="${WORKER%/}/api/solve-captcha"

export CDP_URL="${CDP_URL:-https://api.cdp.coinbase.com/platform/v2}"

# Cloud env vars often store PEM newlines as literal \n — CDP CLI needs real newlines.
if [[ -n "${CDP_KEY_SECRET:-}" ]]; then
  export CDP_KEY_SECRET="$(printf '%b' "$CDP_KEY_SECRET")"
elif [[ -n "${CDP_PRIVATE_KEY:-}" ]]; then
  export CDP_KEY_SECRET="$(printf '%b' "$CDP_PRIVATE_KEY")"
fi

command -v cdp >/dev/null || { echo "Install: npm install -g @coinbase/cdp-cli"; exit 1; }
command -v jq >/dev/null || { echo "Install: jq"; exit 1; }

echo "Buyer account: $BUYER"
echo "Worker:        $ENDPOINT"
echo "Target page:   $TARGET"
echo

HDR_FILE="$(mktemp)"
BODY_FILE="$(mktemp)"
trap 'rm -f "$HDR_FILE" "$BODY_FILE"' EXIT

curl -s -D "$HDR_FILE" -o "$BODY_FILE" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$TARGET\",\"wait\":false}"

REQ="$(python3 - "$HDR_FILE" <<'PY'
import base64, json, re, sys
hdr = open(sys.argv[1]).read()
match = re.search(r"payment-required:\s*(.+)", hdr, re.I)
if not match:
    raise SystemExit("No PAYMENT-REQUIRED header — is the endpoint returning 402?")
payload = json.loads(base64.b64decode(match.group(1).strip()))
print(json.dumps(payload["accepts"]))
PY
)"

ADDR="$(cdp evm accounts by-name "$BUYER" --jq '.address')"
echo "Paying from: $ADDR"

PAYLOAD="$(cdp util x402 build --from "$ADDR" --payment-requirements "$REQ")"
D="$(echo "$PAYLOAD" | jq -c .domain)"
T="$(echo "$PAYLOAD" | jq -c .types)"
P="$(echo "$PAYLOAD" | jq -r .primaryType)"
M="$(echo "$PAYLOAD" | jq -c .message)"

SIG="$(cdp evm accounts sign typed-data "$ADDR" \
  "domain:=$D" "types:=$T" "primaryType=$P" "message:=$M" \
  --jq '.signature')"

HEADER="$(cdp util x402 encode \
  --payment-requirements "$REQ" \
  --signature "$SIG" \
  --authorization "$M" \
  --x402-version 2)"

RESP="$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: $HEADER" \
  -H "X-PAYMENT: $HEADER" \
  -d "{\"url\":\"$TARGET\",\"wait\":false}")"

HTTP_CODE="$(echo "$RESP" | tail -n1)"
BODY="$(echo "$RESP" | sed '$d')"

echo
echo "HTTP $HTTP_CODE"
echo "$BODY" | jq .

SESSION_ID="$(echo "$BODY" | jq -r '.sessionId // empty')"
SOLVE_URL="$(echo "$BODY" | jq -r '.solveUrl // empty')"

if [[ -n "$SESSION_ID" ]]; then
  echo
  echo "Session:  $SESSION_ID"
  echo "Solve UI: $SOLVE_URL"
  echo "Status:   curl ${WORKER%/}/api/session/$SESSION_ID/status"
fi
