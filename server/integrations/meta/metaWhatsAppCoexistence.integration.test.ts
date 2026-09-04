import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { channelAccounts, channelWebhookEvents, customerActivities, customerProfiles, inboxConversationEvents, inboxConversations, inboxMessages, metaAssets, metaConnections, metaHistorySyncJobs, metaWhatsAppHistoryChunks, metaWhatsAppOnboardings, stores, users } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { configureChannelAccount } from "../../channels/db";
import { normalizeMetaEvents } from "../../channels/metaEvents";
import { loadMetaCredential } from "../../channels/metaOutbound";
import { enableWhatsAppHistorySyncJob } from "./historySync";
import { setMetaAssetSelection, upsertDiscoveredMetaAssets, upsertMetaConnection } from "./db";
import { loadWhatsAppBusinessToken, upsertWhatsAppOnboarding } from "./whatsappCoexistence";
import { enqueueWhatsAppCoexistencePayload, processDueWhatsAppHistoryChunks } from "./whatsappHistoryWebhook";

const cleanupStoreIds: number[] = [];

afterEach(async () => {
  const db = await getDb(); if (!db) return;
  for (const storeId of cleanupStoreIds.splice(0)) {
    const conversations = await db.select({ id: inboxConversations.id }).from(inboxConversations).where(eq(inboxConversations.storeId, storeId));
    const conversationIds = conversations.map(item => item.id);
    if (conversationIds.length) {
      await db.delete(inboxConversationEvents).where(inArray(inboxConversationEvents.conversationId, conversationIds));
      await db.delete(inboxMessages).where(inArray(inboxMessages.conversationId, conversationIds));
      await db.delete(inboxConversations).where(inArray(inboxConversations.id, conversationIds));
    }
    await db.delete(channelWebhookEvents).where(eq(channelWebhookEvents.storeId, storeId));
    await db.delete(metaWhatsAppHistoryChunks).where(eq(metaWhatsAppHistoryChunks.storeId, storeId));
    await db.delete(metaHistorySyncJobs).where(eq(metaHistorySyncJobs.storeId, storeId));
    await db.delete(metaWhatsAppOnboardings).where(eq(metaWhatsAppOnboardings.storeId, storeId));
    await db.delete(channelAccounts).where(eq(channelAccounts.storeId, storeId));
    await db.delete(metaAssets).where(eq(metaAssets.storeId, storeId));
    await db.delete(metaConnections).where(eq(metaConnections.storeId, storeId));
    await db.delete(customerActivities).where(eq(customerActivities.storeId, storeId));
    await db.delete(customerProfiles).where(eq(customerProfiles.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
  }
});

async function setup() {
  const db = await getDb(); const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
  if (!db || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار WhatsApp.");
  const created = await db.insert(stores).values({ name: "متجر WhatsApp اختبار", slug: `wa-${randomUUID().slice(0, 12)}`, primaryOwnerUserId: owner.id });
  const storeId = Number(created[0].insertId); cleanupStoreIds.push(storeId);
  const connection = await upsertMetaConnection({ storeId, purpose: "unified", authMode: "external_business", accessToken: "meta-unified-private", tokenExpiresAt: null, grantedScopes: ["whatsapp_business_management", "whatsapp_business_messaging"], metaUserId: "wa-meta-user", metaUserName: null, configurationId: "config", connectedByUserId: owner.id });
  await upsertDiscoveredMetaAssets({ storeId, connectionId: connection.id, purpose: "unified", assets: [{ assetType: "whatsapp_phone", externalId: "phone-coexist", displayName: "رقم الاختبار", parentExternalId: "waba-coexist", accessToken: "asset-private" }] });
  const [asset] = await db.select().from(metaAssets).where(and(eq(metaAssets.storeId, storeId), eq(metaAssets.externalId, "phone-coexist")));
  await setMetaAssetSelection({ storeId, connectionId: connection.id, assetId: asset.id, selected: true });
  const account = await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "whatsapp", providerAccountId: "phone-coexist", providerDisplayName: "رقم الاختبار", connectionStatus: "connected" });
  const onboarding = await upsertWhatsAppOnboarding({ storeId, connectionId: connection.id, wabaId: "waba-coexist", phoneNumberId: "phone-coexist", displayPhoneNumber: "+9647000000000", accessToken: "business-token-private", tokenExpiresAt: null, coexistenceMode: "coexistence", actorUserId: owner.id });
  await enableWhatsAppHistorySyncJob({ storeId, connectionId: connection.id, channelAccountId: account.id, providerAccountId: "phone-coexist", actorUserId: owner.id, coexistence: true });
  return { db, owner, storeId, connection, account, onboarding };
}

describe("WhatsApp Embedded Signup and Coexistence", () => {
  it("يشفّر business token لكل متجر ويفضّله للإرسال دون إعادته في السجلات", async () => {
    const { storeId, account, onboarding } = await setup();
    expect(onboarding.encryptedBusinessToken).not.toContain("business-token-private");
    expect(await loadWhatsAppBusinessToken(storeId, "phone-coexist")).toMatchObject({ accessToken: "business-token-private" });
    await expect(loadMetaCredential(storeId, account)).resolves.toEqual({ accessToken: "business-token-private", providerAccountId: "phone-coexist" });
  });

  it("يحفظ history webhook ثم يعالجه على دفعة مع الوارد والصادر ومنع التكرار دون تسجيله كWebhook حي", async () => {
    const { db, storeId } = await setup();
    const payload = { object: "whatsapp_business_account", entry: [{ id: "waba-coexist", changes: [{ field: "history", value: { metadata: { phone_number_id: "phone-coexist" }, history: [{ metadata: { phase: 2, chunk_order: 1, progress: 100 }, threads: [{ id: "9647111111111", messages: [{ id: "wamid-history-in", from: "9647111111111", timestamp: "1700000000", type: "text", text: { body: "رسالة سابقة واردة" } }, { id: "wamid-history-out", from: "9647000000000", to: "9647111111111", timestamp: "1700000060", type: "text", text: { body: "رد سابق" } }] }] }] } }] }] };
    expect(await enqueueWhatsAppCoexistencePayload(payload)).toMatchObject({ queued: 1, duplicates: 0 });
    expect(await enqueueWhatsAppCoexistencePayload(payload)).toMatchObject({ queued: 0, duplicates: 1 });
    expect(await processDueWhatsAppHistoryChunks(2)).toMatchObject({ attempted: 1, processed: 1 });
    const [conversation] = await db.select().from(inboxConversations).where(and(eq(inboxConversations.storeId, storeId), eq(inboxConversations.externalConversationId, "whatsapp:9647111111111")));
    const messages = await db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversation.id));
    expect(messages.map(message => [message.direction, message.source])).toEqual(expect.arrayContaining([["inbound", "historical_sync"], ["outbound", "historical_sync"]]));
    expect(await db.select().from(channelWebhookEvents).where(eq(channelWebhookEvents.storeId, storeId))).toHaveLength(0);
    const [chunk] = await db.select().from(metaWhatsAppHistoryChunks).where(eq(metaWhatsAppHistoryChunks.storeId, storeId));
    expect(chunk).toMatchObject({ status: "processed", payloadJson: null, progress: 100 });
    const [job] = await db.select().from(metaHistorySyncJobs).where(and(eq(metaHistorySyncJobs.storeId, storeId), eq(metaHistorySyncJobs.channel, "whatsapp")));
    expect(job).toMatchObject({ status: "completed", processedMessages: 2 });
  });

  it("يطبع smb_message_echoes كرسالة صادرة حية للعميل الصحيح", () => {
    const events = normalizeMetaEvents({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "smb_message_echoes", value: { metadata: { phone_number_id: "phone-coexist" }, messages: [{ id: "echo-1", from: "9647000000000", to: "9647111111111", timestamp: "1700000100", type: "text", text: { body: "رد من تطبيق الأعمال" } }] } }] }] });
    expect(events[0]).toMatchObject({ kind: "message", direction: "outbound", providerAccountId: "phone-coexist", externalConversationId: "whatsapp:9647111111111", source: "live_webhook" });
  });
});
