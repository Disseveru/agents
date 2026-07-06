import { describe, expect, it } from "vitest";
import { validateBazaarRouteExtensions } from "@x402/extensions/bazaar";
import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  BAZAAR_MCP_URL,
  createFacilitatorClient,
  facilitatorSummary,
  paymentConfigError,
  paymentNetwork,
  requiresCdpFacilitator,
  solveCaptchaBazaarExtensions,
  solveCaptchaRouteConfig
} from "./x402-config";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NTFY_TOPIC: "hitl-captcha-alerts",
    X402_NETWORK: BASE_MAINNET,
    X402_PRICE: "$0.0001",
    SESSION_TTL_SECONDS: "900",
    MYBROWSER: {} as BrowserRun,
    CAPTCHA_SESSION: {} as Env["CAPTCHA_SESSION"],
    SERVER_ADDRESS: "0x1234567890123456789012345678901234567890",
    CDP_API_KEY_ID: "organizations/test/apiKeys/abc",
    CDP_API_KEY_SECRET: "secret",
    ...overrides
  };
}

describe("x402-config", () => {
  it("defaults to Base mainnet", () => {
    expect(paymentNetwork(makeEnv({ X402_NETWORK: undefined }))).toBe(
      BASE_MAINNET
    );
    expect(requiresCdpFacilitator(makeEnv())).toBe(true);
  });

  it("declares Bazaar discovery metadata for the solve endpoint", () => {
    const extensions = solveCaptchaBazaarExtensions();
    expect(extensions.bazaar).toBeDefined();
    expect(extensions.bazaar?.info?.input).toMatchObject({
      body: {
        url: "https://accounts.hcaptcha.com/demo",
        wait: false
      },
      bodyType: "json"
    });
  });

  it("passes Bazaar route extension validation", () => {
    expect(() =>
      validateBazaarRouteExtensions(solveCaptchaRouteConfig(makeEnv()))
    ).not.toThrow();
  });

  it("builds a paid route config with mimeType, tags, and Bazaar extensions", () => {
    const config = solveCaptchaRouteConfig(makeEnv());
    const route = Object.values(config)[0]!;

    expect(route.mimeType).toBe("application/json");
    expect(route.tags).toContain("captcha");
    expect(route.extensions?.bazaar).toBeDefined();
    const accepts = Array.isArray(route.accepts)
      ? route.accepts
      : [route.accepts];
    expect(accepts[0]?.network).toBe(BASE_MAINNET);
  });

  it("requires CDP API keys on Base mainnet", () => {
    expect(
      paymentConfigError(
        makeEnv({ CDP_API_KEY_ID: undefined, CDP_API_KEY_SECRET: undefined })
      )
    ).toContain("CDP_API_KEY_ID");
  });

  it("allows testnet facilitator fallback only on Base Sepolia", () => {
    const summary = facilitatorSummary(
      makeEnv({
        X402_NETWORK: BASE_SEPOLIA as Env["X402_NETWORK"],
        CDP_API_KEY_ID: undefined,
        CDP_API_KEY_SECRET: undefined
      })
    );

    expect(summary.mode).toBe("testnet");
    expect(summary.bazaarDiscovery).toBe(false);
    expect(summary.url).toContain("x402.org");
  });

  it("uses the CDP facilitator when API keys are configured", () => {
    const summary = facilitatorSummary(makeEnv());

    expect(summary.mode).toBe("cdp");
    expect(summary.network).toBe(BASE_MAINNET);
    expect(summary.bazaarDiscovery).toBe(true);
    expect(summary.bazaarMcp).toBe(BAZAAR_MCP_URL);
    expect(summary.url).toContain("api.cdp.coinbase.com");
  });

  it("creates facilitator clients for CDP and testnet modes", () => {
    const cdp = createFacilitatorClient(makeEnv());
    const testnet = createFacilitatorClient(
      makeEnv({
        X402_NETWORK: BASE_SEPOLIA as Env["X402_NETWORK"],
        CDP_API_KEY_ID: undefined,
        CDP_API_KEY_SECRET: undefined
      })
    );

    expect(cdp.url).toContain("api.cdp.coinbase.com");
    expect(testnet.url).toContain("x402.org");
  });
});
