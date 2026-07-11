import puppeteer from "@cloudflare/puppeteer";
import {
  captureAuthPayload,
  captureCookies,
  detectCaptcha,
  injectCaptchaToken
} from "./captcha-detect";
import { sendNtfyAlert } from "./ntfy";
import type {
  AuthPayload,
  SessionRecord,
  SessionStatus,
  SolveCaptchaRequest
} from "./types";

const STORAGE_KEY = "session";

type BrowserHandle = Awaited<ReturnType<typeof puppeteer.launch>>;
type BrowserPage = Awaited<ReturnType<BrowserHandle["pages"]>>[number];

type StoredSession = SessionRecord & {
  browserSessionId: string | null;
  callbackUrl: string | null;
};

function now(): number {
  return Date.now();
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function parseTtlSeconds(value: string | undefined): number {
  const parsed = Number(value ?? "900");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}

export class CaptchaSession implements DurableObject {
  #browser: BrowserHandle | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "POST" && url.pathname === "/internal/start") {
      const body = (await request.json()) as SolveCaptchaRequest & {
        sessionId: string;
        origin: string;
      };
      return this.startSession(body);
    }

    if (method === "GET" && url.pathname === "/internal/status") {
      const session = await this.getSession();
      if (!session) {
        return json({ error: "Session not found" }, 404);
      }
      return json({
        sessionId: session.id,
        status: session.status,
        challenge: session.challenge,
        result: session.result,
        error: session.error
      });
    }

    if (method === "POST" && url.pathname === "/internal/submit") {
      const body = (await request.json()) as { token: string };
      return this.submitToken(body.token);
    }

    if (method === "GET" && url.pathname === "/internal/render") {
      const session = await this.getSession();
      if (!session) {
        return new Response("Session not found", { status: 404 });
      }
      const { renderSolvePage } = await import("./mobile-ui");
      const origin = url.searchParams.get("origin") ?? "";
      return new Response(renderSolvePage(session, origin), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    if (method === "GET" && url.pathname === "/internal/wait") {
      const timeoutMs = Number(url.searchParams.get("timeoutMs") ?? "120000");
      const result = await this.waitForCompletion(timeoutMs);
      return json(result, result.error ? 500 : 200);
    }

    return json({ error: "Not found" }, 404);
  }

  private async getSession(): Promise<StoredSession | null> {
    return (await this.state.storage.get<StoredSession>(STORAGE_KEY)) ?? null;
  }

  private async saveSession(session: StoredSession): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, session);
  }

  private async updateStatus(
    status: SessionStatus,
    patch: Partial<StoredSession> = {}
  ): Promise<StoredSession> {
    const current = await this.getSession();
    if (!current) {
      throw new Error("Session not initialized");
    }
    const next: StoredSession = {
      ...current,
      ...patch,
      status,
      updatedAt: now()
    };
    await this.saveSession(next);
    return next;
  }

  private async getBrowser(): Promise<BrowserHandle> {
    if (this.#browser) {
      return this.#browser;
    }

    const stored = await this.getSession();
    const keepAliveMs = parseTtlSeconds(this.env.SESSION_TTL_SECONDS) * 1000;

    if (stored?.browserSessionId) {
      try {
        this.#browser = await puppeteer.connect(
          this.env.MYBROWSER,
          stored.browserSessionId
        );
        return this.#browser;
      } catch (error) {
        console.warn("Failed to reconnect to browser session:", error);
      }
    }

    this.#browser = await puppeteer.launch(this.env.MYBROWSER, {
      keep_alive: keepAliveMs
    });

    const browserSessionId = this.#browser.sessionId?.();
    if (browserSessionId) {
      await this.updateStatus(stored?.status ?? "starting", {
        browserSessionId
      });
    }

    return this.#browser;
  }

  private async getActivePage(
    browser: BrowserHandle,
    targetUrl: string
  ): Promise<BrowserPage> {
    const pages = await browser.pages();
    let page = pages.at(-1);
    if (!page) {
      page = await browser.newPage();
    }

    const current = page.url();
    let needsNavigation =
      !current || current === "about:blank" || !current.startsWith("http");

    if (!needsNavigation) {
      try {
        needsNavigation =
          new URL(current).origin !== new URL(targetUrl).origin;
      } catch {
        needsNavigation = true;
      }
    }

    if (needsNavigation) {
      await page.goto(targetUrl, {
        waitUntil: "networkidle2",
        timeout: 60_000
      });
      await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
    }

    return page;
  }

  private async closeBrowser(): Promise<void> {
    if (!this.#browser) {
      return;
    }
    try {
      await this.#browser.close();
    } catch (error) {
      console.warn("Failed to close browser:", error);
    }
    this.#browser = null;
  }

  private async startSession(
    input: SolveCaptchaRequest & {
      sessionId: string;
      origin: string;
    }
  ): Promise<Response> {
    const existing = await this.getSession();
    if (
      existing &&
      existing.status !== "failed" &&
      existing.status !== "expired"
    ) {
      return json({
        sessionId: existing.id,
        status: existing.status,
        solveUrl: `${input.origin}/solve/${existing.id}`,
        challenge: existing.challenge
      });
    }

    const createdAt = now();
    const base: StoredSession = {
      id: input.sessionId,
      status: "starting",
      targetUrl: input.url,
      createdAt,
      updatedAt: createdAt,
      challenge: null,
      error: null,
      result: null,
      browserSessionId: null,
      callbackUrl: input.callbackUrl ?? null
    };
    await this.saveSession(base);

    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(input.url, {
        waitUntil: "networkidle2",
        timeout: 60_000
      });

      await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});

      const challenge = await detectCaptcha(page);
      const solveUrl = `${input.origin}/solve/${input.sessionId}`;

      await this.updateStatus("awaiting_human", { challenge });

      const topic = this.env.NTFY_TOPIC;
      try {
        await sendNtfyAlert({
          topic,
          title: "CAPTCHA needs your attention",
          message: `Tap to solve the ${challenge.kind} challenge for ${input.url}`,
          clickUrl: solveUrl,
          tags: ["warning", "robot", "key"],
          priority: 5
        });
      } catch (error) {
        console.warn(
          "ntfy alert failed; session still active at solve URL",
          error instanceof Error ? error.message : error
        );
      }

      return json({
        sessionId: input.sessionId,
        status: "awaiting_human",
        solveUrl,
        challenge
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start browser session";
      await this.updateStatus("failed", { error: message });
      await this.closeBrowser();
      return json({ error: message }, 500);
    }
  }

  private async submitToken(token: string): Promise<Response> {
    const session = await this.getSession();
    if (!session) {
      return json({ error: "Session not found" }, 404);
    }

    if (session.status === "solved") {
      return json({ ok: true, status: session.status, result: session.result });
    }

    if (session.status !== "awaiting_human") {
      return json(
        { error: `Session is not waiting for human input (${session.status})` },
        409
      );
    }

    await this.updateStatus("injecting");

    try {
      const browser = await this.getBrowser();
      const page = await this.getActivePage(browser, session.targetUrl);

      const kind = session.challenge?.kind ?? "unknown";
      if (token !== "manual-confirmation") {
        await injectCaptchaToken(page, kind, token);
        await page.waitForNetworkIdle({ timeout: 20_000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        await page.waitForNetworkIdle({ timeout: 20_000 }).catch(() => {});
      }

      const payload = await captureAuthPayload(page);
      const cookies = await captureCookies(page);
      const result: AuthPayload = {
        cookies,
        localStorage: payload.localStorage,
        sessionStorage: payload.sessionStorage,
        finalUrl: payload.finalUrl,
        userAgent: payload.userAgent
      };

      await this.updateStatus("solved", { result, error: null });
      await this.closeBrowser();

      if (session.callbackUrl) {
        await fetch(session.callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: session.id,
            status: "solved",
            result
          })
        }).catch((error) => {
          console.warn("Callback delivery failed:", error);
        });
      }

      return json({ ok: true, status: "solved", result });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to inject CAPTCHA token";
      await this.updateStatus("failed", { error: message });
      await this.closeBrowser();
      return json({ error: message }, 500);
    }
  }

  private async waitForCompletion(timeoutMs: number): Promise<{
    sessionId: string;
    status: SessionStatus;
    result: AuthPayload | null;
    error: string | null;
  }> {
    const started = now();
    while (now() - started < timeoutMs) {
      const session = await this.getSession();
      if (!session) {
        return {
          sessionId: "unknown",
          status: "failed",
          result: null,
          error: "Session not found"
        };
      }

      if (session.status === "solved") {
        return {
          sessionId: session.id,
          status: session.status,
          result: session.result,
          error: null
        };
      }

      if (session.status === "failed" || session.status === "expired") {
        return {
          sessionId: session.id,
          status: session.status,
          result: null,
          error: session.error
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const session = await this.getSession();
    return {
      sessionId: session?.id ?? "unknown",
      status: session?.status ?? "failed",
      result: session?.result ?? null,
      error: "Timed out waiting for human CAPTCHA solve"
    };
  }
}
