import type { CaptchaChallenge, SessionRecord } from "./types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function captchaWidgetMarkup(challenge: CaptchaChallenge): string {
  if (!challenge.siteKey) {
    return `
      <section class="card warn">
        <h2>Manual verification</h2>
        <p>We could not extract a widget site key. Review the screenshot below, complete any challenge on the target site if needed, then confirm once access is granted.</p>
        <button id="manual-complete" class="primary" type="button">I completed the challenge</button>
      </section>
    `;
  }

  const siteKey = escapeHtml(challenge.siteKey);
  const action = challenge.extra.action
    ? ` data-action="${escapeHtml(challenge.extra.action)}"`
    : "";
  const theme = challenge.extra.theme
    ? ` data-theme="${escapeHtml(challenge.extra.theme)}"`
    : "";
  const size = challenge.extra.size
    ? ` data-size="${escapeHtml(challenge.extra.size)}"`
    : "";

  if (challenge.kind === "turnstile") {
    return `
      <section class="card">
        <h2>Cloudflare Turnstile</h2>
        <p>Complete the challenge below. Your response is injected into the headless browser session automatically.</p>
        <div class="widget-shell">
          <div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="onCaptchaSolved"${action}${theme}${size}></div>
        </div>
      </section>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    `;
  }

  if (challenge.kind === "hcaptcha") {
    return `
      <section class="card">
        <h2>hCaptcha</h2>
        <p>Complete the challenge below. Your response is injected into the headless browser session automatically.</p>
        <div class="widget-shell">
          <div class="h-captcha" data-sitekey="${siteKey}" data-callback="onCaptchaSolved"${theme}${size}></div>
        </div>
      </section>
      <script src="https://js.hcaptcha.com/1/api.js" async defer></script>
    `;
  }

  return `
    <section class="card">
      <h2>reCAPTCHA</h2>
      <p>Complete the challenge below. Your response is injected into the headless browser session automatically.</p>
      <div class="widget-shell">
        <div class="g-recaptcha" data-sitekey="${siteKey}" data-callback="onCaptchaSolved"${theme}${size}></div>
      </div>
    </section>
    <script src="https://www.google.com/recaptcha/api.js" async defer></script>
  `;
}

