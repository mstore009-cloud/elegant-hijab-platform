import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  customerBotRuns,
  customerBotSettings,
  customerBotUsageCounters,
  inboxConversationEvents,
  inboxConversations,
  inboxMessages,
  productVariants,
  products,
  stores,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { createManualConversation, recordInboxMessage } from "../inbox/db";
import { generateCustomerBotDraft, getCustomerBotSettings, listCustomerBotRuns, updateCustomerBotSettings } from "./db";

type Cleanup = { storeId: number; conversationIds: number[]; productIds: number[] };
const cleanups: Cleanup[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    for (const conversationId of cleanup.conversationIds) {
      await db.delete(customerBotRuns).where(eq(customerBotRuns.conversationId, conversationId));
      await db.delete(inboxConversationEvents).where(eq(inboxConversationEvents.conversationId, conversationId));
      await db.delete(inboxMessages).where(eq(inboxMessages.conversationId, conversationId));
      await db.delete(inboxConversations).where(eq(inboxConversations.id, conversationId));
    }
    for (const productId of cleanup.productIds) {
      await db.delete(productVariants).where(eq(productVariants.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
    await db.delete(customerBotUsageCounters).where(eq(customerBotUsageCounters.storeId, cleanup.storeId));
    await db.delete(customerBotSettings).where(eq(customerBotSettings.storeId, cleanup.storeId));
    await db.delete(stores).where(eq(stores.id, cleanup.storeId));
  }
});

async function setup(message: string) {
  const db = await getDb();
  const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
  if (!db || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار البوت.");
  const storeResult = await db.insert(stores).values({ name: "متجر اختبار البوت", slug: `bot-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
  const storeId = Number(storeResult[0].insertId);
  const productResult = await db.insert(products).values({ storeId, productCode: `BOT-${randomUUID().slice(0, 7)}`, name: "حجاب زيتي عملي", category: "الحجابات", description: "موديل عملي للاستخدام اليومي", sizeLabels: "[]", status: "active", sellingPrice: "18000.00", createdByUserId: owner.id });
  const productId = Number(productResult[0].insertId);
  await db.insert(productVariants).values({ productId, colorName: "زيتي", sizeLabel: "M", inventoryQuantity: 4, availability: "available" });
  const conversation = await createManualConversation({ storeId, actorUserId: owner.id, contactName: "عميلة اختبار", contactPhone: "07700000000", subject: "سؤال عن حجاب" });
  const incoming = await recordInboxMessage({ storeId, conversationId: conversation.conversationId, direction: "inbound", body: message, actorUserId: owner.id });
  cleanups.push({ storeId, conversationIds: [conversation.conversationId], productIds: [productId] });
  await updateCustomerBotSettings({ storeId, actorUserId: owner.id, enabled: true, mode: "draft_only", messengerEnabled: false, instagramEnabled: false, whatsappEnabled: false, dialect: "عربية عراقية بسيطة", tone: "warm", operatorInstructions: null, fastModel: "gpt-5-mini", escalationModel: "gpt-5", minimumConfidence: 75, maxDailyReplies: 10, maxDailyEscalations: 4 });
  return { db, owner, storeId, productId, conversationId: conversation.conversationId, messageId: incoming.messageId };
}

function mockReply(reply: string, confidence = 90, needsEscalation = false) {
  const calls: Array<{ model?: string }> = [];
  return {
    calls,
    llm: async (input: any) => {
      calls.push({ model: input.model });
      return { id: "mock", created: 0, model: input.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ reply, confidence, needsEscalation, escalationReason: null }) }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 } };
    },
  };
}

describe("بوت العملاء الهجين", () => {
  it("ينشئ المسار السريع مسودة مبنية على حقائق المنتج الحية من دون كشف بيانات التكلفة", async () => {
    const setupData = await setup("هل الحجاب الزيتي متوفر؟ وكم سعره؟");
    const mock = mockReply("نعم، اللون الزيتي متوفر حالياً وسعره 18,000 د.ع.");
    const result = await generateCustomerBotDraft({ storeId: setupData.storeId, actorUserId: setupData.owner.id, conversationId: setupData.conversationId, sourceMessageId: setupData.messageId, llm: mock.llm });

    expect(result).toMatchObject({ route: "fast", status: "draft", confidence: 90 });
    expect(mock.calls).toEqual([{ model: "gpt-5-mini" }]);
    const [run] = await listCustomerBotRuns(setupData.storeId, setupData.conversationId);
    expect(run).toMatchObject({ route: "fast", status: "draft", model: "gpt-5-mini", replyDraft: "نعم، اللون الزيتي متوفر حالياً وسعره 18,000 د.ع." });
    expect(run.factsSnapshot).toContain("18000.00");
    expect(run.factsSnapshot).toContain("زيتي");
    expect(run.factsSnapshot).not.toContain("costPrice");
  });

  it("لا يرسل رداً خارجياً عندما يكون وضع الرد الآلي مفعلاً لكن القناة غير مفعلة", async () => {
    const setupData = await setup("هل الحجاب الزيتي متوفر؟");
    await updateCustomerBotSettings({ storeId: setupData.storeId, actorUserId: setupData.owner.id, enabled: true, mode: "auto_reply", messengerEnabled: false, instagramEnabled: false, whatsappEnabled: false, dialect: "عربية عراقية بسيطة", tone: "warm", operatorInstructions: "أجب بدقة ولا تخمّن.", fastModel: "gpt-5-mini", escalationModel: "gpt-5", minimumConfidence: 75, maxDailyReplies: 10, maxDailyEscalations: 4 });
    const mock = mockReply("نعم، اللون الزيتي متوفر.");
    const result = await generateCustomerBotDraft({ storeId: setupData.storeId, actorUserId: setupData.owner.id, conversationId: setupData.conversationId, sourceMessageId: setupData.messageId, llm: mock.llm });
    expect(result).toMatchObject({ route: "fast", status: "draft" });
    expect(mock.calls).toEqual([{ model: "gpt-5-mini" }]);
  });

  it("يصعّد المقارنة المركبة مباشرة إلى GPT-5 ويحفظ سبب التصعيد", async () => {
    const setupData = await setup("أريد مقارنة بين هذا الحجاب وموديل آخر يناسب مناسبة رسمية.");
    const mock = mockReply("هذا الموديل مناسب للاستخدام العملي، ويمكن للموظفة مساعدتك بمقارنة أدق.", 88);
    const result = await generateCustomerBotDraft({ storeId: setupData.storeId, actorUserId: setupData.owner.id, conversationId: setupData.conversationId, sourceMessageId: setupData.messageId, llm: mock.llm });

    expect(result).toMatchObject({ route: "escalated", status: "draft", confidence: 88 });
    expect(mock.calls).toEqual([{ model: "gpt-5" }]);
    const [run] = await listCustomerBotRuns(setupData.storeId, setupData.conversationId);
    expect(run.escalationReason).toContain("مقارنة");
  });

  it("يحول الطلبات الحساسة إلى موظف من دون استدعاء أي نموذج", async () => {
    const setupData = await setup("أريد خصمًا خاصًا على الطلب.");
    const mock = mockReply("لا ينبغي استدعائي");
    const result = await generateCustomerBotDraft({ storeId: setupData.storeId, actorUserId: setupData.owner.id, conversationId: setupData.conversationId, sourceMessageId: setupData.messageId, llm: mock.llm });

    expect(result).toMatchObject({ route: "human_handoff", status: "handoff" });
    expect(mock.calls).toHaveLength(0);
    const [run] = await listCustomerBotRuns(setupData.storeId, setupData.conversationId);
    expect(run.escalationReason).toContain("حساس");
    const [conversation] = await setupData.db.select().from(inboxConversations).where(eq(inboxConversations.id, setupData.conversationId));
    expect(conversation.priority).toBe(true);
  });

  it("يحافظ على عزل المتجر في إعدادات البوت وسجل مسوداته", async () => {
    const setupData = await setup("هل اللون الزيتي متوفر؟");
    const otherStoreResult = await setupData.db.insert(stores).values({ name: "متجر بوت ثان", slug: `bot-isolated-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: setupData.owner.id });
    const otherStoreId = Number(otherStoreResult[0].insertId);
    cleanups.push({ storeId: otherStoreId, conversationIds: [], productIds: [] });

    await expect(listCustomerBotRuns(otherStoreId, setupData.conversationId)).rejects.toThrow("المتجر التشغيلي الحالي");
    await expect(getCustomerBotSettings(otherStoreId)).resolves.toMatchObject({ storeId: otherStoreId, fastModel: "gpt-5-mini", escalationModel: "gpt-5" });
  });
});
