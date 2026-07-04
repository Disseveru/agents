import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureAuthPayload,
  captureCookies,
  detectCaptcha,
  injectCaptchaToken
} from "./captcha-detect";

type PageParam = Parameters<typeof detectCaptcha>[0];
type FrameParam = ReturnType<PageParam["frames"]>[number];
type CookiesPageParam = Parameters<typeof captureCookies>[0];

type FakeElement = {
  getAttribute: (name: string) => string | null;
  value?: string;
  dispatchEvent: ReturnType<typeof vi.fn>;
};

function makeElement(attrs: Record<string, string> = {}): FakeElement {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    dispatchEvent: vi.fn()
  };
}

function makeFakeDocument(options: {
  selectors?: Record<string, FakeElement | null>;
  selectorAll?: Record<string, FakeElement[]>;
  bodyInnerText?: string;
  form?: Record<string, unknown> | null;
} = {}) {
  const selectors = options.selectors ?? {};
  const selectorAll = options.selectorAll ?? {};
  const form = options.form;
  return {
    querySelector: (selector: string) => {
      if (selector === "form") {
        return form === undefined ? null : form;
      }
      return selectors[selector] ?? null;
    },
    querySelectorAll: (selector: string) => selectorAll[selector] ?? [],
    body: { innerText: options.bodyInnerText ?? "" }
  };
}

function makeFrame(overrides: Record<string, unknown> = {}): FrameParam {
  return {
    evaluate: vi.fn(
      async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        fn(...args)
    ),
    ...overrides
  } as unknown as FrameParam;
}

function makePage(overrides: Record<string, unknown> = {}): PageParam {
  return {
    url: () => "https://example.com/login",
    title: async () => "Login",
    screenshot: async () => "ZmFrZXNjcmVlbnNob3Q=",
    frames: () => [],
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn(
      async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        fn(...args)
    ),
    ...overrides
  } as unknown as PageParam;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectCaptcha", () => {
  it("detects a Cloudflare Turnstile widget and extracts the site key and extra attributes", async () => {
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectors: {
          ".cf-turnstile, [data-sitekey].cf-turnstile, iframe[src*='challenges.cloudflare.com']":
            makeElement({
              "data-sitekey": "0xTURNSTILEKEY",
              "data-theme": "dark",
              "data-size": "compact",
              "data-action": "login",
              "data-callback": "onSolved"
            })
        }
      })
    );

    const page = makePage({
      url: () => "https://example.com/login",
      title: async () => "Login page"
    });

    const result = await detectCaptcha(page);

    expect(result.kind).toBe("turnstile");
    expect(result.siteKey).toBe("0xTURNSTILEKEY");
    expect(result.pageUrl).toBe("https://example.com/login");
    expect(result.pageTitle).toBe("Login page");
    expect(result.screenshotBase64).toBe("ZmFrZXNjcmVlbnNob3Q=");
    expect(result.extra).toEqual({
      theme: "dark",
      size: "compact",
      action: "login",
      callbackName: "onSolved"
    });
  });

  it("detects an hCaptcha widget", async () => {
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectors: {
          ".h-captcha, [data-sitekey].h-captcha, iframe[src*='hcaptcha.com']":
            makeElement({ "data-sitekey": "hcaptcha-key", "data-theme": "light" })
        }
      })
    );

    const result = await detectCaptcha(makePage());

    expect(result.kind).toBe("hcaptcha");
    expect(result.siteKey).toBe("hcaptcha-key");
    expect(result.extra).toEqual({
      theme: "light",
      size: undefined,
      callbackName: undefined
    });
  });

  it("detects a reCAPTCHA widget", async () => {
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectors: {
          ".g-recaptcha, [data-sitekey].g-recaptcha, iframe[src*='google.com/recaptcha'], iframe[src*='recaptcha.net']":
            makeElement({ "data-sitekey": "recaptcha-key" })
        }
      })
    );

    const result = await detectCaptcha(makePage());

    expect(result.kind).toBe("recaptcha");
    expect(result.siteKey).toBe("recaptcha-key");
  });

  it("falls back to an unknown kind when only a bare [data-sitekey] element exists", async () => {
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectors: { "[data-sitekey]": makeElement({ "data-sitekey": "generic-key" }) }
      })
    );

    const result = await detectCaptcha(makePage());

    expect(result.kind).toBe("unknown");
    expect(result.siteKey).toBe("generic-key");
    expect(result.extra).toEqual({});
  });

  it("falls back to an unknown kind with no site key when the body text mentions a CAPTCHA challenge", async () => {
    vi.stubGlobal(
      "document",
      makeFakeDocument({ bodyInnerText: "Please complete the CAPTCHA to continue" })
    );

    const result = await detectCaptcha(makePage());

    expect(result.kind).toBe("unknown");
    expect(result.siteKey).toBeNull();
  });

  it("returns unknown with no site key and empty extra when nothing is detected", async () => {
    vi.stubGlobal("document", makeFakeDocument({ bodyInnerText: "welcome home" }));

    const result = await detectCaptcha(makePage());

    expect(result).toMatchObject({ kind: "unknown", siteKey: null, extra: {} });
  });

  it("sets screenshotBase64 to null when the screenshot call rejects", async () => {
    vi.stubGlobal("document", makeFakeDocument());

    const page = makePage({
      screenshot: async () => {
        throw new Error("screenshot failed");
      }
    });

    const result = await detectCaptcha(page);

    expect(result.screenshotBase64).toBeNull();
  });

  it("sets screenshotBase64 to null when the screenshot resolves with a non-string value", async () => {
    vi.stubGlobal("document", makeFakeDocument());

    const page = makePage({ screenshot: async () => new Uint8Array([1, 2, 3]) });

    const result = await detectCaptcha(page);

    expect(result.screenshotBase64).toBeNull();
  });

  it("continues scanning additional frames when an earlier frame's evaluate rejects", async () => {
    const throwingFrame = makeFrame({
      evaluate: vi.fn(async () => {
        throw new Error("cross-origin frame access blocked");
      })
    });
    const detectingFrame = makeFrame({
      evaluate: vi.fn(async () => ({
        kind: "hcaptcha" as const,
        siteKey: "frame-key",
        extra: {}
      }))
    });

    const page = makePage({
      evaluate: throwingFrame.evaluate,
      frames: () => [detectingFrame]
    });

    const result = await detectCaptcha(page);

    expect(result.kind).toBe("hcaptcha");
    expect(result.siteKey).toBe("frame-key");
    expect(result.pageUrl).toBe("https://example.com/login");
  });
});

