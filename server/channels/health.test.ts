import { describe, expect, it } from "vitest";
import { deriveAllChannelHealth } from "./health";

const connection = {
  id: 10,
  purpose: "unified",
  status: "connected",
  grantedScopes: "pages_manage_metadata,instagram_manage_messages,whatsapp_business_messaging",
  lastVerifiedAt: new Date("2026-09-04T10:00:00.000Z"),
  lastError: null,
};

const capabilities = [{
  connectionId: 10,
  purpose: "messaging",
  status: "ready",
  enabled: true,
  missingScopes: null,
  lastVerifiedAt: new Date("2026-09-04T10:00:00.000Z"),
}];

const assets = [
  { id: 1, connectionId: 10, assetType: "page", externalId: "page-1", displayName: "صفحة الحجابات", parentExternalId: null, isSelected: true, lastDiscoveredAt: new Date() },
  { id: 2, connectionId: 10, assetType: "instagram", externalId: "instagram-1", displayName: "حساب الحجابات", parentExternalId: "page-1", isSelected: true, lastDiscoveredAt: new Date() },
  { id: 3, connectionId: 10, assetType: "whatsapp_phone", externalId: "phone-1", displayName: "واتساب المتجر", parentExternalId: "waba-1", isSelected: true, lastDiscoveredAt: new Date() },
];

const accounts = [
  { id: 11, channel: "messenger" as const, providerAccountId: "page-1", providerDisplayName: "صفحة الحجابات", connectionStatus: "connected" as const, appSubscriptionStatus: "ready" as const, assetSubscriptionStatus: "ready" as const, subscriptionLastCheckedAt: new Date(), lastInboundAt: new Date(), lastError: null },
  { id: 12, channel: "instagram" as const, providerAccountId: "instagram-1", providerDisplayName: "حساب الحجابات", connectionStatus: "connected" as const, appSubscriptionStatus: "ready" as const, assetSubscriptionStatus: "ready" as const, subscriptionLastCheckedAt: new Date(), lastInboundAt: null, lastError: null },
  { id: 13, channel: "whatsapp" as const, providerAccountId: "phone-1", providerDisplayName: "واتساب المتجر", connectionStatus: "connected" as const, appSubscriptionStatus: "unknown" as const, assetSubscriptionStatus: "unknown" as const, subscriptionLastCheckedAt: null, lastInboundAt: null, lastError: null },
];

describe("deriveAllChannelHealth", () => {
  it("does not report channels as ready without a unified Meta connection and selected assets", () => {
    const result = deriveAllChannelHealth({ accounts: [], connections: [], assets: [], capabilities: [] });

    expect(result.map(channel => channel.status)).toEqual(["needs_setup", "needs_setup", "needs_setup"]);
    expect(result.every(channel => !channel.sendReady)).toBe(true);
  });

  it("reports readiness from selected Meta assets and verified subscriptions", () => {
    const result = deriveAllChannelHealth({ accounts, connections: [connection], assets, capabilities });

    expect(result.map(channel => channel.status)).toEqual(["ready", "ready", "ready"]);
    expect(result.every(channel => channel.sendReady)).toBe(true);
    expect(result.find(channel => channel.channel === "instagram")?.providerAccountId).toBe("instagram-1");
  });

  it("rejects a manually stale channel identity instead of trusting its connected flag", () => {
    const staleAccounts = accounts.map(account => account.channel === "messenger" ? { ...account, providerAccountId: "old-page" } : account);
    const result = deriveAllChannelHealth({ accounts: staleAccounts, connections: [connection], assets, capabilities });
    const messenger = result.find(channel => channel.channel === "messenger");

    expect(messenger?.status).not.toBe("ready");
    expect(messenger?.sendReady).toBe(false);
    expect(messenger?.reasons.join(" ")).toContain("مختلف");
  });

  it("surfaces subscription errors as repair-needed and not as send-ready", () => {
    const brokenAccounts = accounts.map(account => account.channel === "instagram" ? { ...account, assetSubscriptionStatus: "error" as const, lastError: "حقل messages غير مكتمل" } : account);
    const result = deriveAllChannelHealth({ accounts: brokenAccounts, connections: [connection], assets, capabilities });
    const instagram = result.find(channel => channel.channel === "instagram");

    expect(instagram?.status).toBe("error");
    expect(instagram?.sendReady).toBe(false);
    expect(instagram?.reasons.join(" ")).toContain("اشتراك الأصل");
  });
});
