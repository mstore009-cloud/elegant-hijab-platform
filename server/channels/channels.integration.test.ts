import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  channelAccounts,
  channelWebhookEvents,
  customerBotImageAnalyses,
  customerBotImageMatches,
  customerBotRuns,
  customerBotSettings,
  customerBotUsageCounters,
  inboxConversationEvents,
  inboxConversations,
  inboxMessageMedia,
  inboxMessages,
  productVariants,
  products,
  stores,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { generateCustomerBotDraft, updateCustomerBotSettings } from "../customerBot/db";
import { analyzeCustomerMessageImage } from "../customerBot/imageAnalysis";
import { configureChannelAccount, ingestExternalInboundMessage, listChannelAccounts } from "./db";
import { isValidMetaChallenge, isValidMetaSignature, normalizeMetaWebhook } from "./metaWebhook";
import { storeInboundImageFromProvider } from "./media";

type Cleanup = { storeId: number; conversationIds: number[]; productIds: number[] };
const cleanups: Cleanup[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    const messages = cleanup.conversationIds.length ? await db.select({ id: inboxMessages.id }).from(inboxMessages).where(inArray(inboxMessages.conversationId, cleanup.conversationIds)) : [];
    const messageIds = messages.map(message => message.id);
    if (messageIds.length) {
      const media = await db.select({ id: inboxMessageMedia.id }).from(inboxMessageMedia).where(inArray(inboxMessageMedia.messageId, messageIds));
      const mediaIds = media.map(item => item.id);
      if (mediaIds.length) {
        const analyses = await db.select({ id: customerBotImageAnalyses.id }).from(customerBotImageAnalyses).where(inArray(customerBotImageAnalyses.mediaId, mediaIds));
        for (const analysis of analyses) await db.delete(customerBotImageMatches).where(eq(customerBotImageMatches.analysisId, analysis.id));
        await db.delete(customerBotImageAnalyses).where(inArray(customerBotImageAnalyses.mediaId, mediaIds));
      }
      await db.delete(inboxMessageMedia).where(inArray(inboxMessageMedia.messageId, messageIds));
    }
    for (const conversationId of cleanup.conversationIds) {
      await db.delete(customerBotRuns).where(eq(customerBotRuns.conversationId, conversationId));
      await db.delete(inboxConversationEvents).where(eq(inboxConversationEvents.conversationId, conversationId));
      await db.delete(inboxMessages).where(eq(inboxMessages.conversationId, conversationId));
      await db.delete(inboxConversations).where(eq(inboxConversations.id, conversationId));
    }
    await db.delete(channelWebhookEvents).where(eq(channelWebhookEvents.storeId, cleanup.storeId));
    await db.delete(channelAccounts).where(eq(channelAccounts.storeId, cleanup.storeId));
    for (const productId of cleanup.productIds) {
      await db.delete(productVariants).where(eq(productVariants.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
    await db.delete(customerBotUsageCounters).where(eq(customerBotUsageCounters.storeId, cleanup.storeId));
    await db.delete(customerBotSettings).where(eq(customerBotSettings.storeId, cleanup.storeId));
    await db.delete(stores).where(eq(stores.id, cleanup.storeId));
  }
});

async function setup() {
  const db = await getDb();
  const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
  if (!db || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار القنوات.");
  const createdStore = await db.insert(stores).values({ name: "متجر اختبار القنوات", slug: `channels-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
  const storeId = Number(createdStore[0].insertId);
  cleanups.push({ storeId, conversationIds: [], productIds: [] });
  return { db, owner, storeId, cleanup: cleanups.at(-1)! };
}

describe("موصلات Meta وصور بوت العملاء", () => {
  it("يتحقق من challenge والتوقيع ويطبع رسائل WhatsApp وInstagram إلى صيغة آمنة", () => {
    const secret = "meta-test-secret";
    const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(isValidMetaChallenge({ mode: "subscribe", challenge: "challenge-1", verifyToken: "verify-1" }, "verify-1")).toBe(true);
    expect(isValidMetaChallenge({ mode: "subscribe", challenge: "challenge-1", verifyToken: "wrong" }, "verify-1")).toBe(false);
    expect(isValidMetaSignature(body, signature, secret)).toBe(true);
    expect(isValidMetaSignature(body, "sha256=bad", secret)).toBe(false);

    const whatsapp = normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-123" }, contacts: [{ wa_id: "964770000000", profile: { name: "عميلة" } }], messages: [{ id: "wamid-123", from: "964770000000", timestamp: "1760000000", type: "image", image: { id: "media-123", mime_type: "image/jpeg", caption: "هل هذا متوفر؟" } }] } }] }] });
    expect(whatsapp).toEqual([expect.objectContaining({ channel: "whatsapp", providerAccountId: "phone-123", externalMessageId: "wamid-123", senderName: "عميلة", body: "هل هذا متوفر؟", attachments: [expect.objectContaining({ providerMediaId: "media-123", mediaType: "image" })] })]);

    const instagram = normalizeMetaWebhook({ object: "instagram", entry: [{ id: "ig-456", messaging: [{ sender: { id: "sender-2" }, timestamp: 1760000000000, message: { mid: "mid-456", attachments: [{ type: "image", payload: { url: "https://cdn.example.test/image.jpg" } }] } }] }] });
    expect(instagram).toEqual([expect.objectContaining({ channel: "instagram", providerAccountId: "ig-456", externalConversationId: "instagram:sender-2", attachments: [expect.objectContaining({ mediaType: "image" })] })]);
  });

  it("يحجز الرسالة الخارجية مرة واحدة داخل متجر الحساب ولا يقبل حساباً من متجر آخر", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "whatsapp", providerAccountId: "phone-test", providerDisplayName: "رقم اختبار", connectionStatus: "testing" });
    const input = { channel: "whatsapp" as const, providerAccountId: "phone-test", externalEventId: "evt-1", externalConversationId: "whatsapp:9647701", externalMessageId: "msg-1", senderName: "عميلة", senderPhone: "9647701", body: "هل هذا اللون متوفر؟", occurredAt: new Date(), attachments: [{ providerMediaId: "media-1", mediaType: "image" as const, mimeType: "image/jpeg" }], payloadHash: "hash-1" };
    const first = await ingestExternalInboundMessage(input);
    expect(first).toMatchObject({ accepted: true, duplicate: false, storeId });
    cleanup.conversationIds.push(first.conversationId!);
    expect(first.mediaIds).toHaveLength(1);
    const second = await ingestExternalInboundMessage(input);
    expect(second).toMatchObject({ accepted: true, duplicate: true, storeId });
    const [message] = await db.select().from(inboxMessages).where(eq(inboxMessages.id, first.messageId!));
    expect(message.body).toContain("اللون متوفر");
    const [media] = await db.select().from(inboxMessageMedia).where(eq(inboxMessageMedia.id, first.mediaIds[0]));
    expect(media).toMatchObject({ storeId, downloadStatus: "pending", storageKey: null });

    const other = await setup();
    await expect(listChannelAccounts(other.storeId)).resolves.toEqual([]);
    await expect(configureChannelAccount({ storeId: other.storeId, actorUserId: owner.id, channel: "whatsapp", providerAccountId: "phone-test", providerDisplayName: null, connectionStatus: "testing" })).rejects.toThrow("متجر آخر");
  });

  it("يمرر تحليل الصورة ومطابقة المنتج الآمنة إلى مسودة البوت من دون تكلفة أو هامش", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    const productResult = await db.insert(products).values({ storeId, productCode: "IMG-OLIVE", name: "حجاب زيتي مرشح", category: "الحجابات", description: "وصف آمن", sizeLabels: "[]", status: "active", sellingPrice: "25000.00", costPrice: "10000.00", targetMarginPercent: "40.00", createdByUserId: owner.id });
    const productId = Number(productResult[0].insertId);
    cleanup.productIds.push(productId);
    await db.insert(productVariants).values({ productId, colorName: "زيتي", sizeLabel: "M", inventoryQuantity: 3, availability: "available" });
    const conversationResult = await db.insert(inboxConversations).values({ storeId, channel: "whatsapp", externalConversationId: `whatsapp:${randomUUID()}`, contactNameSnapshot: "عميلة صورة", status: "open" });
    const conversationId = Number(conversationResult[0].insertId);
    cleanup.conversationIds.push(conversationId);
    const messageResult = await db.insert(inboxMessages).values({ conversationId, direction: "inbound", body: "هل هذا الموديل متوفر؟" });
    const messageId = Number(messageResult[0].insertId);
    const mediaResult = await db.insert(inboxMessageMedia).values({ storeId, messageId, providerMediaId: `media-${randomUUID()}`, mediaType: "image", mimeType: "image/jpeg", storageKey: "stores/test/customer.jpg", downloadStatus: "stored" });
    const mediaId = Number(mediaResult[0].insertId);
    const analysisResult = await db.insert(customerBotImageAnalyses).values({ storeId, mediaId, sourceMessageId: messageId, status: "completed", model: "gemini-test", confidence: 88, garmentType: "حجاب", dominantColor: "زيتي", secondaryColors: "[]", pattern: "سادة", detectedText: null, visualSummary: "قطعة حجاب بلون زيتي.", suitableForMatching: true });
    const analysisId = Number(analysisResult[0].insertId);
    await db.insert(customerBotImageMatches).values({ storeId, analysisId, productId, productMediaId: null, rank: 1, confidence: 82, matchReason: "تشابه اللون والشكل" });
    await updateCustomerBotSettings({ storeId, actorUserId: owner.id, enabled: true, mode: "draft_only", fastModel: "gpt-5-mini", escalationModel: "gpt-5", minimumConfidence: 70, maxDailyReplies: 10, maxDailyEscalations: 4 });
    const calls: any[] = [];
    const llm = async (input: any) => { calls.push(input); return { id: "mock", created: 0, model: input.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ reply: "يبدو قريباً من الحجاب الزيتي المتاح لدينا.", confidence: 86, needsEscalation: false, escalationReason: null }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; };
    const result = await generateCustomerBotDraft({ storeId, actorUserId: owner.id, conversationId, sourceMessageId: messageId, llm });
    expect(result).toMatchObject({ route: "fast", status: "draft" });
    const [run] = await db.select().from(customerBotRuns).where(eq(customerBotRuns.id, result.runId));
    expect(run.factsSnapshot).toContain("IMG-OLIVE");
    expect(run.factsSnapshot).toContain("قطعة حجاب بلون زيتي");
    expect(run.factsSnapshot).toContain("25000.00");
    expect(run.factsSnapshot).not.toContain("10000.00");
    expect(run.factsSnapshot).not.toContain("targetMarginPercent");
    expect(calls).toHaveLength(1);
  });

  it("يخزن صورة القناة المقبولة فقط ويحتفظ بفشل النوع غير المدعوم للمراجعة", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    const account = await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "instagram", providerAccountId: `ig-${randomUUID()}`, providerDisplayName: "حساب اختبار", connectionStatus: "testing" });
    const conversation = await db.insert(inboxConversations).values({ storeId, channel: "instagram", externalConversationId: `instagram:${randomUUID()}`, contactNameSnapshot: "عميلة وسائط", status: "open" });
    const conversationId = Number(conversation[0].insertId);
    cleanup.conversationIds.push(conversationId);
    const message = await db.insert(inboxMessages).values({ conversationId, direction: "inbound", body: "هذه صورة المنتج" });
    const messageId = Number(message[0].insertId);
    const goodMedia = await db.insert(inboxMessageMedia).values({ storeId, messageId, channelAccountId: account.id, providerMediaId: `good-${randomUUID()}`, mediaType: "image", mimeType: "image/jpeg", downloadStatus: "pending" });
    const goodMediaId = Number(goodMedia[0].insertId);
    const storedKeys: string[] = [];
    const good = await storeInboundImageFromProvider({
      storeId,
      mediaId: goodMediaId,
      sourceUrl: "https://cdn.example.test/customer.jpg",
      fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "4" } }),
      putter: async (key) => { storedKeys.push(key); return { key: `stored/${key}`, url: "https://storage.example.test/customer.jpg" }; },
    });
    expect(good.status).toBe("stored");
    expect(storedKeys[0]).toContain(`stores/${storeId}/inbox/${messageId}/customer-image.jpg`);
    const [storedRow] = await db.select().from(inboxMessageMedia).where(eq(inboxMessageMedia.id, goodMediaId));
    expect(storedRow).toMatchObject({ downloadStatus: "stored", storageKey: expect.stringContaining("stored/stores/"), sizeBytes: 4, sha256: expect.any(String) });

    const badMedia = await db.insert(inboxMessageMedia).values({ storeId, messageId, channelAccountId: account.id, providerMediaId: `bad-${randomUUID()}`, mediaType: "image", mimeType: "image/jpeg", downloadStatus: "pending" });
    const bad = await storeInboundImageFromProvider({
      storeId,
      mediaId: Number(badMedia[0].insertId),
      sourceUrl: "https://cdn.example.test/customer.gif",
      fetcher: async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/gif" } }),
      putter: async () => { throw new Error("يجب ألا يخزن النوع المرفوض"); },
    });
    expect(bad.status).toBe("failed");
    const [failedRow] = await db.select().from(inboxMessageMedia).where(eq(inboxMessageMedia.id, Number(badMedia[0].insertId)));
    expect(failedRow).toMatchObject({ downloadStatus: "failed", storageKey: null });
    expect(failedRow.errorSummary).toContain("JPEG أو PNG");
  });

  it("يحلل الصورة المخزنة بصيغة منظمة ويحفظ صفاتها من دون استدعاء خدمة أو صورة حية", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    const account = await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "instagram", providerAccountId: `ig-analysis-${randomUUID()}`, providerDisplayName: "حساب تحليل", connectionStatus: "testing" });
    const conversation = await db.insert(inboxConversations).values({ storeId, channel: "instagram", externalConversationId: `instagram:${randomUUID()}`, contactNameSnapshot: "عميلة تحليل", status: "open" });
    const conversationId = Number(conversation[0].insertId);
    cleanup.conversationIds.push(conversationId);
    const message = await db.insert(inboxMessages).values({ conversationId, direction: "inbound", body: "هل يتوفر مثل هذا؟" });
    const messageId = Number(message[0].insertId);
    const media = await db.insert(inboxMessageMedia).values({ storeId, messageId, channelAccountId: account.id, providerMediaId: `analysis-${randomUUID()}`, mediaType: "image", mimeType: "image/jpeg", storageKey: "stores/test/analysis.jpg", downloadStatus: "stored" });
    const calls: any[] = [];
    const analysis = await analyzeCustomerMessageImage({
      storeId,
      mediaId: Number(media[0].insertId),
      visionModel: "gemini-test",
      getSignedUrl: async () => "https://storage.example.test/analysis.jpg",
      llm: async input => { calls.push(input); return { id: "mock", created: 0, model: input.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ garmentType: "حجاب", dominantColor: "بيج", secondaryColors: ["وردي"], pattern: "سادة", detectedText: "", visualSummary: "حجاب بيج سادة ظاهر بوضوح.", suitableForMatching: true, confidence: 86 }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; },
    });
    expect(analysis).toMatchObject({ status: "completed", matchCount: 0 });
    expect(calls).toHaveLength(1);
    const [saved] = await db.select().from(customerBotImageAnalyses).where(eq(customerBotImageAnalyses.mediaId, Number(media[0].insertId)));
    expect(saved).toMatchObject({ storeId, status: "completed", model: "gemini-test", dominantColor: "بيج", suitableForMatching: true });
    expect(saved.secondaryColors).toBe('["وردي"]');
  });

  it("يحيل صورة فاشلة مباشرةً لموظف ولا يطلب من نموذج أعلى تخمين المنتج", async () => {
    const { db, owner, storeId, cleanup } = await setup();
    const account = await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "whatsapp", providerAccountId: `wa-failed-${randomUUID()}`, providerDisplayName: "حساب فشل", connectionStatus: "testing" });
    const conversation = await db.insert(inboxConversations).values({ storeId, channel: "whatsapp", externalConversationId: `whatsapp:${randomUUID()}`, contactNameSnapshot: "عميلة فشل", status: "open" });
    const conversationId = Number(conversation[0].insertId);
    cleanup.conversationIds.push(conversationId);
    const message = await db.insert(inboxMessages).values({ conversationId, direction: "inbound", body: "أرسلت صورة للاستفسار" });
    const messageId = Number(message[0].insertId);
    const media = await db.insert(inboxMessageMedia).values({ storeId, messageId, channelAccountId: account.id, providerMediaId: `failed-${randomUUID()}`, mediaType: "image", mimeType: "image/jpeg", downloadStatus: "failed", errorSummary: "انتهت صلاحية رابط الصورة" });
    await db.insert(customerBotImageAnalyses).values({ storeId, mediaId: Number(media[0].insertId), sourceMessageId: messageId, status: "failed", suitableForMatching: false, errorSummary: "تعذر تنزيل الصورة" });
    await updateCustomerBotSettings({ storeId, actorUserId: owner.id, enabled: true, mode: "draft_only", fastModel: "gpt-5-mini", escalationModel: "gpt-5", minimumConfidence: 70, maxDailyReplies: 10, maxDailyEscalations: 4 });
    const calls: any[] = [];
    const result = await generateCustomerBotDraft({ storeId, actorUserId: owner.id, conversationId, sourceMessageId: messageId, llm: async input => { calls.push(input); throw new Error("يجب ألا يستدعى النموذج"); } });
    expect(result).toMatchObject({ route: "human_handoff", status: "handoff", escalationReason: expect.stringContaining("تعذر تحليل") });
    expect(calls).toHaveLength(0);
  });
});
