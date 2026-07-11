#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."

AAVE_POOL=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
AAVE_PROVIDER=0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D
SMART_ACCOUNT="${FLASHLOAN_OWNER:-0x383A8bc095e7cdf2C8502435457E84d65C17c251}"
DEPLOYER="${DEPLOYER_ADDRESS:-0x451ab8d06B6EF38416312Fe4261B1A56dD2EAF1d}"

echo "Building..."
forge build -q

echo "Deployer balance:" $(cast balance "$DEPLOYER" --rpc-url "$BASE_RPC_ENDPOINT" --ether) ETH
echo "Owner (smart account): $SMART_ACCOUNT"

export FLASHLOAN_OWNER="$SMART_ACCOUNT"

if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "Set PRIVATE_KEY for deployer EOA (CDP server or MetaMask key with Base ETH)."
  exit 1
fi

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_RPC_ENDPOINT" \
  --broadcast \
  --private-key "$PRIVATE_KEY"