export function renderSolvePage(
  session: SessionRecord,
  origin: string
): string {
  const title = escapeHtml(session.challenge?.pageTitle || "CAPTCHA solve");
  const targetUrl = escapeHtml(session.targetUrl);
  const sessionId = escapeHtml(session.id);
  const status = escapeHtml(session.status);
  const challenge = session.challenge;
  const screenshot = challenge?.screenshotBase64
    ? `<img class="screenshot" alt="Target page preview" src="data:image/png;base64,${challenge.screenshotBase64}" />`
    : "";

  const widget = challenge
    ? captchaWidgetMarkup(challenge)
    : `<section class="card warn"><p>No challenge metadata is available yet. Refresh in a few seconds.</p></section>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1220;
        --card: #111a2e;
        --line: #24324d;
        --text: #e8eefc;
        --muted: #9fb0d0;
        --accent: #6ea8ff;
        --ok: #3dd68c;
        --warn: #ffcc66;
        --danger: #ff6b6b;
        --radius: 18px;
        --shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(110, 168, 255, 0.18), transparent 42%),
          var(--bg);
        color: var(--text);
        min-height: 100dvh;
      }
      main {
        width: min(100%, 560px);
        margin: 0 auto;
        padding: 20px 16px calc(24px + env(safe-area-inset-bottom));
      }
      header {
        margin-bottom: 16px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 1.35rem;
        line-height: 1.2;
      }
      .meta, .status {
        color: var(--muted);
        font-size: 0.92rem;
        word-break: break-word;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        padding: 8px 12px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.03);
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--warn);
        box-shadow: 0 0 12px rgba(255, 204, 102, 0.8);
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 16px;
        box-shadow: var(--shadow);
        margin-bottom: 14px;
      }
      .card h2 {
        margin: 0 0 8px;
        font-size: 1.05rem;
      }
      .card p {
        margin: 0 0 12px;
        color: var(--muted);
        line-height: 1.45;
      }
      .card.warn {
        border-color: rgba(255, 204, 102, 0.45);
      }
      .widget-shell {
        display: flex;
        justify-content: center;
        overflow: hidden;
        border-radius: 14px;
        background: #0a1020;
        padding: 14px 8px;
      }
      .screenshot {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--line);
        display: block;
      }
      .actions {
        display: grid;
        gap: 10px;
      }
      button {
        appearance: none;
        border: 0;
        border-radius: 14px;
        min-height: 52px;
        padding: 14px 16px;
        font-size: 1rem;
        font-weight: 600;
        touch-action: manipulation;
      }
      button.primary {
        background: linear-gradient(180deg, #7db1ff, #4f87ef);
        color: #041024;
      }
      button.secondary {
        background: rgba(255, 255, 255, 0.06);
        color: var(--text);
        border: 1px solid var(--line);
      }
      button:disabled {
        opacity: 0.55;
      }
      #toast {
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: calc(16px + env(safe-area-inset-bottom));
        padding: 14px 16px;
        border-radius: 14px;
        background: rgba(17, 26, 46, 0.96);
        border: 1px solid var(--line);
        box-shadow: var(--shadow);
        display: none;
      }
      #toast.show { display: block; }
      #toast.ok { border-color: rgba(61, 214, 140, 0.5); color: var(--ok); }
      #toast.error { border-color: rgba(255, 107, 107, 0.5); color: var(--danger); }
      a { color: var(--accent); }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>CAPTCHA handoff</h1>
        <div class="meta">Target: <a href="${targetUrl}" rel="noreferrer">${targetUrl}</a></div>
        <div class="status"><span class="dot"></span><span id="status-label">${status}</span></div>
      </header>

      ${widget}

      <section class="card">
        <h2>Live preview</h2>
        <p>This is what the automation browser currently sees.</p>
        ${screenshot}
      </section>

      <section class="card actions">
        <button id="refresh-status" class="secondary" type="button">Refresh status</button>
      </section>
    </main>

    <div id="toast" role="status" aria-live="polite"></div>

    <script>
      const sessionId = ${JSON.stringify(sessionId)};
      const origin = ${JSON.stringify(origin)};
      const statusLabel = document.getElementById("status-label");
      const toast = document.getElementById("toast");
      let submitting = false;

      function showToast(message, kind) {
        toast.textContent = message;
        toast.className = "show " + (kind || "");
      }

      async function pollStatus() {
        const res = await fetch(origin + "/api/session/" + sessionId + "/status");
        const data = await res.json();
        statusLabel.textContent = data.status;
        if (data.status === "solved") {
          showToast("Challenge solved. You can close this tab.", "ok");
        }
        if (data.status === "failed") {
          showToast(data.error || "Session failed.", "error");
        }
        return data;
      }

      async function submitToken(token) {
        if (submitting) return;
        submitting = true;
        showToast("Submitting your response…", "");
        try {
          const res = await fetch(origin + "/api/session/" + sessionId + "/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Submit failed");
          }
          showToast("Token accepted. Finishing browser session…", "ok");
          await pollStatus();
        } catch (error) {
          showToast(error.message || "Submit failed", "error");
          submitting = false;
        }
      }

      window.onCaptchaSolved = function(token) {
        submitToken(token);
      };

      document.getElementById("refresh-status")?.addEventListener("click", () => {
        pollStatus().catch((error) => showToast(error.message, "error"));
      });

      document.getElementById("manual-complete")?.addEventListener("click", () => {
        submitToken("manual-confirmation");
      });

      setInterval(() => {
        pollStatus().catch(() => {});
      }, 5000);
    </script>
  </body>
</html>`;
}
