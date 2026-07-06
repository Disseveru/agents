import { createFacilitatorConfig } from "@coinbase/x402";
import type { RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer } from "@x402/hono";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

export const BASE_MAINNET = "eip155:8453";
export const BASE_SEPOLIA = "eip155:84532";

const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";
export const BAZAAR_MCP_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp";

let cachedResourceServer: x402ResourceServer | null = null;
let cachedFacilitatorMode: "cdp" | "testnet" | null = null;

export function paymentNetwork(env: Env): `${string}:${string}` {
  return (env.X402_NETWORK || BASE_MAINNET) as `${string}:${string}`;
}

export function requiresCdpFacilitator(env: Env): boolean {
  return paymentNetwork(env) !== BASE_SEPOLIA;
}

function facilitatorMode(env: Env): "cdp" | "testnet" {
  if (requiresCdpFacilitator(env)) {
    return "cdp";
  }
  return env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET ? "cdp" : "testnet";
}

export function createFacilitatorClient(env: Env): HTTPFacilitatorClient {
  if (facilitatorMode(env) === "cdp") {
    if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
      throw new Error(
        "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for Base mainnet x402 payments and Bazaar discovery."
      );
    }
    return new HTTPFacilitatorClient(
      createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)
    );
  }

  return new HTTPFacilitatorClient({ url: TESTNET_FACILITATOR_URL });
}

export function getResourceServer(env: Env): x402ResourceServer {
  const mode = facilitatorMode(env);
  if (!cachedResourceServer || cachedFacilitatorMode !== mode) {
    const facilitatorClient = createFacilitatorClient(env);
    cachedResourceServer = new x402ResourceServer(facilitatorClient);
    registerExactEvmScheme(cachedResourceServer);
    cachedFacilitatorMode = mode;
  }
  return cachedResourceServer;
}

export function solveCaptchaBazaarExtensions() {
  return declareDiscoveryExtension({
    input: {
      url: "https://accounts.hcaptcha.com/demo",
      wait: false
    },
    inputSchema: {
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "HTTP(S) page URL that contains a CAPTCHA widget"
        },
        wait: {
          type: "boolean",
          description:
            "When true, block up to five minutes until the human completes the challenge"
        },
        callbackUrl: {
          type: "string",
          format: "uri",
          description: "Optional webhook URL notified when the session completes"
        }
      },
      required: ["url"]
    },
    bodyType: "json",
    output: {
      example: {
        sessionId: "abc123xyz",
        status: "awaiting_human",
        solveUrl:
          "https://hitl-captcha-x402.example.workers.dev/solve/abc123xyz",
        challenge: {
          kind: "hcaptcha",
          siteKey: "a5f74b19-9e45-40e0-b45d-47ff91b7a6c2",
          pageUrl: "https://accounts.hcaptcha.com/demo",
          pageTitle: "hCaptcha demo"
        }
      },
      schema: {
        properties: {
          sessionId: { type: "string" },
          status: { type: "string" },
          solveUrl: { type: "string", format: "uri" },
          challenge: { type: "object" },
          result: { type: "object" },
          error: { type: "string" }
        },
        required: ["sessionId", "status", "solveUrl"]
      }
    }
  });
}

export function solveCaptchaRouteConfig(env: Env): RoutesConfig {
  const price = env.X402_PRICE || "$0.0001";
  const network = paymentNetwork(env);

  return {
    "POST /api/solve-captcha": {
      accepts: [
        {
          scheme: "exact",
          price,
          network,
          payTo: env.SERVER_ADDRESS as `0x${string}`
        }
      ],
      description:
        "Human-in-the-loop CAPTCHA solver for automation agents. Spins up Browser Rendering on the target page, detects Turnstile, reCAPTCHA, or hCaptcha, and hands the challenge to a human via a mobile solve URL and ntfy push notification. Returns session id, solve URL, and challenge metadata for async polling.",
      mimeType: "application/json",
      serviceName: "HITL CAPTCHA Solver",
      tags: [
        "captcha",
        "browser-rendering",
        "human-in-the-loop",
        "automation",
        "hcaptcha",
        "recaptcha",
        "turnstile"
      ],
      extensions: {
        ...solveCaptchaBazaarExtensions()
      }
    }
  };
}

export function facilitatorSummary(env: Env) {
  const mode = facilitatorMode(env);
  const network = paymentNetwork(env);
  return {
    url: mode === "cdp" ? CDP_FACILITATOR_URL : TESTNET_FACILITATOR_URL,
    mode,
    network,
    networkName: network === BASE_MAINNET ? "base" : "base-sepolia",
    bazaarDiscovery: mode === "cdp",
    bazaarMcp: BAZAAR_MCP_URL,
    bazaarDocs: "https://docs.cdp.coinbase.com/x402/bazaar"
  };
}

export function paymentConfigError(env: Env): string | null {
  if (!env.SERVER_ADDRESS) {
    return "SERVER_ADDRESS is not configured. Set it with `wrangler secret put SERVER_ADDRESS`.";
  }
  if (requiresCdpFacilitator(env) && (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET)) {
    return "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for Base mainnet payments and Bazaar discovery indexing.";
  }
  return null;
}
