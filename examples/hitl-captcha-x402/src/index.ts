import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { customAlphabet } from "nanoid";
import { CaptchaSession } from "./captcha-session";
import {
  facilitatorSummary,
  getResourceServer,
  solveCaptchaRouteConfig
} from "./x402-config";
import type { SolveCaptchaRequest } from "./types";

export { CaptchaSession };

const sessionIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  16
);

function getOrigin(request: Request): string {
  const url = new URL(request.url);
  return url.origin;
}

function getSessionStub(env: Env, sessionId: string): DurableObjectStub {
  const id = env.CAPTCHA_SESSION.idFromName(sessionId);
  return env.CAPTCHA_SESSION.get(id);
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  const summary = facilitatorSummary(c.env);
  return c.json({
    service: "hitl-captcha-x402",
    endpoints: {
      solve: "POST /api/solve-captcha",
      mobile: "GET /solve/:sessionId",
      status: "GET /api/session/:sessionId/status",
      submit: "POST /api/session/:sessionId/submit"
    },
    payment: {
      protocol: "x402",
      network: c.env.X402_NETWORK,
      price: c.env.X402_PRICE,
      facilitator: summary
    },
    bazaar: {
      discoverable: summary.bazaarDiscovery,
      docs: "https://docs.cdp.coinbase.com/x402/bazaar"
    }
  });
});

app.use("*", async (c, next) => {
  try {
    await next();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

app.use(async (c, next) => {
  if (c.req.path !== "/api/solve-captcha") {
    return next();
  }
  if (!c.env.SERVER_ADDRESS) {
    return c.json(
      {
        error:
          "SERVER_ADDRESS is not configured. Set it with `wrangler secret put SERVER_ADDRESS`."
      },
      503
    );
  }

  const paid = paymentMiddleware(
    solveCaptchaRouteConfig(c.env),
    getResourceServer(c.env)
  );
  return paid(c, next);
});

app.post("/api/solve-captcha", async (c) => {
  const body = (await c.req.json()) as SolveCaptchaRequest;
  if (!body.url) {
    return c.json({ error: "Missing required field: url" }, 400);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(body.url);
  } catch {
    return c.json({ error: "Invalid url" }, 400);
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return c.json({ error: "Only http(s) URLs are supported" }, 400);
  }

  const sessionId = sessionIdAlphabet();
  const origin = getOrigin(c.req.raw);
  const stub = getSessionStub(c.env, sessionId);

  const startResponse = await stub.fetch("https://do/internal/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      origin,
      url: targetUrl.toString(),
      callbackUrl: body.callbackUrl,
      wait: body.wait
    })
  });

  const started = (await startResponse.json()) as {
    sessionId: string;
    status: string;
    solveUrl: string;
    challenge: unknown;
    error?: string;
  };

  if (!startResponse.ok) {
    return c.json({ error: started.error ?? "Failed to start session" }, 500);
  }

  if (body.wait) {
    const waitResponse = await stub.fetch(
      "https://do/internal/wait?timeoutMs=300000"
    );
    const waited = (await waitResponse.json()) as {
      sessionId: string;
      status: string;
      result: unknown;
      error: string | null;
    };

    if (waited.status === "solved") {
      return c.json({
        sessionId: waited.sessionId,
        status: waited.status,
        solveUrl: started.solveUrl,
        challenge: started.challenge,
        result: waited.result
      });
    }

    return c.json(
      {
        sessionId: waited.sessionId,
        status: waited.status,
        solveUrl: started.solveUrl,
        challenge: started.challenge,
        error: waited.error ?? "Solve did not complete in time"
      },
      504
    );
  }

  return c.json(started, 202);
});

app.get("/api/session/:sessionId/status", async (c) => {
  const stub = getSessionStub(c.env, c.req.param("sessionId"));
  const response = await stub.fetch("https://do/internal/status");
  const data = await response.json();
  return c.json(data, response.status as 200 | 404 | 409 | 500);
});

app.post("/api/session/:sessionId/submit", async (c) => {
  const body = (await c.req.json()) as { token?: string };
  if (!body.token) {
    return c.json({ error: "Missing required field: token" }, 400);
  }

  const stub = getSessionStub(c.env, c.req.param("sessionId"));
  const response = await stub.fetch("https://do/internal/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: body.token })
  });
  const data = await response.json();
  return c.json(data, response.status as 200 | 404 | 409 | 500);
});

app.get("/solve/:sessionId", async (c) => {
  const origin = getOrigin(c.req.raw);
  const stub = getSessionStub(c.env, c.req.param("sessionId"));
  const response = await stub.fetch(
    `https://do/internal/render?origin=${encodeURIComponent(origin)}`
  );
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
});

export default app;
