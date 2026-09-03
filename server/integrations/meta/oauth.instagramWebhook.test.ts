import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./platformSettings", () => ({
  buildMetaPlatformUrls: (base: string) => ({ oauthCallbackUrl: `${base}/api/meta/oauth/callback`, webhookCallbackUrl: `${base}/api/webhooks/meta` }),
  getMetaRuntimeSettings: vi.fn(),
}));

import { inspectInstagramWebhookSubscription } from "./oauth";
import { getMetaRuntimeSettings } from "./platformSettings";

const callbackUrl = "https://eleganthijab-efpivkpx.manus.space/api/webhooks/meta";

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("inspectInstagramWebhookSubscription", () => {
  beforeEach(() => {
    vi.mocked(getMetaRuntimeSettings).mockResolvedValue({
      appId: "app-1",
      appSecret: "secret-1",
      businessLoginConfigurationId: "",
      whatsappEmbeddedSignupConfigurationId: "",
      webhookVerifyToken: "verify-1",
      graphApiVersion: "v26.0",
      publicBaseUrl: "https://eleganthijab-efpivkpx.manus.space",
      activeTemplateVersion: 1,
      source: "database",
    });
  });

  it("accepts only a matching Instagram callback with every required field and a linked page messages subscription", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/app-1/subscriptions")) {
        return json({ data: [{ object: "instagram", callback_url: callbackUrl, fields: ["messages", "messaging_postbacks", "comments", "mentions"] }] });
      }
      return json({ data: [{ id: "app-1", subscribed_fields: ["messages", "message_deliveries"] }] });
    }) as unknown as typeof fetch;

    await expect(inspectInstagramWebhookSubscription("page-1", "page-token", fetcher)).resolves.toMatchObject({
      appReady: true,
      assetReady: true,
      missingAppFields: [],
      missingPageFields: [],
    });
  });

  it("reports a false-ready state when the Instagram app subscription is missing required fields", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/app-1/subscriptions")) return json({ data: [{ object: "instagram", callback_url: callbackUrl, fields: ["messages"] }] });
      return json({ data: [{ id: "app-1", subscribed_fields: ["messages"] }] });
    }) as unknown as typeof fetch;

    await expect(inspectInstagramWebhookSubscription("page-1", "page-token", fetcher)).resolves.toMatchObject({
      appReady: false,
      assetReady: true,
      missingAppFields: ["messaging_postbacks", "comments", "mentions"],
    });
  });
});
