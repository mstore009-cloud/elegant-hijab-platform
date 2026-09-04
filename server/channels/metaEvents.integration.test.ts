import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { channelAccounts, channelWebhookEvents, customerActivities, customerProfiles, inboxConversationEvents, inboxConversations, inboxMessageMedia, inboxMessages, metaAssets, metaConnections, metaLeadCaptures, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { configureChannelAccount } from "./db";
import { enqueueAndProcessMetaEvent, getMetaEventHealth, normalizeMetaEvents, requeueMetaDeadLetters, retryDueMetaEvents } from "./metaEvents";

const cleanups: Array<{ storeId: number; conversationIds: number[] }> = [];

afterEach(async () => {
  const db = await getDb(); if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    const messages = cleanup.conversationIds.length ? await db.select({ id: inboxMessages.id }).from(inboxMessages).where(inArray(inboxMessages.conversationId, cleanup.conversationIds)) : [];
    const messageIds = messages.map(row => row.id);
    if (messageIds.length) await db.delete(inboxMessageMedia).where(inArray(inboxMessageMedia.messageId, messageIds));
    for (const conversationId of cleanup.conversationIds) {
      await db.delete(inboxConversationEvents).where(eq(inboxConversationEvents.conversationId, conversationId));
      await db.delete(inboxMessages).where(eq(inboxMessages.conversationId, conversationId));
      await db.delete(inboxConversations).where(eq(inboxConversations.id, conversationId));
    }
    await db.delete(customerActivities).where(eq(customerActivities.storeId, cleanup.storeId));
    await db.delete(metaLeadCaptures).where(eq(metaLeadCaptures.storeId, cleanup.storeId));
    await db.delete(customerProfiles).where(eq(customerProfiles.storeId, cleanup.storeId));
    await db.delete(channelWebhookEvents).where(eq(channelWebhookEvents.storeId, cleanup.storeId));
    await db.delete(channelAccounts).where(eq(channelAccounts.storeId, cleanup.storeId));
    await db.delete(metaAssets).where(eq(metaAssets.storeId, cleanup.storeId));
    await db.delete(metaConnections).where(eq(metaConnections.storeId, cleanup.storeId));
    await db.delete(stores).where(eq(stores.id, cleanup.storeId));
  }
});

