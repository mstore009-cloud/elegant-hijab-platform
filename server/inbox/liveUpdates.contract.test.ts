import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Inbox live update stream", () => {
  const source = readFileSync(resolve(process.cwd(), "server/inbox/liveUpdates.ts"), "utf8");

  it("authenticates the subscriber and applies the same Inbox read permission", () => {
    expect(source).toContain("sdk.authenticateRequest(req)");
    expect(source).toContain('assertPermission(user, "inbox.read", store.id)');
    expect(source).toContain("getOperationalStoreContext(user)");
  });

  it("scopes events to the operational store and emits identifiers only", () => {
    expect(source).toContain("eq(channelWebhookEvents.storeId, store.id)");
    expect(source).toContain('writeFrame(res, "inbox_message", { id: row.id })');
    expect(source).toContain("bodies, customers, assets, and tokens never leave this stream");
  });
});
