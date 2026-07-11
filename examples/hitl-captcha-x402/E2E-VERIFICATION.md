# End-to-end verification guide

This document records how to deploy, test, and prove the Human-In-The-Loop CAPTCHA
solver works on a live Cloudflare account — from x402 payment through ntfy mobile
handoff to token injection back into Browser Rendering.

## Live deployment (verified)

| Item | Value |
|------|-------|
| Worker name | `hitl-captcha-x402` |
| Live URL | `https://hitl-captcha-x402.<your-subdomain>.workers.dev` |
| Payment network | **Base mainnet** (`eip155:8453`) — testnet verified on Sepolia (`eip155:84532`) |
| Price per solve | `$0.25` USDC |
| Browser binding | `MYBROWSER` (Browser Rendering) |
| Session store | `CaptchaSession` Durable Object |

Deploy from this example directory:

```sh
cd examples/hitl-captcha-x402
pnpm install
wrangler secret put SERVER_ADDRESS   # legacy external wallet — do NOT create a new CDP wallet
wrangler secret put CDP_API_KEY_ID
wrangler secret put CDP_API_KEY_SECRET   # must be PKCS#8; use scripts/setup-cdp-secrets.sh
pnpm run deploy --var "NTFY_TOPIC:your-ntfy-topic"
```

