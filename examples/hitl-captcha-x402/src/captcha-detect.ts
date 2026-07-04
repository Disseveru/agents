import type { CaptchaChallenge, CaptchaKind } from "./types";

type FrameLike = {
  evaluate(
    pageFunction: string | ((...args: unknown[]) => unknown),
    ...args: unknown[]
  ): Promise<unknown>;
  $?(selector: string): Promise<unknown>;
};

type PageLike = FrameLike & {
  url(): string;
  title(): Promise<string>;
  screenshot(options?: { encoding?: "base64" }): Promise<string | Uint8Array>;
  frames(): FrameLike[];
  goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle0" }
  ): Promise<unknown>;
};

type DetectedCaptcha = {
  kind: CaptchaKind;
  siteKey: string | null;
  extra: CaptchaChallenge["extra"];
};

async function evaluateInFrames<T, Args extends readonly unknown[]>(
  page: PageLike,
  fn: (...args: Args) => T | Promise<T>,
  ...args: Args
): Promise<T> {
  const frames = [page, ...page.frames()];
  for (const frame of frames) {
    try {
      return (await frame.evaluate(
        fn as unknown as (...args: unknown[]) => unknown,
        ...args
      )) as T;
    } catch {
      // Try the next frame when cross-origin blocks evaluation.
    }
  }
  throw new Error("Unable to evaluate script in any frame");
}

async function detectInFrame(
  frame: FrameLike
): Promise<DetectedCaptcha | null> {
  return (await frame.evaluate(() => {
    const turnstile = document.querySelector<HTMLElement>(
      ".cf-turnstile, [data-sitekey].cf-turnstile, iframe[src*='challenges.cloudflare.com']"
    );
    if (turnstile) {
      const siteKey =
        turnstile.getAttribute("data-sitekey") ??
        document
          .querySelector<HTMLElement>(".cf-turnstile")
          ?.getAttribute("data-sitekey");
      return {
        kind: "turnstile" as const,
        siteKey: siteKey ?? null,
        extra: {
          theme: turnstile.getAttribute("data-theme") ?? undefined,
          size: turnstile.getAttribute("data-size") ?? undefined,
          action: turnstile.getAttribute("data-action") ?? undefined,
          callbackName: turnstile.getAttribute("data-callback") ?? undefined
        }
      };
    }

    const hcaptcha = document.querySelector<HTMLElement>(
      ".h-captcha, [data-sitekey].h-captcha, iframe[src*='hcaptcha.com']"
    );
    if (hcaptcha) {
      const siteKey =
        hcaptcha.getAttribute("data-sitekey") ??
        document
          .querySelector<HTMLElement>(".h-captcha")
          ?.getAttribute("data-sitekey");
      return {
        kind: "hcaptcha" as const,
        siteKey: siteKey ?? null,
        extra: {
          theme: hcaptcha.getAttribute("data-theme") ?? undefined,
          size: hcaptcha.getAttribute("data-size") ?? undefined,
          callbackName: hcaptcha.getAttribute("data-callback") ?? undefined
        }
      };
    }

    const recaptcha = document.querySelector<HTMLElement>(
      ".g-recaptcha, [data-sitekey].g-recaptcha, iframe[src*='google.com/recaptcha'], iframe[src*='recaptcha.net']"
    );
    if (recaptcha) {
      const siteKey =
        recaptcha.getAttribute("data-sitekey") ??
        document
          .querySelector<HTMLElement>(".g-recaptcha, [data-sitekey]")
          ?.getAttribute("data-sitekey");
      return {
        kind: "recaptcha" as const,
        siteKey: siteKey ?? null,
        extra: {
          theme: recaptcha.getAttribute("data-theme") ?? undefined,
          size: recaptcha.getAttribute("data-size") ?? undefined,
          callbackName: recaptcha.getAttribute("data-callback") ?? undefined
        }
      };
    }

    const generic = document.querySelector<HTMLElement>("[data-sitekey]");
    if (generic) {
      return {
        kind: "unknown" as const,
        siteKey: generic.getAttribute("data-sitekey") ?? null,
        extra: {}
      };
    }

    const bodyText = document.body?.innerText?.toLowerCase() ?? "";
    if (
      bodyText.includes("captcha") ||
      bodyText.includes("verify you are human") ||
      bodyText.includes("are you a robot")
    ) {
      return {
        kind: "unknown" as const,
        siteKey: null,
        extra: {}
      };
    }

    return null;
  })) as DetectedCaptcha | null;
}

