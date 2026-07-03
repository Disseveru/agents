import { describe, expect, it } from "vitest";
import { renderSolvePage } from "./mobile-ui";
import type { CaptchaChallenge, SessionRecord } from "./types";

function makeChallenge(overrides: Partial<CaptchaChallenge> = {}): CaptchaChallenge {
  return {
    kind: "turnstile",
    siteKey: "0xSITEKEY",
    pageUrl: "https://example.com/login",
    pageTitle: "Login",
    screenshotBase64: null,
    extra: {},
    ...overrides
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-123",
    status: "awaiting_human",
    targetUrl: "https://example.com/login",
    createdAt: 1000,
    updatedAt: 1000,
    challenge: makeChallenge(),
    error: null,
    result: null,
    ...overrides
  };
}

describe("renderSolvePage", () => {
  it("renders a complete HTML document referencing the session id and origin", () => {
    const html = renderSolvePage(makeSession(), "https://worker.example.dev");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('const sessionId = "session-123";');
    expect(html).toContain('const origin = "https://worker.example.dev";');
  });

  it("uses the challenge page title, falling back to a default when there is no challenge", () => {
    const withTitle = renderSolvePage(
      makeSession({ challenge: makeChallenge({ pageTitle: "My Login Page" }) }),
      "https://worker.example.dev"
    );
    expect(withTitle).toContain("<title>My Login Page</title>");

    const withoutChallenge = renderSolvePage(
      makeSession({ challenge: null }),
      "https://worker.example.dev"
    );
    expect(withoutChallenge).toContain("<title>CAPTCHA solve</title>");
  });

  it("escapes HTML special characters in the page title, target URL, and status", () => {
    const html = renderSolvePage(
      makeSession({
        targetUrl: 'https://example.com/"><script>alert(1)</script>',
        status: "awaiting_human",
        challenge: makeChallenge({ pageTitle: "<script>alert('xss')</script>" })
      }),
      "https://worker.example.dev"
    );

    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows a placeholder card when the session has no challenge yet", () => {
    const html = renderSolvePage(
      makeSession({ challenge: null }),
      "https://worker.example.dev"
    );

    expect(html).toContain("No challenge metadata is available yet");
    expect(html).not.toContain("cf-turnstile");
    expect(html).not.toContain("g-recaptcha");
    expect(html).not.toContain("h-captcha");
  });

  it("renders a manual verification card when the challenge has no site key", () => {
    const html = renderSolvePage(
      makeSession({ challenge: makeChallenge({ siteKey: null }) }),
      "https://worker.example.dev"
    );

    expect(html).toContain("Manual verification");
    expect(html).toContain('id="manual-complete"');
    expect(html).not.toContain('class="cf-turnstile"');
  });

  it("renders a Cloudflare Turnstile widget with the site key and optional attributes", () => {
    const html = renderSolvePage(
      makeSession({
        challenge: makeChallenge({
          kind: "turnstile",
          siteKey: "0xTURNSTILEKEY",
          extra: { action: "login", theme: "dark", size: "compact" }
        })
      }),
      "https://worker.example.dev"
    );

    expect(html).toContain("Cloudflare Turnstile");
    expect(html).toContain('class="cf-turnstile" data-sitekey="0xTURNSTILEKEY"');
    expect(html).toContain('data-callback="onCaptchaSolved"');
    expect(html).toContain('data-action="login"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('data-size="compact"');
    expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
  });

  it("renders an hCaptcha widget without an action attribute", () => {
    const html = renderSolvePage(
      makeSession({
        challenge: makeChallenge({
          kind: "hcaptcha",
          siteKey: "hcaptcha-key",
          extra: { action: "should-be-ignored", theme: "light" }
        })
      }),
      "https://worker.example.dev"
    );

    expect(html).toContain("hCaptcha");
    expect(html).toContain('class="h-captcha" data-sitekey="hcaptcha-key"');
    expect(html).toContain('data-theme="light"');
    expect(html).not.toContain("data-action=");
    expect(html).toContain("https://js.hcaptcha.com/1/api.js");
  });

  it("renders a reCAPTCHA widget for the recaptcha kind", () => {
    const html = renderSolvePage(
      makeSession({
        challenge: makeChallenge({ kind: "recaptcha", siteKey: "recaptcha-key" })
      }),
      "https://worker.example.dev"
    );

    expect(html).toContain("reCAPTCHA");
    expect(html).toContain('class="g-recaptcha" data-sitekey="recaptcha-key"');
    expect(html).toContain("https://www.google.com/recaptcha/api.js");
  });

  it("falls back to the reCAPTCHA widget markup for an unknown kind that has a site key", () => {
    const html = renderSolvePage(
      makeSession({
        challenge: makeChallenge({ kind: "unknown", siteKey: "generic-key" })
      }),
      "https://worker.example.dev"
    );

    expect(html).toContain('class="g-recaptcha" data-sitekey="generic-key"');
  });

  it("includes a screenshot image when screenshotBase64 is present", () => {
    const html = renderSolvePage(
      makeSession({ challenge: makeChallenge({ screenshotBase64: "ZmFrZWJhc2U2NA==" }) }),
      "https://worker.example.dev"
    );

    expect(html).toContain('src="data:image/png;base64,ZmFrZWJhc2U2NA=="');
  });

  it("omits the screenshot image when screenshotBase64 is null", () => {
    const html = renderSolvePage(
      makeSession({ challenge: makeChallenge({ screenshotBase64: null }) }),
      "https://worker.example.dev"
    );

    expect(html).not.toContain("data:image/png;base64,");
  });

  it("renders the target URL as a link and the current status label", () => {
    const html = renderSolvePage(
      makeSession({ targetUrl: "https://example.com/login", status: "injecting" }),
      "https://worker.example.dev"
    );

    expect(html).toContain('href="https://example.com/login"');
    expect(html).toContain('<span id="status-label">injecting</span>');
  });
});