import { createFacilitatorConfig } from "@coinbase/x402";
import type { RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer } from "@x402/hono";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";

let cachedResourceServer: x402ResourceServer | null = null;
let cachedFacilitatorMode: "cdp" | "testnet" | null = null;

function facilitatorMode(env: Env): "cdp" | "testnet" {
  return env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET ? "cdp" : "testnet";
}

export function createFacilitatorClient(env: Env): HTTPFacilitatorClient {
  if (facilitatorMode(env) === "cdp") {
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
        solveUrl: "https://hitl-captcha-x402.example.workers.dev/solve/abc123xyz",
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
  const price = env.X402_PRICE || "$0.25";
  const network = (env.X402_NETWORK || "eip155:84532") as `${string}:${string}`;

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
        "Spin up Browser Rendering, detect a CAPTCHA on the target page, and hand the challenge to a human via mobile solve UI. Returns a session id and solve URL for ntfy handoff.",
      mimeType: "application/json",
      serviceName: "HITL CAPTCHA Solver",
      tags: ["captcha", "browser-rendering", "human-in-the-loop", "automation"],
      extensions: {
        ...solveCaptchaBazaarExtensions()
      }
    }
  };
}

export function facilitatorSummary(env: Env) {
  const mode = facilitatorMode(env);
  return {
    url: mode === "cdp" ? CDP_FACILITATOR_URL : TESTNET_FACILITATOR_URL,
    mode,
    bazaarDiscovery: mode === "cdp"
  };
}
