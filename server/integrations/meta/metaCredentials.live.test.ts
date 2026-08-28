import { describe, expect, it } from "vitest";

const runLive = process.env.META_LIVE_CREDENTIAL_CHECK === "1";

describe.runIf(runLive)("Meta platform credentials — live validation", () => {
  it("exchanges the configured app id and app secret for an app access token", async () => {
    const appId = process.env.META_APP_ID?.trim();
    const appSecret = process.env.META_APP_SECRET?.trim();
    expect(appId, "META_APP_ID is required").toBeTruthy();
    expect(appSecret, "META_APP_SECRET is required").toBeTruthy();

    const url = new URL("https://graph.facebook.com/oauth/access_token");
    url.searchParams.set("client_id", appId!);
    url.searchParams.set("client_secret", appSecret!);
    url.searchParams.set("grant_type", "client_credentials");
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => null) as { access_token?: string; error?: { message?: string; code?: number } } | null;

    expect(response.ok, `Meta rejected the app credentials${body?.error?.code ? ` (${body.error.code})` : ""}: ${body?.error?.message || response.statusText}`).toBe(true);
    expect(body?.access_token).toBeTruthy();
  }, 15_000);

  it("has the central messaging configuration and webhook verification token", () => {
    const configurationId = process.env.META_CONFIG_MESSAGING_ID?.trim();
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
    expect(configurationId).toMatch(/^\d{5,}$/);
    expect(verifyToken?.length).toBeGreaterThanOrEqual(24);
    expect(verifyToken).not.toMatch(/\s/);
  });
});
