import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { channelAccounts, channelWebhookEvents, customerActivities, customerProfiles, inboxConversationEvents, inboxConversations, inboxMessages, metaAssets, metaConnections, stores, users } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { configureChannelAccount } from "../../channels/db";
import { enqueueAndProcessMetaEvent, normalizeMetaEvents } from "../../channels/metaEvents";
import { disconnectMetaConnection, getMetaConnection, setMetaAssetSelection, upsertDiscoveredMetaAssets, upsertMetaConnection } from "./db";

const cleanupStoreIds: number[] = [];

afterEach(async () => {
  const db = await getDb(); if (!db) return;
  for (const storeId of cleanupStoreIds.splice(0)) {
    const conversations = await db.select({ id: inboxConversations.id }).from(inboxConversations).where(eq(inboxConversations.storeId, storeId));
    const ids = conversations.map(item => item.id);
    if (ids.length) {
      await db.delete(inboxConversationEvents).where(inArray(inboxConversationEvents.conversationId, ids));
      await db.delete(inboxMessages).where(inArray(inboxMessages.conversationId, ids));
      await db.delete(inboxConversations).where(inArray(inboxConversations.id, ids));
    }
    await db.delete(channelWebhookEvents).where(eq(channelWebhookEvents.storeId, storeId));
    await db.delete(channelAccounts).where(eq(channelAccounts.storeId, storeId));
    await db.delete(metaAssets).where(eq(metaAssets.storeId, storeId));
    await db.delete(metaConnections).where(eq(metaConnections.storeId, storeId));
    await db.delete(customerActivities).where(eq(customerActivities.storeId, storeId));
    await db.delete(customerProfiles).where(eq(customerProfiles.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
  }
});

async function createStoreBinding(label: string) {
  const db = await getDb(); const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
  if (!db || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار تعدد المتاجر.");
  const created = await db.insert(stores).values({ name: `متجر ${label}`, slug: `meta-${label}-${randomUUID().slice(0, 8)}`, primaryOwnerUserId: owner.id });
  const storeId = Number(created[0].insertId); cleanupStoreIds.push(storeId);
  const pageId = `page-${label}-${randomUUID().slice(0, 8)}`;
  const connection = await upsertMetaConnection({ storeId, purpose: "unified", authMode: "external_business", templateVersion: 7, accessToken: `token-${label}-private`, tokenExpiresAt: null, grantedScopes: ["pages_messaging", "pages_manage_metadata"], metaUserId: `meta-${label}`, metaUserName: label, configurationId: "central-config", connectedByUserId: owner.id });
  await upsertDiscoveredMetaAssets({ storeId, connectionId: connection.id, purpose: "unified", assets: [{ assetType: "page", externalId: pageId, displayName: `صفحة ${label}`, accessToken: `page-token-${label}` }] });
  const [asset] = await db.select().from(metaAssets).where(and(eq(metaAssets.storeId, storeId), eq(metaAssets.externalId, pageId)));
  await setMetaAssetSelection({ storeId, connectionId: connection.id, assetId: asset.id, selected: true });
  await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "messenger", providerAccountId: pageId, providerDisplayName: `صفحة ${label}`, connectionStatus: "connected" });
  return { db, storeId, pageId, connection, asset };
}

describe("قالب Meta متعدد المتاجر", () => {
  it("يعزل أصل ورسائل كل متجر ويمنع اختيار أصل متجر آخر ويبطل اتصالاً واحداً فقط", async () => {
    const first = await createStoreBinding("أ");
    const second = await createStoreBinding("ب");
    const firstEvent = normalizeMetaEvents({ object: "page", entry: [{ id: first.pageId, messaging: [{ sender: { id: "customer-a" }, timestamp: 1_700_000_000_000, message: { mid: "mid-store-a", text: "رسالة للمتجر أ" } }] }] })[0];
    const secondEvent = normalizeMetaEvents({ object: "page", entry: [{ id: second.pageId, messaging: [{ sender: { id: "customer-b" }, timestamp: 1_700_000_100_000, message: { mid: "mid-store-b", text: "رسالة للمتجر ب" } }] }] })[0];
    await expect(enqueueAndProcessMetaEvent(firstEvent, "hash-store-a")).resolves.toMatchObject({ accepted: true, processed: true });
    await expect(enqueueAndProcessMetaEvent(secondEvent, "hash-store-b")).resolves.toMatchObject({ accepted: true, processed: true });
    const firstMessages = await first.db.select({ body: inboxMessages.body }).from(inboxMessages).innerJoin(inboxConversations, eq(inboxMessages.conversationId, inboxConversations.id)).where(eq(inboxConversations.storeId, first.storeId));
    const secondMessages = await second.db.select({ body: inboxMessages.body }).from(inboxMessages).innerJoin(inboxConversations, eq(inboxMessages.conversationId, inboxConversations.id)).where(eq(inboxConversations.storeId, second.storeId));
    expect(firstMessages.map(item => item.body)).toEqual(["رسالة للمتجر أ"]);
    expect(secondMessages.map(item => item.body)).toEqual(["رسالة للمتجر ب"]);
    await expect(setMetaAssetSelection({ storeId: first.storeId, connectionId: first.connection.id, assetId: second.asset.id, selected: true })).rejects.toThrow("لا ينتمي");
    await expect(disconnectMetaConnection(first.storeId, "unified")).resolves.toBe(true);
    await expect(getMetaConnection(first.storeId, "unified")).resolves.toMatchObject({ status: "revoked", encryptedAccessToken: null });
    await expect(getMetaConnection(second.storeId, "unified")).resolves.toMatchObject({ status: "connected", templateVersion: 7 });
  });
});
