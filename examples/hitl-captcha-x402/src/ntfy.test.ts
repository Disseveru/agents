import { afterEach, describe, expect, it, vi } from "vitest";
import { sendNtfyAlert } from "./ntfy";

describe("sendNtfyAlert", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the ntfy.sh topic URL with the message as the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendNtfyAlert({
      topic: "hitl-captcha-alerts",
      title: "CAPTCHA needs your attention",
      message: "Tap to solve the turnstile challenge",
      clickUrl: "https://worker.example/solve/abc123"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.sh/hitl-captcha-alerts");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("Tap to solve the turnstile challenge");
  });

  it("sets the Title, Click, and Content-Type headers from the provided options", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendNtfyAlert({
      topic: "my-topic",
      title: "Hello",
      message: "World",
      clickUrl: "https://example.com/solve/xyz"
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Title).toBe("Hello");
    expect(headers.Click).toBe("https://example.com/solve/xyz");
    expect(headers["Content-Type"]).toBe("text/plain; charset=utf-8");
  });

  it("defaults Tags to warning,robot and Priority to 4 when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendNtfyAlert({
      topic: "my-topic",
      title: "Hello",
      message: "World",
      clickUrl: "https://example.com/solve/xyz"
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Tags).toBe("warning,robot");
    expect(headers.Priority).toBe("4");
  });

  it("uses custom tags and priority when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendNtfyAlert({
      topic: "my-topic",
      title: "Hello",
      message: "World",
      clickUrl: "https://example.com/solve/xyz",
      tags: ["skull", "fire"],
      priority: 5
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Tags).toBe("skull,fire");
    expect(headers.Priority).toBe("5");
  });

  it("throws an error including the status and body text when the response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("topic not found", { status: 404 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendNtfyAlert({
        topic: "missing-topic",
        title: "Hello",
        message: "World",
        clickUrl: "https://example.com/solve/xyz"
      })
    ).rejects.toThrow("ntfy notification failed (404): topic not found");
  });

  it("resolves without throwing when the response is ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendNtfyAlert({
        topic: "my-topic",
        title: "Hello",
        message: "World",
        clickUrl: "https://example.com/solve/xyz"
      })
    ).resolves.toBeUndefined();
  });
});