export async function detectCaptcha(page: PageLike): Promise<CaptchaChallenge> {
  const pageUrl = page.url();
  const pageTitle = await page.title();

  let detected: DetectedCaptcha | null = null;
  const frames = [page, ...page.frames()];
  for (const frame of frames) {
    try {
      detected = await detectInFrame(frame);
      if (detected) {
        break;
      }
    } catch {
      // Ignore inaccessible frames and continue scanning.
    }
  }

  let screenshotBase64: string | null = null;
  try {
    const shot = await page.screenshot({ encoding: "base64" });
    screenshotBase64 = typeof shot === "string" ? shot : null;
  } catch {
    screenshotBase64 = null;
  }

  if (!detected) {
    return {
      kind: "unknown",
      siteKey: null,
      pageUrl,
      pageTitle,
      screenshotBase64,
      extra: {}
    };
  }

  return {
    kind: detected.kind,
    siteKey: detected.siteKey,
    pageUrl,
    pageTitle,
    screenshotBase64,
    extra: detected.extra
  };
}

type InjectCaptchaArgs = {
  kind: CaptchaKind;
  token: string;
};

export async function injectCaptchaToken(
  page: PageLike,
  kind: CaptchaKind,
  token: string
): Promise<void> {
  await evaluateInFrames(
    page,
    ({ kind: captchaKind, token: captchaToken }: InjectCaptchaArgs) => {
      const setValue = (selector: string, value: string) => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            selector
          )
        );
        for (const node of nodes) {
          node.value = value;
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };

      if (captchaKind === "turnstile") {
        setValue('[name="cf-turnstile-response"]', captchaToken);
        setValue('[name="g-recaptcha-response"]', captchaToken);
      } else if (captchaKind === "hcaptcha") {
        setValue('[name="h-captcha-response"]', captchaToken);
        setValue('[name="g-recaptcha-response"]', captchaToken);
      } else {
        setValue('[name="g-recaptcha-response"]', captchaToken);
        setValue("#g-recaptcha-response", captchaToken);
        setValue("textarea#g-recaptcha-response", captchaToken);
      }

      const callbackNames = new Set<string>();
      const widgets = document.querySelectorAll<HTMLElement>(
        ".g-recaptcha, .h-captcha, .cf-turnstile, [data-callback]"
      );
      for (const widget of widgets) {
        const callback = widget.getAttribute("data-callback");
        if (callback) {
          callbackNames.add(callback);
        }
      }

      for (const callbackName of callbackNames) {
        const callback = (globalThis as Record<string, unknown>)[callbackName];
        if (typeof callback === "function") {
          (callback as (response: string) => void)(captchaToken);
        }
      }
    },
    { kind, token }
  );

  await evaluateInFrames(page, () => {
    const form = document.querySelector<HTMLFormElement>("form");
    if (form) {
      form.requestSubmit?.();
      if (!form.dataset.submitted) {
        form.dataset.submitted = "true";
        form.submit();
      }
    }
  });
}

export async function captureAuthPayload(page: PageLike): Promise<{
  cookies: AuthCookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  finalUrl: string;
  userAgent: string;
}> {
  const storage = await evaluateInFrames(page, () => {
    const readStorage = (storage: Storage) => {
      const out: Record<string, string> = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key) {
          out[key] = storage.getItem(key) ?? "";
        }
      }
      return out;
    };

    return {
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage),
      userAgent: navigator.userAgent
    };
  });

  return {
    cookies: [],
    localStorage: storage.localStorage,
    sessionStorage: storage.sessionStorage,
    finalUrl: page.url(),
    userAgent: storage.userAgent
  };
}

export type AuthCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None" | undefined;
};

export async function captureCookies(
  page: PageLike & {
    cookies(): Promise<
      Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires: number;
        httpOnly: boolean;
        secure: boolean;
        sameSite?: "Strict" | "Lax" | "None";
      }>
    >;
  }
): Promise<AuthCookie[]> {
  const cookies = await page.cookies();
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite
  }));
}