describe("injectCaptchaToken", () => {
  it("sets the turnstile and generic recaptcha response fields and dispatches events", async () => {
    const turnstileInput = makeElement();
    const genericInput = makeElement();
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectorAll: {
          '[name="cf-turnstile-response"]': [turnstileInput],
          '[name="g-recaptcha-response"]': [genericInput]
        }
      })
    );

    await injectCaptchaToken(makePage(), "turnstile", "the-token");

    expect(turnstileInput.value).toBe("the-token");
    expect(turnstileInput.dispatchEvent).toHaveBeenCalledTimes(2);
    expect(genericInput.value).toBe("the-token");
    expect(genericInput.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it("sets the hcaptcha and generic recaptcha response fields", async () => {
    const hcaptchaInput = makeElement();
    const genericInput = makeElement();
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectorAll: {
          '[name="h-captcha-response"]': [hcaptchaInput],
          '[name="g-recaptcha-response"]': [genericInput]
        }
      })
    );

    await injectCaptchaToken(makePage(), "hcaptcha", "the-token");

    expect(hcaptchaInput.value).toBe("the-token");
    expect(genericInput.value).toBe("the-token");
  });

  it("sets all generic recaptcha selectors for the recaptcha/unknown kind", async () => {
    const byName = makeElement();
    const byId = makeElement();
    const byTextareaId = makeElement();
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectorAll: {
          '[name="g-recaptcha-response"]': [byName],
          "#g-recaptcha-response": [byId],
          "textarea#g-recaptcha-response": [byTextareaId]
        }
      })
    );

    await injectCaptchaToken(makePage(), "recaptcha", "the-token");

    expect(byName.value).toBe("the-token");
    expect(byId.value).toBe("the-token");
    expect(byTextareaId.value).toBe("the-token");
  });

  it("invokes each distinct data-callback function exactly once with the token", async () => {
    const widgetA = makeElement({ "data-callback": "myCallback" });
    const widgetB = makeElement({ "data-callback": "myCallback" });
    const widgetC = makeElement({ "data-callback": "missingCallback" });
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectorAll: {
          ".g-recaptcha, .h-captcha, .cf-turnstile, [data-callback]": [
            widgetA,
            widgetB,
            widgetC
          ]
        }
      })
    );
    const callback = vi.fn();
    vi.stubGlobal("myCallback", callback);

    await expect(
      injectCaptchaToken(makePage(), "unknown", "the-token")
    ).resolves.toBeUndefined();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("the-token");
  });

  it("submits the form and marks it as submitted", async () => {
    const form = {
      requestSubmit: vi.fn(),
      submit: vi.fn(),
      dataset: {} as Record<string, string>
    };
    vi.stubGlobal("document", makeFakeDocument({ form }));

    await injectCaptchaToken(makePage(), "turnstile", "the-token");

    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
    expect(form.submit).toHaveBeenCalledTimes(1);
    expect(form.dataset.submitted).toBe("true");
  });

  it("does not resubmit the form when it was already marked as submitted", async () => {
    const form = {
      submit: vi.fn(),
      dataset: { submitted: "true" } as Record<string, string>
    };
    vi.stubGlobal("document", makeFakeDocument({ form }));

    await injectCaptchaToken(makePage(), "turnstile", "the-token");

    expect(form.submit).not.toHaveBeenCalled();
  });

  it("does nothing and does not throw when there is no form on the page", async () => {
    vi.stubGlobal("document", makeFakeDocument({ form: null }));

    await expect(
      injectCaptchaToken(makePage(), "turnstile", "the-token")
    ).resolves.toBeUndefined();
  });

  it("rejects when evaluate fails in every available frame", async () => {
    const page = makePage({
      evaluate: vi.fn(async () => {
        throw new Error("blocked");
      }),
      frames: () => []
    });

    await expect(injectCaptchaToken(page, "turnstile", "token")).rejects.toThrow(
      "Unable to evaluate script in any frame"
    );
  });

  it("passes kind and token into the browser evaluate call", async () => {
    const evaluate = vi.fn(
      async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        fn(...args)
    );
    vi.stubGlobal(
      "document",
      makeFakeDocument({
        selectorAll: {
          '[name="cf-turnstile-response"]': [makeElement()],
          '[name="g-recaptcha-response"]': [makeElement()]
        }
      })
    );

    await injectCaptchaToken(makePage({ evaluate }), "turnstile", "the-token");

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      { kind: "turnstile", token: "the-token" }
    );
  });
});