async function setup() {
  const db = await getDb(); const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
  if (!db || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار Unified Webhook Gateway.");
  const created = await db.insert(stores).values({ name: "متجر اختبار Meta Events", slug: `meta-events-${randomUUID().slice(0, 8)}`, primaryOwnerUserId: owner.id });
  const storeId = Number(created[0].insertId); const cleanup = { storeId, conversationIds: [] as number[] }; cleanups.push(cleanup);
  return { db, owner, storeId, cleanup };
}

describe("Unified Meta Webhook Gateway", () => {
  it("يطبع Messenger ورسائل Instagram وحالات WhatsApp والتعليقات إلى أنواع أحداث موحدة", () => {
    const richMessenger = normalizeMetaEvents({ object: "page", entry: [{ id: "page-rich", messaging: [{ sender: { id: "customer-rich" }, timestamp: 1760000000000, message: { mid: "mid-rich", text: "هل هذا رد على القصة؟", reply_to: { mid: "mid-root", text: "الصورة الأصلية" }, story_id: "story-1", mentions: [{ id: "staff-1", name: "موظفة" }] } }] }] });
    expect(richMessenger[0]).toMatchObject({ kind: "message", metadata: { messageType: "text", replyToExternalMessageId: "mid-root", replyToBodyPreview: "الصورة الأصلية", storyId: "story-1", mentions: [{ id: "staff-1", name: "موظفة" }] } });
    const messenger = normalizeMetaEvents({ object: "page", entry: [{ id: "page-1", messaging: [{ sender: { id: "customer-1" }, timestamp: 1760000000000, message: { mid: "mid-page-1", text: "هل المنتج متوفر؟" } }], changes: [{ field: "feed", value: { comment_id: "comment-1", post_id: "post-1", message: "أريد هذا اللون" } }] }] });
    expect(messenger).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "message", channel: "messenger", providerAccountId: "page-1", externalMessageId: "mid-page-1" }), expect.objectContaining({ kind: "comment", externalEventId: "comment:comment-1" })]));
    const whatsapp = normalizeMetaEvents({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-1" }, statuses: [{ id: "wamid-out-1", status: "read", timestamp: "1760000000" }] } }] }] });
    expect(whatsapp).toEqual([expect.objectContaining({ kind: "delivery_status", providerAccountId: "phone-1", externalMessageId: "wamid-out-1", status: "read" })]);
  });

  it("يحجز حدث Messenger مرة واحدة وينشئ رسالة واردة داخل متجر الحساب فقط", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "messenger", providerAccountId: "page-gateway", providerDisplayName: "صفحة الاختبار", connectionStatus: "testing" });
    const [event] = normalizeMetaEvents({ object: "page", entry: [{ id: "page-gateway", messaging: [{ sender: { id: "customer-gateway" }, timestamp: 1760000000000, message: { mid: "mid-gateway", text: "السلام عليكم", reply_to: { mid: "mid-root-gateway", text: "الرسالة السابقة" }, mentions: [{ id: "staff-gateway", name: "الموظفة" }] } }] }] });
    expect(event.kind).toBe("message");
    const first = await enqueueAndProcessMetaEvent(event, "hash-gateway");
    expect(first).toMatchObject({ accepted: true, duplicate: false, processed: true });
    const duplicate = await enqueueAndProcessMetaEvent(event, "hash-gateway");
    expect(duplicate).toMatchObject({ accepted: true, duplicate: true });
    const [conversation] = await db.select().from(inboxConversations).where(eq(inboxConversations.externalConversationId, "messenger:customer-gateway"));
    cleanup.conversationIds.push(conversation.id);
    const messages = await db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversation.id));
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe("السلام عليكم");
    expect(JSON.parse(messages[0].metadataJson ?? "{}")).toMatchObject({ messageType: "text", replyToExternalMessageId: "mid-root-gateway", replyToBodyPreview: "الرسالة السابقة", mentions: [{ id: "staff-gateway", name: "الموظفة" }] });
  });

  it("يربط رسالة WhatsApp الواردة بملف CRM حسب الهاتف ويسجل نشاط الرسالة", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "whatsapp", providerAccountId: "phone-crm-link", providerDisplayName: "واتساب CRM", connectionStatus: "testing" });
    const [event] = normalizeMetaEvents({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-crm-link" }, contacts: [{ wa_id: "07861162113", profile: { name: "عميلة واتساب" } }], messages: [{ id: "wamid-crm-link", from: "07861162113", timestamp: "1760000000", text: { body: "أريد معرفة السعر" } }] } }] }] });
    expect(await enqueueAndProcessMetaEvent(event, "hash-crm-link")).toMatchObject({ processed: true });
    const [customer] = await db.select().from(customerProfiles).where(eq(customerProfiles.storeId, storeId));
    expect(customer).toMatchObject({ displayName: "عميلة واتساب", phoneNormalized: "07861162113", lastChannel: "whatsapp" });
    const [conversation] = await db.select().from(inboxConversations).where(eq(inboxConversations.externalConversationId, "whatsapp:07861162113"));
    expect(conversation).toMatchObject({ customerId: customer.id });
    cleanup.conversationIds.push(conversation.id);
    const activities = await db.select().from(customerActivities).where(eq(customerActivities.customerId, customer.id));
    expect(activities).toEqual(expect.arrayContaining([expect.objectContaining({ type: "inbox_message" })]));
  });

  it("ينشئ سياق Inbox لتعليق Meta ويشغل المسار مرة واحدة دون تكرار الرسالة", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    const connection = await db.insert(metaConnections).values({ storeId, purpose: "unified", authMode: "external_business", status: "connected", grantedScopes: "pages_manage_engagement,pages_read_engagement", connectedByUserId: owner.id });
    const connectionId = Number(connection[0].insertId);
    await db.insert(metaAssets).values({ storeId, connectionId, assetType: "page", externalId: "page-comment-gateway", displayName: "صفحة التعليقات", isSelected: true });
    const [event] = normalizeMetaEvents({ object: "page", entry: [{ id: "page-comment-gateway", changes: [{ field: "feed", value: { comment_id: "comment-gateway-1", post_id: "post-gateway-1", message: "هل يوجد لون زيتي؟", from: { id: "customer-comment-1" } } }] }] });
    expect(event).toMatchObject({ kind: "comment", channel: "messenger", data: { objectId: "comment-gateway-1" } });
    expect(await enqueueAndProcessMetaEvent(event, "hash-comment-gateway")).toMatchObject({ accepted: true, duplicate: false, processed: true });
    expect(await enqueueAndProcessMetaEvent(event, "hash-comment-gateway")).toMatchObject({ accepted: true, duplicate: true });
    const [conversation] = await db.select().from(inboxConversations).where(eq(inboxConversations.externalConversationId, "messenger:comment:comment-gateway-1"));
    expect(conversation).toBeTruthy();
    cleanup.conversationIds.push(conversation.id);
    const messages = await db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversation.id));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ source: "live_webhook", externalMessageId: "comment:comment-gateway-1" });
    expect(JSON.parse(messages[0].metadataJson ?? "{}")).toMatchObject({ messageType: "comment", commentExternalId: "comment-gateway-1", parentExternalId: "post-gateway-1" });
  });

  it("ينشئ ملف CRM من Lead Ads مرة واحدة ويحفظ الحدث المكرر دون ملف مكرر", async () => {
    const { db, owner, storeId } = await setup();
    const connection = await db.insert(metaConnections).values({ storeId, purpose: "unified", authMode: "external_business", status: "connected", grantedScopes: "pages_show_list,pages_read_engagement,leads_retrieval", connectedByUserId: owner.id });
    const connectionId = Number(connection[0].insertId);
    await db.insert(metaAssets).values({ storeId, connectionId, assetType: "page", externalId: "page-lead-gateway", displayName: "صفحة العملاء المحتملين", isSelected: true });
    const [event] = normalizeMetaEvents({ object: "page", entry: [{ id: "page-lead-gateway", changes: [{ field: "leadgen", value: { leadgen_id: "lead-gateway-1", form_id: "form-1", field_data: [{ name: "full_name", values: ["عميلة Lead"] }, { name: "phone_number", values: ["07861162113"] }, { name: "consent", values: ["true"] }] } }] }] });
    expect(event).toMatchObject({ kind: "lead", data: { objectId: "lead-gateway-1", formId: "form-1", name: "عميلة Lead", phone: "07861162113" } });
    expect(await enqueueAndProcessMetaEvent(event, "hash-lead-1")).toMatchObject({ accepted: true, duplicate: false, processed: true });
    expect(await enqueueAndProcessMetaEvent(event, "hash-lead-1")).toMatchObject({ accepted: true, duplicate: true });
    const captures = await db.select().from(metaLeadCaptures).where(eq(metaLeadCaptures.storeId, storeId));
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ externalLeadId: "lead-gateway-1", status: "imported", consentStatus: "granted" });
    const customers = await db.select().from(customerProfiles).where(eq(customerProfiles.storeId, storeId));
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ displayName: "عميلة Lead", phoneNormalized: "07861162113" });
  });

  it("يحدث حالة تسليم رسالة صادرة داخل المتجر ولا ينشئ رسالة جديدة", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "whatsapp", providerAccountId: "phone-status", providerDisplayName: "رقم الاختبار", connectionStatus: "testing" });
    const conversation = await db.insert(inboxConversations).values({ storeId, channel: "whatsapp", externalConversationId: `whatsapp:${randomUUID()}`, contactNameSnapshot: "عميلة", status: "open" });
    const conversationId = Number(conversation[0].insertId); cleanup.conversationIds.push(conversationId);
    await db.insert(inboxMessages).values({ conversationId, direction: "outbound", body: "تم إرسال طلبك", externalMessageId: "wamid-status", deliveryStatus: "sent" });
    const [event] = normalizeMetaEvents({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-status" }, statuses: [{ id: "wamid-status", status: "read", timestamp: "1760000000" }] } }] }] });
    expect(await enqueueAndProcessMetaEvent(event, "hash-status")).toMatchObject({ processed: true });
    const [message] = await db.select().from(inboxMessages).where(eq(inboxMessages.externalMessageId, "wamid-status"));
    expect(message).toMatchObject({ deliveryStatus: "read", readAt: expect.any(Date) });
  });

  it("ينقل حدث retry بلا حمولة إلى dead-letter ويمكن إعادته يدوياً مع بقاء العزل", async () => {
    const { db, owner, storeId } = await setup();
    const account = await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "whatsapp", providerAccountId: `phone-${randomUUID()}`, providerDisplayName: "رقم retry", connectionStatus: "testing" });
    await db.insert(channelWebhookEvents).values({ storeId, channelAccountId: account.id, externalEventId: `retry-${randomUUID()}`, payloadHash: "hash-retry", eventType: "message", processingStatus: "retry_pending", normalizedPayloadJson: null, nextAttemptAt: new Date(Date.now() - 1000) });
    expect(await retryDueMetaEvents()).toMatchObject({ attempted: 1, processed: 0, deadLetters: 1 });
    expect(await getMetaEventHealth(storeId)).toMatchObject({ deadLetters: 1, retryPending: 0 });
    expect(await requeueMetaDeadLetters(storeId)).toBe(1);
    expect(await getMetaEventHealth(storeId)).toMatchObject({ deadLetters: 0, retryPending: 1 });
  });
});
