#!/usr/bin/env bash
# Execute executeArbitrage via CDP Smart Account + Paymaster on Base.
# Usage: ./scripts/execute-via-cdp.sh <contract> <asset> <amount> <params_hex>
set -euo pipefail

CONTRACT="${1:?contract address}"
ASSET="${2:?asset address}"
AMOUNT="${3:?flash loan amount wei}"
PARAMS="${4:?abi-encoded ArbitrageParams hex}"

SMART_ACCOUNT="${SMART_ACCOUNT:-0x383A8bc095e7cdf2C8502435457E84d65C17c251}"
POLICY_ID="${CDP_PAYMASTER_POLICY_ID:-}"

CALL_DATA=$(cast calldata "executeArbitrage(address,uint256,bytes)" "$ASSET" "$AMOUNT" "$PARAMS")

PAYMASTER_ARGS=()
if [ -n "${BASE_RPC_ENDPOINT:-}" ]; then
  PAYMASTER_ARGS+=(paymasterUrl="$BASE_RPC_ENDPOINT")
fi
if [ -n "$POLICY_ID" ]; then
  PAYMASTER_ARGS+=("paymasterContext:={\"policyId\":\"$POLICY_ID\"}")
fi

cdp evm smart-accounts user-operations prepare-and-send "$SMART_ACCOUNT" \
  network=base \
  "calls:=[{\"to\":\"$CONTRACT\",\"value\":\"0\",\"data\":\"$CALL_DATA\"}]" \
  "${PAYMASTER_ARGS[@]}"
