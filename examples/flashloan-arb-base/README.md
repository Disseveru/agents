# Flash Loan Arbitrage on Base (Aave V3 + CDP Paymaster)

Owner-controlled Aave V3 `flashLoanSimple` receiver for multi-hop arbitrage on Base mainnet. Swap calldata is supplied off-chain (Uniswap V3, Aerodrome, 0x Settler, etc.). Execution is triggered from a **CDP Smart Account** so gas can be sponsored via CDP Paymaster credits.

## Deployed contract (Base mainnet)

| Field | Value |
| --- | --- |
| **FlashLoanArbitrage** | [`0x3D69199Eb47da86C086218134E28B116a044C9DC`](https://basescan.org/address/0x3D69199Eb47da86C086218134E28B116a044C9DC) |
| **Owner** | `0x383A8bc095e7cdf2C8502435457E84d65C17c251` (`base-arb-smart`) |
| **Aave V3 Pool** | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| **Deploy tx** | [`0x30da7c63a785b8fb904ac745f41992a02a11c5c31abb8f0627222fdd893e260e`](https://basescan.org/tx/0x30da7c63a785b8fb904ac745f41992a02a11c5c31abb8f0627222fdd893e260e) |

## CDP Paymaster setup

1. In [CDP Portal → Paymaster](https://portal.cdp.coinbase.com/), enable **Base Mainnet** (not Sepolia).
2. Add to the contract allowlist:
   - `0x3D69199Eb47da86C086218134E28B116a044C9DC` (this receiver)
   - DEX routers you call inside `executeArbitrage` (you already added Uniswap SwapRouter02, 0x Settler, Aerodrome Router).
3. Fund the smart account with a **small ETH buffer** (~0.000004 ETH) for ERC-4337 precheck. Without it, user ops fail with `sender balance and deposit together is 0`. Paymaster sponsorship covers most gas once precheck passes.
4. Set `BASE_RPC_ENDPOINT` to your CDP Base RPC URL (includes paymaster methods).

## Execute arbitrage (gasless via smart account)

```bash
export BASE_RPC_ENDPOINT="https://api.developer.coinbase.com/rpc/v1/base/<token>"
export SMART_ACCOUNT=0x383A8bc095e7cdf2C8502435457E84d65C17c251
export CONTRACT=0x3D69199Eb47da86C086218134E28B116a044C9DC

# Encode ArbitrageParams: targets[], callDatas[], minProfit
PARAMS=$(cast abi-encode "f(address[],bytes[],uint256)" "[0x...]" "[0x...]" 0)

./scripts/execute-via-cdp.sh $CONTRACT 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 1000000000 $PARAMS
```

`executeArbitrage(asset, amount, params)` borrows from Aave, runs your swap calls, repays loan + premium, and reverts unless `balanceAfter >= owed + minProfit`.

## Build & redeploy

```bash
forge build
export FLASHLOAN_OWNER=0x383A8bc095e7cdf2C8502435457E84d65C17c251
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC_ENDPOINT --broadcast --private-key $DEPLOYER_KEY
```

## Base reference addresses

| Token / contract | Address |
| --- | --- |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| WETH | `0x4200000000000000000000000000000000000006` |
| Uniswap V3 SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| 0x Settler | `0x7747f8d2a76bd6345cc29622a946a929647f2359` |
| Aerodrome Router | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` |

## Notes

- This contract supports **owner-initiated arbitrage** only. It does not sandwich or front-run other users' transactions.
- Recent triangular scans at ~1000 USDC notional were **unprofitable** on Base spot liquidity; profitable paths require real-time quoting and low latency.
- Withdraw profits: `withdraw(token, to, amount)` — callable only by the smart-account owner.
