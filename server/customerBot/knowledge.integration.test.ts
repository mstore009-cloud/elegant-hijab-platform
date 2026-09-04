import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { customerBotKnowledgeArticles, customerBotKnowledgeGaps, customerBotRunKnowledgeSources, customerBotRunReviews, customerBotRuns, customerBotSettings, customerBotUsageCounters, inboxConversationEvents, inboxConversations, inboxMessages, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { createManualConversation, recordInboxMessage } from "../inbox/db";
import { generateCustomerBotDraft, updateCustomerBotSettings } from "./db";
import { createCustomerBotKnowledge, createCustomerBotKnowledgeGap, extractHistoricalKnowledgeCandidates, getCustomerBotQualitySummary, listCustomerBotKnowledgeSources, listCustomerBotKnowledgeGaps, reviewCustomerBotRun, setCustomerBotKnowledgeStatus, updateCustomerBotKnowledge } from "./knowledge";

type Cleanup = { storeId: number; conversationId: number };
const cleanups: Cleanup[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    await db.delete(customerBotRunKnowledgeSources).where(eq(customerBotRunKnowledgeSources.storeId, cleanup.storeId));
    await db.delete(customerBotRunReviews).where(eq(customerBotRunReviews.storeId, cleanup.storeId));
    await db.delete(customerBotKnowledgeGaps).where(eq(customerBotKnowledgeGaps.storeId, cleanup.storeId));
    await db.delete(customerBotRuns).where(eq(customerBotRuns.storeId, cleanup.storeId));
    await db.delete(inboxConversationEvents).where(eq(inboxConversationEvents.conversationId, cleanup.conversationId));
    await db.delete(inboxMessages).where(eq(inboxMessages.conversationId, cleanup.conversationId));
    await db.delete(inboxConversations).where(eq(inboxConversations.id, cleanup.conversationId));
    await db.delete(customerBotKnowledgeArticles).where(eq(customerBotKnowledgeArticles.storeId, cleanup.storeId));
    await db.delete(customerBotUsageCounters).where(eq(customerBotUsageCounters.storeId, cleanup.storeId));
    await db.delete(customerBotSettings).where(eq(customerBotSettings.storeId, cleanup.storeId));
    await db.delete(stores).where(eq(stores.id, cleanup.storeId));
  }
});