describe("captureAuthPayload", () => {
  function makeStorage(data: Record<string, string>) {
    const keys = Object.keys(data);
    return {
      length: keys.length,
      key: (i: number) => keys[i] ?? null,
      getItem: (k: string) => data[k] ?? null
    };
  }

  it("reads localStorage, sessionStorage, and the user agent from the page", async () => {
    vi.stubGlobal("window", {
      localStorage: makeStorage({ a: "1", b: "2" }),
      sessionStorage: makeStorage({ c: "3" })
    });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Test" });

    const page = makePage({ url: () => "https://example.com/dashboard" });

    const result = await captureAuthPayload(page);

    expect(result).toEqual({
      cookies: [],
      localStorage: { a: "1", b: "2" },
      sessionStorage: { c: "3" },
      finalUrl: "https://example.com/dashboard",
      userAgent: "Mozilla/5.0 Test"
    });
  });

  it("returns empty storage objects when there are no stored keys", async () => {
    vi.stubGlobal("window", {
      localStorage: makeStorage({}),
      sessionStorage: makeStorage({})
    });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Empty" });

    const result = await captureAuthPayload(makePage());

    expect(result.localStorage).toEqual({});
    expect(result.sessionStorage).toEqual({});
  });
});

describe("captureCookies", () => {
  it("maps browser cookies into the AuthCookie shape", async () => {
    const page: CookiesPageParam = {
      ...makePage(),
      cookies: async () => [
        {
          name: "session",
          value: "abc123",
          domain: ".example.com",
          path: "/",
          expires: 1893456000,
          httpOnly: true,
          secure: true,
          sameSite: "Lax" as const
        },
        {
          name: "no-samesite",
          value: "xyz",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false
        }
      ]
    };

    const result = await captureCookies(page);

    expect(result).toEqual([
      {
        name: "session",
        value: "abc123",
        domain: ".example.com",
        path: "/",
        expires: 1893456000,
        httpOnly: true,
        secure: true,
        sameSite: "Lax"
      },
      {
        name: "no-samesite",
        value: "xyz",
        domain: "example.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: undefined
      }
    ]);
  });

  it("returns an empty array when there are no cookies", async () => {
    const page: CookiesPageParam = { ...makePage(), cookies: async () => [] };

    const result = await captureCookies(page);

    expect(result).toEqual([]);
  });
});