`NTFY_TOPIC` is passed at deploy time so your personal topic stays out of git.
`SERVER_ADDRESS` must be a wrangler secret (never commit it).
`CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are required for the [CDP facilitator](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers) and [x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar) discovery indexing.

## x402 / Bazaar compliance checklist

This example follows the [x402 welcome guide](https://docs.cdp.coinbase.com/x402/welcome) and [Bazaar seller integration](https://docs.cdp.coinbase.com/x402/bazaar#seller-integration):

| Requirement | Implementation |
|-------------|----------------|
| HTTP 402 + `PAYMENT-REQUIRED` on unpaid calls | `@x402/hono` `paymentMiddleware` on `POST /api/solve-captcha` |
| `PAYMENT-SIGNATURE` / `X-PAYMENT` on retry | Buyer clients (e.g. `scripts/pay-and-solve.sh`, CDP CLI) |
| CAIP-2 network id (`eip155:8453`) | `X402_NETWORK` var (default Base mainnet) |
| CDP facilitator verify/settle | `CDP_API_KEY_*` secrets → `@coinbase/x402` `createFacilitatorConfig` at `https://api.cdp.coinbase.com/platform/v2/x402` |
| Bazaar `declareDiscoveryExtension` | `src/x402-config.ts` — strict JSON Schema input + example body |
| `bazaarResourceServerExtension` | Auto-registered by `@x402/hono` when Bazaar extensions are declared |
| `mimeType` + semantic `description` | `application/json` + agent-friendly natural language description |
| `paymentPayload.resource` on settle | Handled by `@x402/hono` when using CDP facilitator |
| Bazaar MCP for agents | Buyers use `https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp` (`search_resources`, `proxy_tool_call`) — see [CDP MCP](https://docs.cdp.coinbase.com/mcp) |
| Mobile solve UI | Server-rendered HTML at `/solve/:sessionId` (`src/mobile-ui.ts`) |

Bazaar indexing happens after the **first successful CDP mainnet settlement** for the endpoint. Search the catalog with:

```sh
curl "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=human+in+the+loop+captcha&network=eip155:8453"
```

## Prerequisites

1. **Cloudflare account** with Workers, Browser Rendering, and Durable Objects enabled
2. **`workers.dev` subdomain** — open Workers & Pages once in the dashboard if deploy fails with code `10063`
3. **`SERVER_ADDRESS` secret** — Base mainnet wallet to receive x402 USDC
4. **`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`** — required for mainnet verify/settle and Bazaar indexing
5. **`NTFY_TOPIC`** — ntfy.sh topic you subscribe to on your phone
6. **Buyer wallet** with **Base mainnet USDC** (for paid API calls) — e.g. a CDP server wallet

## Phone setup (ntfy)

1. Install [ntfy](https://ntfy.sh/) on your phone
2. Subscribe to your `NTFY_TOPIC` (exact string, case-sensitive)
3. Send a test ping to confirm delivery:

```sh
curl -X POST "https://ntfy.sh/your-ntfy-topic" \
  -H "Title: HITL CAPTCHA test" \
  -H "Tags: robot" \
  -d "If you see this, ntfy is wired up."
```

### Test vs real CAPTCHA notifications

| Notification | `Click` link | What you see |
|--------------|--------------|--------------|
| Manual ntfy test | Worker homepage `/` | Service info JSON |
| Real CAPTCHA alert | `/solve/:sessionId` | Mobile solve UI with widget |

Real alerts are only sent **after** a paid `POST /api/solve-captcha` succeeds and
Browser Rendering detects a CAPTCHA on the target page.

## CAPTCHA target pages

Use these URLs to exercise different widget types.

| Type | URL | Notes |
|------|-----|-------|
| Turnstile (test keys) | `https://demo.turnstile.workers.dev/` | Always-pass test sitekey — good for plumbing checks |
| **hCaptcha (real widget)** | `https://accounts.hcaptcha.com/demo` | Official demo; real challenge UI |
| **reCAPTCHA v2 (real widget)** | `https://www.google.com/recaptcha/api2/demo` | Official Google demo |
| Turnstile (forced challenge) | Pages using sitekey `3x00000000000000000000FF` | Cloudflare test key that forces interaction |

For production-like proof, prefer **hCaptcha** or **reCAPTCHA** demos over Turnstile
test keys.

## Trigger a paid solve (CDP CLI + x402)

Install the Coinbase CDP CLI and export credentials:

```sh
npm install -g @coinbase/cdp-cli

export CDP_KEY_ID="organizations/.../apiKeys/..."
export CDP_KEY_SECRET="-----BEGIN EC PRIVATE KEY----- ..."
export CDP_WALLET_SECRET="..."
export CDP_URL="https://api.cdp.coinbase.com/platform/v2"
```

Use a CDP server wallet that holds **Base mainnet USDC** (not Sepolia testnet USDC):

```sh
cdp evm accounts list
cdp data evm token-balances base 0xYourBuyerAddress
```

### One-shot paid request

Replace `WORKER` and `TARGET` below. The helper script in `scripts/pay-and-solve.sh`
automates the x402 signing flow.

```sh
WORKER="https://hitl-captcha-x402.your-subdomain.workers.dev"
TARGET="https://accounts.hcaptcha.com/demo"

./scripts/pay-and-solve.sh "$WORKER" "$TARGET"
```

Expected response (`HTTP 202`):

```json
{
  "sessionId": "abc123xyz",
  "status": "awaiting_human",
  "solveUrl": "https://hitl-captcha-x402.your-subdomain.workers.dev/solve/abc123xyz",
  "challenge": {
    "kind": "hcaptcha",
    "siteKey": "...",
    "pageUrl": "https://accounts.hcaptcha.com/demo",
    "pageTitle": "hCaptcha demo"
  }
}
```

Your phone receives an ntfy push with title **"CAPTCHA needs your attention"**.
Tap it, complete the widget, and wait for status **solved**.

Poll session status:

```sh
curl "https://hitl-captcha-x402.your-subdomain.workers.dev/api/session/abc123xyz/status"
```

## Verified results (2026-07-04)

### Phase 1 — Turnstile test plumbing

| Step | Result |
|------|--------|
| Deploy worker | OK — `hitl-captcha-x402.chchaman474.workers.dev` |
| ntfy subscription | OK — 4 test pings received on Moto G |
| x402 payment gate | OK — `POST /api/solve-captcha` returns `402` without payment |
| Paid solve (Turnstile demo) | OK — session `u9yoah17z5ccj7qa` |
| Mobile solve + inject | OK — status `solved`, `finalUrl` `https://demo.turnstile.workers.dev/handler`, 1 cookie |

### Phase 2 — Real hCaptcha demo (production widget)

| Step | Result |
|------|--------|
| Target | `https://accounts.hcaptcha.com/demo` |
| Widget | Real hCaptcha (`siteKey: a5f74b19-9e45-40e0-b45d-47ff91b7a6c2`) |
| Paid session | `gdb9mg2lrmj9scp1` |
| Solve UI | `https://hitl-captcha-x402.chchaman474.workers.dev/solve/gdb9mg2lrmj9scp1` |
| Mobile solve + inject | **OK** — status `solved` |
| Final URL | `https://accounts.hcaptcha.com/demo` |
| Cookies captured | 2 (`__cf_bm`, `__cflb` on `.hcaptcha.com` / `accounts.hcaptcha.com`) |

This uses the **official hCaptcha demo** — not Turnstile test keys that always pass.
A real image challenge was completed on a Moto G via the ntfy handoff link.

### Phase 3 — Real reCAPTCHA v2 demo (production widget)

| Step | Result |
|------|--------|
| Target | `https://www.google.com/recaptcha/api2/demo` |
| Widget | Real reCAPTCHA v2 (`siteKey: 6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-`) |
| Paid session | `0gzuyn6b4d4p1mml` |
| Solve UI | `https://hitl-captcha-x402.chchaman474.workers.dev/solve/0gzuyn6b4d4p1mml` |
| Mobile solve + inject | **OK** — status `solved` |
| Final URL | `https://www.google.com/recaptcha/api2/demo` |

This uses the **official Google reCAPTCHA v2 demo** — the classic "I'm not a robot" widget.
Completed via ntfy handoff on Moto G; token injected back into Browser Rendering.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| ntfy opens worker homepage only | Manual test ping, not a real solve | Wait for **"CAPTCHA needs your attention"** alert after paid API call |
| Status `failed` — "Unable to evaluate script in any frame" | Headless page lost after DO sleep; token not passed to Puppeteer correctly | Fixed in `captcha-detect.ts` + `captcha-session.ts` (pass `kind`/`token` as evaluate args; reopen target URL before inject) |
| `402` after payment attempt | Buyer wallet has no Base mainnet USDC | Fund CDP wallet on Base (not Sepolia) |
| `500` on unpaid `POST /api/solve-captcha` | Invalid `CDP_API_KEY_SECRET` (EC PEM, not PKCS#8) | Run `scripts/setup-cdp-secrets.sh` — converts `BEGIN EC PRIVATE KEY` to PKCS#8 before upload |
| Deploy error `10063` | No `workers.dev` subdomain | Open Workers & Pages in dashboard once, or `PUT /accounts/{id}/workers/subdomain` |

## API quick reference

```sh
# Health check
curl "$WORKER/"

# Unpaid probe (expect 402 + PAYMENT-REQUIRED header)
curl -X POST "$WORKER/api/solve-captcha" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://accounts.hcaptcha.com/demo"}'

# Session status
curl "$WORKER/api/session/$SESSION_ID/status"
```
