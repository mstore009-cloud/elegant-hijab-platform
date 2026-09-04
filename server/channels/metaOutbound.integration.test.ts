import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { channelAccounts, customerBotRuns, inboxConversationEvents, inboxConversations, inboxMessages, metaAssets, metaConnections, metaOutboundMessages, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { configureChannelAccount } from "./db";
import { sendMetaConversationMessage } from "./metaOutbound";
import { selectMetaAsset, upsertDiscoveredMetaAssets, upsertMetaConnection } from "../integrations/meta/db";

const cleanupStoreIds: number[] = [];

afterEach(async () => {
  const db = await getDb(); if (!db) return;
  for (const storeId of cleanupStoreIds.splice(0)) {
    const conversations = await db.select({ id: inboxConversations.id }).from(inboxConversations).where(eq(inboxConversations.storeId, storeId));
    const ids = conversations.map(item => item.id);
    if (ids.length) {
      await db.delete(metaOutboundMessages).where(inArray(metaOutboundMessages.conversationId, ids));
      await db.delete(customerBotRuns).where(inArray(customerBotRuns.conversationId, ids));
      await db.delete(inboxConversationEvents).where(inArray(inboxConversationEvents.conversationId, ids));
      await db.delete(inboxMessages).where(inArray(inboxMessages.conversationId, ids));
      await db.delete(inboxConversations).where(inArray(inboxConversations.id, ids));
    }
    await db.delete(channelAccounts).where(eq(channelAccounts.storeId, storeId));
    await db.delete(metaAssets).where(eq(metaAssets.storeId, storeId));
    await db.delete(metaConnections).where(eq(metaConnections.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
  }
});

async function setup() {
  const db = await getDb(); const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
  if (!db || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار الإرسال اليدوي.");
  const created = await db.insert(stores).values({ name: "متجر اختبار إرسال Meta", slug: `meta-send-${randomUUID().slice(0, 8)}`, primaryOwnerUserId: owner.id });
  const storeId = Number(created[0].insertId); cleanupStoreIds.push(storeId);
  const suffix = String(storeId);
  const connection = await upsertMetaConnection({ storeId, purpose: "messaging", accessToken: "connection-token-secret", tokenExpiresAt: new Date(Date.now() + 3_600_000), grantedScopes: ["pages_messaging", "whatsapp_business_messaging"], metaUserId: "meta-send-user", metaUserName: "مدير الاختبار", configurationId: "config-send", connectedByUserId: owner.id });
  await upsertDiscoveredMetaAssets({ storeId, connectionId: connection.id, purpose: "messaging", assets: [
    { assetType: "page", externalId: `page-send-${suffix}`, displayName: "صفحة الإرسال", accessToken: "page-token-secret" },
    { assetType: "instagram", externalId: `ig-send-${suffix}`, displayName: "@ig_send", parentExternalId: `page-send-${suffix}` },
    { assetType: "whatsapp_phone", externalId: `phone-send-${suffix}`, displayName: "+964000000" },
  ] });
  const assets = await db.select().from(metaAssets).where(eq(metaAssets.storeId, storeId));
  for (const asset of assets) await selectMetaAsset({ storeId, connectionId: connection.id, assetId: asset.id });
  for (const [channel, providerAccountId] of [["messenger", `page-send-${suffix}`], ["instagram", `ig-send-${suffix}`], ["whatsapp", `phone-send-${suffix}`]] as const) await configureChannelAccount({ storeId, actorUserId: owner.id, channel, providerAccountId, providerDisplayName: providerAccountId, connectionStatus: "testing" });
  return { db, owner, storeId };
}

describe("Meta manual outbound delivery", () => {
  it("يرسل يدوياً عبر القنوات الثلاث برمز المتجر الصحيح ويسجل الرسالة مرة واحدة", async () => {
    const { db, owner, storeId } = await setup();
    const transport = vi.fn(async (input: { channel: string; accessToken: string }) => ({ externalMessageId: `external-${input.channel}` }));
    for (const [channel, expectedToken] of [["messenger", "page-token-secret"], ["instagram", "page-token-secret"], ["whatsapp", "connection-token-secret"]] as const) {
      const created = await db.insert(inboxConversations).values({ storeId, channel, externalConversationId: `${channel}:recipient-${channel}`, contactNameSnapshot: "عميلة الاختبار", status: "open", createdByUserId: owner.id });
      const conversationId = Number(created[0].insertId); const idempotencyKey = randomUUID();
      await db.insert(inboxMessages).values({ conversationId, direction: "inbound", body: "رسالة عميلة حديثة", externalMessageId: `inbound-${channel}` });
      const sent = await sendMetaConversationMessage({ storeId, conversationId, body: `رسالة ${channel}`, idempotencyKey, mode: "manual", actorUserId: owner.id }, transport as any);
      expect(sent).toMatchObject({ status: "sent", duplicate: false, externalMessageId: `external-${channel}` });
      expect(transport).toHaveBeenLastCalledWith(expect.objectContaining({ channel, accessToken: expectedToken, recipientExternalId: `recipient-${channel}` }));
      const duplicate = await sendMetaConversationMessage({ storeId, conversationId, body: `رسالة ${channel}`, idempotencyKey, mode: "manual", actorUserId: owner.id }, transport as any);
      expect(duplicate).toMatchObject({ status: "sent", duplicate: true });
      const messages = await db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversationId));
      expect(messages).toHaveLength(2); expect(messages.find(message => message.direction === "outbound")).toMatchObject({ direction: "outbound", deliveryStatus: "sent", externalMessageId: `external-${channel}` });
    }
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("يسجل الرد الآلي بوضع bot_guarded في صندوق الإرسال ويمنع تكراره", async () => {
    const { db, owner, storeId } = await setup();
    const created = await db.insert(inboxConversations).values({ storeId, channel: "messenger", externalConversationId: "messenger:recipient-bot", contactNameSnapshot: "عميلة البوت", status: "open", createdByUserId: owner.id });
    const conversationId = Number(created[0].insertId);
    const inbound = await db.insert(inboxMessages).values({ conversationId, direction: "inbound", body: "رسالة حديثة من العميلة", externalMessageId: "inbound-bot" });
    const run = await db.insert(customerBotRuns).values({ storeId, conversationId, sourceMessageId: Number(inbound[0].insertId), route: "fast", status: "draft", model: "gpt-5-mini", confidence: 90, factsSnapshot: "{}", replyDraft: "أهلاً" });
    const botRunId = Number(run[0].insertId);
    const transport = vi.fn(async () => ({ externalMessageId: "external-bot" }));
    const idempotencyKey = `bot:run-${randomUUID()}`;
    const sent = await sendMetaConversationMessage({ storeId, conversationId, body: "أهلاً، أساعدك بالمعلومات المتاحة.", idempotencyKey, mode: "bot_guarded", actorUserId: owner.id, botRunId }, transport as any);
    expect(sent).toMatchObject({ status: "sent", duplicate: false });
    const [outbox] = await db.select().from(metaOutboundMessages).where(eq(metaOutboundMessages.conversationId, conversationId));
    expect(outbox).toMatchObject({ mode: "bot_guarded", botRunId, status: "sent", externalMessageId: "external-bot" });
    const duplicate = await sendMetaConversationMessage({ storeId, conversationId, body: "أهلاً، أساعدك بالمعلومات المتاحة.", idempotencyKey, mode: "bot_guarded", actorUserId: owner.id, botRunId }, transport as any);
    expect(duplicate.duplicate).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("يسجل فشل المزود ولا ينشئ رسالة صادرة ناجحة", async () => {
    const { db, owner, storeId } = await setup();
    const created = await db.insert(inboxConversations).values({ storeId, channel: "messenger", externalConversationId: "messenger:recipient-failed", status: "open", createdByUserId: owner.id });
    const conversationId = Number(created[0].insertId);
    await db.insert(inboxMessages).values({ conversationId, direction: "inbound", body: "رسالة عميلة حديثة", externalMessageId: "inbound-failed" });
    await expect(sendMetaConversationMessage({ storeId, conversationId, body: "اختبار فشل", idempotencyKey: randomUUID(), mode: "manual", actorUserId: owner.id }, async () => { throw Object.assign(new Error("رفض المزود الرسالة"), { code: "META_REJECTED" }); })).rejects.toThrow("رفض المزود الرسالة");
    const [outbox] = await db.select().from(metaOutboundMessages).where(eq(metaOutboundMessages.conversationId, conversationId));
    expect(outbox).toMatchObject({ status: "failed", errorCode: "META_REJECTED" });
    expect((await db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversationId))).filter(message => message.direction === "outbound")).toHaveLength(0);
  });

  it("يمنع الرسالة الحرة خارج نافذة 24 ساعة قبل استدعاء المزود", async () => {
    const { db, owner, storeId } = await setup();
    const created = await db.insert(inboxConversations).values({ storeId, channel: "instagram", externalConversationId: "instagram:recipient-old", status: "open", createdByUserId: owner.id });
    const conversationId = Number(created[0].insertId);
    await db.insert(inboxMessages).values({ conversationId, direction: "inbound", body: "رسالة قديمة", externalMessageId: "inbound-old", occurredAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    const transport = vi.fn();
    await expect(sendMetaConversationMessage({ storeId, conversationId, body: "رد متأخر", idempotencyKey: randomUUID(), mode: "manual", actorUserId: owner.id }, transport as any)).rejects.toThrow("24 ساعة");
    expect(transport).not.toHaveBeenCalled();
  });

  it("يرفض إرسال محادثة من متجر آخر قبل استدعاء المزود", async () => {
    const first = await setup(); const second = await setup();
    const created = await first.db.insert(inboxConversations).values({ storeId: first.storeId, channel: "whatsapp", externalConversationId: "whatsapp:recipient-scoped", status: "open", createdByUserId: first.owner.id });
    const transport = vi.fn();
    await expect(sendMetaConversationMessage({ storeId: second.storeId, conversationId: Number(created[0].insertId), body: "يجب رفضها", idempotencyKey: randomUUID(), mode: "manual", actorUserId: second.owner.id }, transport as any)).rejects.toThrow("المحادثة لا تنتمي");
    expect(transport).not.toHaveBeenCalled();
  });
});
