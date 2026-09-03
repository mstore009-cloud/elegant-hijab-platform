import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./platformSettings", () => ({
  buildMetaPlatformUrls: (base: string) => ({ oauthCallbackUrl: `${base}/api/meta/oauth/callback`, webhookCallbackUrl: `${base}/api/webhooks/meta` }),
  getMetaRuntimeSettings: vi.fn(),
}));

import { inspectInstagramPageWebhookSubscription } from "./oauth";
import { getMetaRuntimeSettings } from "./platformSettings";

const callbackUrl = "https://eleganthijab-efpivkpx.manus.space/api/webhooks/meta";

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("inspectInstagramPageWebhookSubscription", () => {
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

  it("accepts a linked page messages subscription without trying to inspect Instagram dashboard fields through Graph", async () => {
    const fetcher = vi.fn(async () => {
      return json({ data: [{ id: "app-1", subscribed_fields: ["messages", "message_deliveries"] }] });
    }) as unknown as typeof fetch;

    await expect(inspectInstagramPageWebhookSubscription("page-1", "page-token", fetcher)).resolves.toMatchObject({
      assetReady: true,
      missingPageFields: [],
    });
  });

  it("reports the Page binding as incomplete when messages is missing", async () => {
    const fetcher = vi.fn(async () => {
      return json({ data: [{ id: "app-1", subscribed_fields: ["message_deliveries"] }] });
    }) as unknown as typeof fetch;

    await expect(inspectInstagramPageWebhookSubscription("page-1", "page-token", fetcher)).resolves.toMatchObject({
      assetReady: false,
      missingPageFields: ["messages"],
    });
  });
});