async function setup(message = "ما هي سياسة التوصيل؟") {
  const db = await getDb();
  const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
  if (!db || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار Bot-H2.");
  const storeResult = await db.insert(stores).values({ name: "متجر اختبار معرفة البوت", slug: `bot-h2-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
  const storeId = Number(storeResult[0].insertId);
  const conversation = await createManualConversation({ storeId, actorUserId: owner.id, contactName: "عميلة اختبار", contactPhone: "07711111111", subject: "سياسة التوصيل" });
  const incoming = await recordInboxMessage({ storeId, conversationId: conversation.conversationId, direction: "inbound", body: message, actorUserId: owner.id });
  cleanups.push({ storeId, conversationId: conversation.conversationId });
  await updateCustomerBotSettings({ storeId, actorUserId: owner.id, enabled: true, mode: "draft_only", fastModel: "gpt-5-mini", escalationModel: "gpt-5", minimumConfidence: 75, maxDailyReplies: 10, maxDailyEscalations: 4 });
  return { db, owner, storeId, conversationId: conversation.conversationId, messageId: incoming.messageId };
}

function mockReply(reply: string) {
  return async (input: any) => ({ id: "mock", created: 0, model: input.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ reply, confidence: 91, needsEscalation: false, escalationReason: null }) }, finish_reason: "stop" }], usage: { prompt_tokens: 18, completion_tokens: 14, total_tokens: 32 } });
}

describe("Bot-H2: المعرفة والمراجعة", () => {
  it("لا يمرر إلا بطاقة معرفة معتمدة إلى المسودة ويحفظ مصدرها للمراجعة", async () => {
    const setupData = await setup();
    const draft = await createCustomerBotKnowledge({ storeId: setupData.storeId, actorUserId: setupData.owner.id, title: "سياسة التوصيل الموحد", kind: "policy", body: "أجرة التوصيل موحدة وتظهر للعميلة قبل إرسال الطلب." });
    await generateCustomerBotDraft({ storeId: setupData.storeId, actorUserId: setupData.owner.id, conversationId: setupData.conversationId, sourceMessageId: setupData.messageId, llm: mockReply("سأوضح لك السياسة.") });
    const [runBeforeApproval] = await setupData.db.select().from(customerBotRuns).where(eq(customerBotRuns.storeId, setupData.storeId));
    expect(runBeforeApproval.factsSnapshot).not.toContain("أجرة التوصيل موحدة");

    await setCustomerBotKnowledgeStatus({ storeId: setupData.storeId, actorUserId: setupData.owner.id, articleId: draft.id, status: "approved" });
    const secondMessage = await recordInboxMessage({ storeId: setupData.storeId, conversationId: setupData.conversationId, direction: "inbound", body: "هل التوصيل موحد؟", actorUserId: setupData.owner.id });
    const generated = await generateCustomerBotDraft({ storeId: setupData.storeId, actorUserId: setupData.owner.id, conversationId: setupData.conversationId, sourceMessageId: secondMessage.messageId, llm: mockReply("نعم، أجرة التوصيل موحدة.") });
    const [runAfterApproval] = await setupData.db.select().from(customerBotRuns).where(eq(customerBotRuns.id, generated.runId));
    expect(runAfterApproval.factsSnapshot).toContain("أجرة التوصيل موحدة");
    await expect(listCustomerBotKnowledgeSources(setupData.storeId, generated.runId)).resolves.toEqual([expect.objectContaining({ id: draft.id, title: "سياسة التوصيل الموحد", status: "approved" })]);
  });

  it("يحفظ قرار الموظف ونصه المعدل ومؤشرات الجودة دون إعادة كتابة مسودة البوت", async () => {
    const setupData = await setup("هل سياسة التوصيل واضحة؟");
    const generated = await generateCustomerBotDraft({ storeId: setupData.storeId, actorUserId: setupData.owner.id, conversationId: setupData.conversationId, sourceMessageId: setupData.messageId, llm: mockReply("سياسة عامة.") });
    const review = await reviewCustomerBotRun({ storeId: setupData.storeId, actorUserId: setupData.owner.id, runId: generated.runId, outcome: "approved_edited", finalReply: "أجرة التوصيل موحدة وتظهر قبل تأكيد الطلب.", feedback: "أضيفت صياغة أوضح." });
    expect(review).toMatchObject({ outcome: "approved_edited", finalReply: "أجرة التوصيل موحدة وتظهر قبل تأكيد الطلب." });
    const [run] = await setupData.db.select().from(customerBotRuns).where(eq(customerBotRuns.id, generated.runId));
    expect(run.replyDraft).toBe("سياسة عامة.");
    await expect(getCustomerBotQualitySummary(setupData.storeId)).resolves.toMatchObject({ reviewed: 1, approvedEdited: 1, approvedAsIs: 0 });
  });

  it("ينشئ فجوة معرفة صريحة قابلة للحل ولا يحولها تلقائياً إلى بطاقة معرفة", async () => {
    const setupData = await setup("هل توجد سياسة هدايا للطلب؟");
    const generated = await generateCustomerBotDraft({ storeId: setupData.storeId, actorUserId: setupData.owner.id, conversationId: setupData.conversationId, sourceMessageId: setupData.messageId, llm: mockReply("سأطلب توضيحاً من الموظفة.") });
    const gap = await createCustomerBotKnowledgeGap({ storeId: setupData.storeId, actorUserId: setupData.owner.id, runId: generated.runId, category: "knowledge", title: "سياسة الهدايا مع الطلب", questionSnapshot: "هل توجد سياسة هدايا للطلب؟" });
    const gaps = await listCustomerBotKnowledgeGaps(setupData.storeId, "open");
    expect(gaps).toEqual([expect.objectContaining({ id: gap.id, title: "سياسة الهدايا مع الطلب", status: "open" })]);
    const articles = await setupData.db.select().from(customerBotKnowledgeArticles).where(eq(customerBotKnowledgeArticles.storeId, setupData.storeId));
    expect(articles).toHaveLength(0);
  });

  it("يستخرج زوج سؤال ورد تاريخي كمسودة منقاة ويمنع التكرار والاعتماد التلقائي", async () => {
    const setupData = await setup();
    await setupData.db.insert(inboxMessages).values([
      { conversationId: setupData.conversationId, direction: "inbound", body: "هل يمكن إرسال الطلب إلى 07712345678؟", source: "historical_sync", occurredAt: new Date("2026-08-01T10:00:00Z"), actorUserId: setupData.owner.id },
      { conversationId: setupData.conversationId, direction: "outbound", body: "نعم، نرسل الطلب بعد تأكيد العنوان والبريد test@example.com", source: "historical_sync", occurredAt: new Date("2026-08-01T10:01:00Z"), actorUserId: setupData.owner.id },
    ]);
    await expect(extractHistoricalKnowledgeCandidates({ storeId: setupData.storeId, actorUserId: setupData.owner.id, limit: 10 })).resolves.toMatchObject({ scannedMessages: 2, candidatePairs: 1, createdCandidates: 1, skippedExisting: 0 });
    const [article] = await setupData.db.select().from(customerBotKnowledgeArticles).where(eq(customerBotKnowledgeArticles.storeId, setupData.storeId));
    expect(article).toMatchObject({ status: "draft", source: "historical_candidate" });
    expect(article.body).toContain("[رقم محجوب]");
    expect(article.body).toContain("[بريد محجوب]");
    await expect(extractHistoricalKnowledgeCandidates({ storeId: setupData.storeId, actorUserId: setupData.owner.id, limit: 10 })).resolves.toMatchObject({ candidatePairs: 1, createdCandidates: 0, skippedExisting: 1 });
    const [stillDraft] = await setupData.db.select().from(customerBotKnowledgeArticles).where(eq(customerBotKnowledgeArticles.id, article.id));
    expect(stillDraft.status).toBe("draft");
  });

  it("يمنع تعديل أو اعتماد بطاقة معرفة من متجر آخر", async () => {
    const first = await setup();
    const article = await createCustomerBotKnowledge({ storeId: first.storeId, actorUserId: first.owner.id, title: "أسلوب الرد", kind: "style_guidance", body: "استخدمي لغة واضحة ومهذبة ومختصرة." });
    const otherStoreResult = await first.db.insert(stores).values({ name: "متجر عزل المعرفة", slug: `bot-h2-isolated-${randomUUID().slice(0, 8)}`, primaryOwnerUserId: first.owner.id });
    const otherStoreId = Number(otherStoreResult[0].insertId);
    const otherConversation = await createManualConversation({ storeId: otherStoreId, actorUserId: first.owner.id, contactName: "عميلة ثانية" });
    cleanups.push({ storeId: otherStoreId, conversationId: otherConversation.conversationId });
    await expect(updateCustomerBotKnowledge({ storeId: otherStoreId, actorUserId: first.owner.id, articleId: article.id, title: "تعديل غير مسموح", kind: "faq", body: "لن ينجح هذا التعديل لأنه خارج المتجر." })).rejects.toThrow("المتجر التشغيلي الحالي");
    await expect(setCustomerBotKnowledgeStatus({ storeId: otherStoreId, actorUserId: first.owner.id, articleId: article.id, status: "approved" })).rejects.toThrow("المتجر التشغيلي الحالي");
  });
});
