import { describe, expect, it } from "vitest";
import {
  createFacilitatorClient,
  facilitatorSummary,
  solveCaptchaBazaarExtensions,
  solveCaptchaRouteConfig
} from "./x402-config";
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NTFY_TOPIC: "hitl-captcha-alerts",
    X402_NETWORK: "eip155:84532",
    X402_PRICE: "$0.25",
    SESSION_TTL_SECONDS: "900",
    MYBROWSER: {} as BrowserRun,
    CAPTCHA_SESSION: {} as Env["CAPTCHA_SESSION"],
    SERVER_ADDRESS: "0x1234567890123456789012345678901234567890",
    ...overrides
  };
}

describe("x402-config", () => {
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

  it("builds a paid route config with mimeType, tags, and Bazaar extensions", () => {
    const config = solveCaptchaRouteConfig(makeEnv());
    const route = Object.values(config)[0]!;

    expect(route.mimeType).toBe("application/json");
    expect(route.tags).toContain("captcha");
    expect(route.extensions?.bazaar).toBeDefined();
    const accepts = Array.isArray(route.accepts)
      ? route.accepts
      : [route.accepts];
    expect(accepts[0]?.network).toBe("eip155:84532");
  });

  it("uses the CDP facilitator when API keys are configured", () => {
    const summary = facilitatorSummary(
      makeEnv({
        CDP_API_KEY_ID: "organizations/test/apiKeys/abc",
        CDP_API_KEY_SECRET: "secret"
      })
    );

    expect(summary.mode).toBe("cdp");
    expect(summary.bazaarDiscovery).toBe(true);
    expect(summary.url).toContain("api.cdp.coinbase.com");
  });

  it("falls back to the x402.org testnet facilitator without CDP keys", () => {
    const summary = facilitatorSummary(makeEnv());
    expect(summary.mode).toBe("testnet");
    expect(summary.bazaarDiscovery).toBe(false);
    expect(summary.url).toContain("x402.org");
  });

  it("creates facilitator clients for both modes", () => {
    const cdp = createFacilitatorClient(
      makeEnv({
        CDP_API_KEY_ID: "key",
        CDP_API_KEY_SECRET: "secret"
      })
    );
    const testnet = createFacilitatorClient(makeEnv());

    expect(cdp.url).toContain("api.cdp.coinbase.com");
    expect(testnet.url).toContain("x402.org");
  });
});
