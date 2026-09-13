import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { customerBotBehaviorCards, customerBotKnowledgeArticles, customerBotKnowledgeGaps, customerBotLearningProposals, customerBotOrderDrafts, customerBotPlaybooks, customerBotRunKnowledgeSources, customerBotRunReviews, customerBotRuns, customerBotSettings, customerBotTestCases, inboxConversations, inboxMessages, metaOutboundMessages, stores } from "../../drizzle/schema";
import { getDb } from "../db";

export const knowledgeKinds = ["faq", "policy", "style_guidance", "product_guidance"] as const;
export const knowledgeStatuses = ["draft", "approved", "archived"] as const;
export const reviewOutcomes = ["approved_as_is", "approved_edited", "rejected", "human_handoff", "knowledge_gap"] as const;
export const gapCategories = ["knowledge", "policy", "handoff", "experience", "action"] as const;
export const gapStatuses = ["open", "resolved", "dismissed"] as const;

type KnowledgeKind = (typeof knowledgeKinds)[number];
type KnowledgeStatus = (typeof knowledgeStatuses)[number];
type ReviewOutcome = (typeof reviewOutcomes)[number];
type GapCategory = (typeof gapCategories)[number];
type GapStatus = (typeof gapStatuses)[number];

async function requireDb() { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا."); return db; }

async function scopedRun(db: any, storeId: number, runId: number) {
  const [run] = await db.select().from(customerBotRuns).where(and(eq(customerBotRuns.id, runId), eq(customerBotRuns.storeId, storeId))).limit(1);
  if (!run) throw new Error("سجل البوت غير موجود في المتجر التشغيلي الحالي.");
  return run;
}

async function scopedArticle(db: any, storeId: number, articleId: number) {
  const [article] = await db.select().from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.id, articleId), eq(customerBotKnowledgeArticles.storeId, storeId))).limit(1);
  if (!article) throw new Error("بطاقة المعرفة غير موجودة في المتجر التشغيلي الحالي.");
  return article;
}

export async function listCustomerBotKnowledge(storeId: number, status?: KnowledgeStatus) {
  const db = await requireDb();
  return db.select().from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, storeId), status ? eq(customerBotKnowledgeArticles.status, status) : undefined)).orderBy(desc(customerBotKnowledgeArticles.updatedAt), desc(customerBotKnowledgeArticles.id));
}

/** Read model for one review queue; original records remain in their source tables. */
export async function listCustomerBotUnifiedReviewQueue(storeId: number) {
  const db = await requireDb();
  const [articles, behaviorCards, playbooks, proposals, testCases, orderDrafts, gaps] = await Promise.all([
    db.select({ id: customerBotKnowledgeArticles.id, title: customerBotKnowledgeArticles.title, body: customerBotKnowledgeArticles.body, status: customerBotKnowledgeArticles.status, updatedAt: customerBotKnowledgeArticles.updatedAt }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, storeId), eq(customerBotKnowledgeArticles.status, "draft"))),
    db.select({ id: customerBotBehaviorCards.id, title: customerBotBehaviorCards.title, body: customerBotBehaviorCards.body, status: customerBotBehaviorCards.status, updatedAt: customerBotBehaviorCards.updatedAt, kind: customerBotBehaviorCards.kind }).from(customerBotBehaviorCards).where(and(eq(customerBotBehaviorCards.storeId, storeId), eq(customerBotBehaviorCards.status, "draft"))),
    db.select({ id: customerBotPlaybooks.id, title: customerBotPlaybooks.title, body: customerBotPlaybooks.stepsJson, status: customerBotPlaybooks.status, updatedAt: customerBotPlaybooks.updatedAt }).from(customerBotPlaybooks).where(and(eq(customerBotPlaybooks.storeId, storeId), eq(customerBotPlaybooks.status, "draft"))),
    db.select({ id: customerBotLearningProposals.id, title: customerBotLearningProposals.title, body: customerBotLearningProposals.body, status: customerBotLearningProposals.status, updatedAt: customerBotLearningProposals.updatedAt, category: customerBotLearningProposals.category }).from(customerBotLearningProposals).where(and(eq(customerBotLearningProposals.storeId, storeId), eq(customerBotLearningProposals.status, "draft"))),
    db.select({ id: customerBotTestCases.id, title: customerBotTestCases.title, body: customerBotTestCases.inputJson, status: customerBotTestCases.status, updatedAt: customerBotTestCases.updatedAt }).from(customerBotTestCases).where(and(eq(customerBotTestCases.storeId, storeId), eq(customerBotTestCases.status, "draft"))),
    db.select({ id: customerBotOrderDrafts.id, title: customerBotOrderDrafts.summaryText, body: customerBotOrderDrafts.itemsJson, status: customerBotOrderDrafts.status, updatedAt: customerBotOrderDrafts.updatedAt }).from(customerBotOrderDrafts).where(and(eq(customerBotOrderDrafts.storeId, storeId), or(eq(customerBotOrderDrafts.status, "collecting"), eq(customerBotOrderDrafts.status, "awaiting_confirmation"), eq(customerBotOrderDrafts.status, "review_required")))),
    db.select({ id: customerBotKnowledgeGaps.id, title: customerBotKnowledgeGaps.title, body: customerBotKnowledgeGaps.questionSnapshot, status: customerBotKnowledgeGaps.status, updatedAt: customerBotKnowledgeGaps.updatedAt, category: customerBotKnowledgeGaps.category }).from(customerBotKnowledgeGaps).where(and(eq(customerBotKnowledgeGaps.storeId, storeId), eq(customerBotKnowledgeGaps.status, "open"))),
  ]);
  return [
    ...articles.map(item => ({ sourceType: "knowledge" as const, sourceId: item.id, title: item.title, body: item.body, status: item.status, category: "knowledge", updatedAt: item.updatedAt })),
    ...behaviorCards.map(item => ({ sourceType: "behavior" as const, sourceId: item.id, title: item.title, body: item.body, status: item.status, category: item.kind, updatedAt: item.updatedAt })),
    ...playbooks.map(item => ({ sourceType: "playbook" as const, sourceId: item.id, title: item.title, body: item.body, status: item.status, category: "sales_playbook", updatedAt: item.updatedAt })),
    ...proposals.map(item => ({ sourceType: "proposal" as const, sourceId: item.id, title: item.title, body: item.body, status: item.status, category: item.category, updatedAt: item.updatedAt })),
    ...testCases.map(item => ({ sourceType: "test_case" as const, sourceId: item.id, title: item.title, body: item.body, status: item.status, category: "test_case", updatedAt: item.updatedAt })),
    ...orderDrafts.map(item => ({ sourceType: "order_draft" as const, sourceId: item.id, title: item.title || `مسودة طلب #${item.id}`, body: item.body, status: item.status, category: "order_draft", updatedAt: item.updatedAt })),
    ...gaps.map(item => ({ sourceType: "gap" as const, sourceId: item.id, title: item.title, body: item.body, status: item.status, category: item.category, updatedAt: item.updatedAt })),
  ].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export async function createCustomerBotKnowledge(input: { storeId: number; actorUserId: number; title: string; kind: KnowledgeKind; body: string; source?: "manual" | "review_feedback" | "historical_candidate" }) {
  const db = await requireDb();
  const result = await db.insert(customerBotKnowledgeArticles).values({ storeId: input.storeId, title: input.title, kind: input.kind, body: input.body, source: input.source ?? "manual", createdByUserId: input.actorUserId });
  return scopedArticle(db, input.storeId, Number(result[0].insertId));
}

export async function updateCustomerBotKnowledge(input: { storeId: number; actorUserId: number; articleId: number; title: string; kind: KnowledgeKind; body: string }) {
  const db = await requireDb();
  const article = await scopedArticle(db, input.storeId, input.articleId);
  await db.update(customerBotKnowledgeArticles).set({ title: input.title, kind: input.kind, body: input.body, status: article.status === "approved" ? "draft" : article.status, approvedAt: article.status === "approved" ? null : article.approvedAt, approvedByUserId: article.status === "approved" ? null : article.approvedByUserId }).where(eq(customerBotKnowledgeArticles.id, article.id));
  return scopedArticle(db, input.storeId, article.id);
}

export async function setCustomerBotKnowledgeStatus(input: { storeId: number; actorUserId: number; articleId: number; status: Extract<KnowledgeStatus, "approved" | "archived"> }) {
  const db = await requireDb();
  const article = await scopedArticle(db, input.storeId, input.articleId);
  await db.update(customerBotKnowledgeArticles).set({ status: input.status, approvedAt: input.status === "approved" ? new Date() : null, approvedByUserId: input.status === "approved" ? input.actorUserId : null }).where(eq(customerBotKnowledgeArticles.id, article.id));
  return scopedArticle(db, input.storeId, article.id);
}

function redactHistoricalText(value: string) {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[بريد محجوب]")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "[رابط محجوب]")
    .replace(/(?:\+?964|00964|0)?7\d{8,10}/g, "[رقم محجوب]")
    .replace(/(?:طلب|order)\s*[#:#-]?\s*[A-Z0-9-]{5,}/gi, "[رقم طلب محجوب]")
    .trim()
    .slice(0, 4000);
}

function candidateKind(question: string): KnowledgeKind {
  return /توصيل|شحن|استبدال|إرجاع|دفع|طلب|سياسة|عنوان/i.test(question) ? "policy" : "faq";
}

export async function extractHistoricalKnowledgeCandidates(input: { storeId: number; actorUserId: number; channels?: Array<"whatsapp" | "instagram" | "messenger">; limit?: number; since?: Date | null }) {
  const db = await requireDb();
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const channelFilter = input.channels?.length ? or(...input.channels.map(channel => eq(inboxConversations.channel, channel))) : undefined;
  const messages = await db.select({
    messageId: inboxMessages.id,
    conversationId: inboxMessages.conversationId,
    direction: inboxMessages.direction,
    body: inboxMessages.body,
    occurredAt: inboxMessages.occurredAt,
    channel: inboxConversations.channel,
    subject: inboxConversations.subject,
    externalMessageId: inboxMessages.externalMessageId,
  }).from(inboxMessages).innerJoin(inboxConversations, eq(inboxMessages.conversationId, inboxConversations.id)).where(and(eq(inboxConversations.storeId, input.storeId), or(eq(inboxMessages.source, "historical_sync"), eq(inboxMessages.source, "live_webhook")), or(eq(inboxMessages.direction, "inbound"), eq(inboxMessages.direction, "outbound")), input.since ? gte(inboxMessages.occurredAt, input.since) : undefined, channelFilter)).orderBy(asc(inboxMessages.conversationId), asc(inboxMessages.occurredAt), asc(inboxMessages.id)).limit(limit * 8);

  const platformOutbound = await db.select({ externalMessageId: metaOutboundMessages.externalMessageId }).from(metaOutboundMessages).where(eq(metaOutboundMessages.storeId, input.storeId));
  const platformOutboundIds = new Set(platformOutbound.map(item => item.externalMessageId).filter((value): value is string => Boolean(value)));
  const staffMessages = messages.filter(message => !message.externalMessageId || !platformOutboundIds.has(message.externalMessageId));

  const nextOutbound = new Map<number, typeof messages[number]>();
  const pendingInbound = new Map<number, typeof messages[number]>();
  for (const message of staffMessages) {
    if (message.direction === "inbound") {
      pendingInbound.set(message.conversationId, message);
      continue;
    }
    const inbound = pendingInbound.get(message.conversationId);
    if (inbound && !nextOutbound.has(inbound.messageId)) nextOutbound.set(inbound.messageId, message);
    pendingInbound.delete(message.conversationId);
  }
  const pairs = Array.from(nextOutbound.entries()).slice(0, limit);
  if (!pairs.length) return { scannedMessages: staffMessages.length, candidatePairs: 0, createdCandidates: 0, skippedExisting: 0 };

  const existing = await db.select({ body: customerBotKnowledgeArticles.body }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, input.storeId), eq(customerBotKnowledgeArticles.source, "historical_candidate")));
  const existingBodies = new Set(existing.map(article => article.body));
  let createdCandidates = 0;
  let skippedExisting = 0;
  for (const [inboundId, outbound] of pairs) {
    const inbound = messages.find(message => message.messageId === inboundId);
    if (!inbound) continue;
    const question = redactHistoricalText(inbound.body);
    const answer = redactHistoricalText(outbound.body);
    if (question.length < 3 || answer.length < 3) continue;
    const body = `سؤال تاريخي للعميل:\n${question}\n\nالرد المسجل من الفريق:\n${answer}\n\nملاحظة مراجعة: هذا مرشح مستخرج من محادثة تاريخية، ولا يستخدمه Bot-H3 حتى يعتمد يدوياً.`;
    if (existingBodies.has(body)) { skippedExisting += 1; continue; }
    await db.insert(customerBotKnowledgeArticles).values({ storeId: input.storeId, title: `مرشح رد تاريخي — ${inbound.channel === "messenger" ? "Messenger" : inbound.channel === "instagram" ? "Instagram" : "WhatsApp"}`, kind: candidateKind(question), body, source: "historical_candidate", createdByUserId: input.actorUserId });
    existingBodies.add(body);
    createdCandidates += 1;
  }
  return { scannedMessages: staffMessages.length, candidatePairs: pairs.length, createdCandidates, skippedExisting };
}

/** Captures a native-channel employee echo as a reviewable draft; it never teaches the bot automatically. */
export async function captureNativeChannelReply(input: { storeId: number; conversationId: number; messageId: number; channel: "whatsapp" | "instagram" | "messenger" }) {
  const db = await requireDb();
  const [settings] = await db.select({ learningEnabled: customerBotSettings.learningEnabled }).from(customerBotSettings).where(eq(customerBotSettings.storeId, input.storeId)).limit(1);
  if (settings && !settings.learningEnabled) return { created: false as const, reason: "learning_disabled" as const };
  const [outbound] = await db.select({ externalMessageId: inboxMessages.externalMessageId, body: inboxMessages.body }).from(inboxMessages).where(and(eq(inboxMessages.id, input.messageId), eq(inboxMessages.conversationId, input.conversationId), eq(inboxMessages.direction, "outbound"))).limit(1);
  if (!outbound) return { created: false as const, reason: "outbound_not_found" as const };
  if (outbound.externalMessageId) {
    const [known] = await db.select({ id: metaOutboundMessages.id }).from(metaOutboundMessages).where(and(eq(metaOutboundMessages.storeId, input.storeId), eq(metaOutboundMessages.externalMessageId, outbound.externalMessageId))).limit(1);
    if (known) return { created: false as const, reason: "platform_sent_message" as const };
  }
  const [question] = await db.select({ body: inboxMessages.body }).from(inboxMessages).where(and(eq(inboxMessages.conversationId, input.conversationId), eq(inboxMessages.direction, "inbound"), sql`${inboxMessages.id} < ${input.messageId}`)).orderBy(desc(inboxMessages.occurredAt), desc(inboxMessages.id)).limit(1);
  const questionText = redactHistoricalText(question?.body ?? "");
  const answerText = redactHistoricalText(outbound.body ?? "");
  if (questionText.length < 3 || answerText.length < 3) return { created: false as const, reason: "insufficient_text" as const };
  const body = `رسالة عميل من ${input.channel}:\n${questionText}\n\nرد موظف من التطبيق الأصلي:\n${answerText}\n\nملاحظة مراجعة: هذا مرشح أسلوبي مستخرج من رد موظف، ولا يستخدمه Bot-H3 قبل اعتماده يدويًا.`;
  const [existing] = await db.select({ id: customerBotKnowledgeArticles.id }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, input.storeId), eq(customerBotKnowledgeArticles.source, "historical_candidate"), eq(customerBotKnowledgeArticles.body, body))).limit(1);
  if (existing) return { created: false as const, reason: "duplicate" as const, articleId: existing.id };
  const [store] = await db.select({ primaryOwnerUserId: stores.primaryOwnerUserId }).from(stores).where(eq(stores.id, input.storeId)).limit(1);
  if (!store?.primaryOwnerUserId) return { created: false as const, reason: "no_store_owner" as const };
  const result = await db.insert(customerBotKnowledgeArticles).values({ storeId: input.storeId, title: `مرشح رد موظف أصلي — ${input.channel}`, kind: "style_guidance", body, status: "draft", source: "historical_candidate", createdByUserId: store.primaryOwnerUserId });
  return { created: true as const, articleId: Number(result[0].insertId), reason: "created" as const };
}

export async function listCustomerBotReviewQueue(storeId: number) {
  const db = await requireDb();
  return db.select({ run: customerBotRuns, review: customerBotRunReviews, conversation: { id: inboxConversations.id, subject: inboxConversations.subject, contactNameSnapshot: inboxConversations.contactNameSnapshot } }).from(customerBotRuns).leftJoin(customerBotRunReviews, eq(customerBotRunReviews.runId, customerBotRuns.id)).leftJoin(inboxConversations, eq(inboxConversations.id, customerBotRuns.conversationId)).where(eq(customerBotRuns.storeId, storeId)).orderBy(desc(customerBotRuns.createdAt), desc(customerBotRuns.id)).limit(60);
}

export async function reviewCustomerBotRun(input: { storeId: number; actorUserId: number; runId: number; outcome: ReviewOutcome; finalReply?: string | null; feedback?: string | null }) {
  const db = await requireDb();
  await scopedRun(db, input.storeId, input.runId);
  await db.insert(customerBotRunReviews).values({ storeId: input.storeId, runId: input.runId, outcome: input.outcome, finalReply: input.finalReply ?? null, feedback: input.feedback ?? null, reviewedByUserId: input.actorUserId }).onDuplicateKeyUpdate({ set: { outcome: input.outcome, finalReply: input.finalReply ?? null, feedback: input.feedback ?? null, reviewedByUserId: input.actorUserId, updatedAt: new Date() } });
  const [review] = await db.select().from(customerBotRunReviews).where(eq(customerBotRunReviews.runId, input.runId)).limit(1);
  return review;
}

function rejectSensitiveTeachContent(value: string) {
  if (/(?:سعر|السعر|مخزون|متوفر|متاحة|نفد|كمية|دينار|د\\.?\\s*ع|iqd|\\b\\d{3,}\\b)/i.test(value)) {
    throw new Error("لا يمكن تعليم السعر أو المخزون من نص المحادثة؛ اربطي هذه المعلومات ببيانات المنتج المعتمدة.");
  }
}

export async function teachCustomerBotFromReviewedRun(input: { storeId: number; actorUserId: number; runId: number; title?: string; kind?: Extract<KnowledgeKind, "faq" | "policy" | "style_guidance">; body?: string }) {
  const db = await requireDb();
  const run = await scopedRun(db, input.storeId, input.runId);
  const [review] = await db.select().from(customerBotRunReviews).where(and(eq(customerBotRunReviews.runId, input.runId), eq(customerBotRunReviews.storeId, input.storeId))).limit(1);
  if (!review || (review.outcome !== "approved_as_is" && review.outcome !== "approved_edited")) {
    throw new Error("لا يمكن تعليم البوت إلا من مراجعة بشرية معتمدة.");
  }
  const sourceText = input.body?.trim() || review.finalReply?.trim() || run.replyDraft?.trim() || "";
  const body = redactHistoricalText(sourceText);
  if (body.length < 12) throw new Error("لا توجد صياغة كافية لتحويلها إلى مرشح معرفة.");
  rejectSensitiveTeachContent(body);
  const title = input.title?.trim() || `تعليم من مراجعة Bot-H3 #${run.id}`;
  const articleBody = `صياغة معتمدة من مراجعة بشرية:\n${body}\n\nنطاق التعليم: الأسلوب وطريقة التعامل فقط؛ لا تُعد هذه البطاقة مصدراً للسعر أو المخزون.`;
  const [existing] = await db.select().from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, input.storeId), eq(customerBotKnowledgeArticles.source, "review_feedback"), eq(customerBotKnowledgeArticles.body, articleBody))).limit(1);
  if (existing) return { article: existing, sourceRunId: run.id, reviewId: review.id, requiresApproval: true, created: false };
  const result = await db.insert(customerBotKnowledgeArticles).values({
    storeId: input.storeId,
    title: title.slice(0, 240),
    kind: input.kind ?? "style_guidance",
    body: articleBody,
    status: "draft",
    source: "review_feedback",
    createdByUserId: input.actorUserId,
  });
  const article = await scopedArticle(db, input.storeId, Number(result[0].insertId));
  return { article, sourceRunId: run.id, reviewId: review.id, requiresApproval: true, created: true };
}

export async function listCustomerBotKnowledgeSources(storeId: number, runId: number) {
  const db = await requireDb();
  await scopedRun(db, storeId, runId);
  return db.select({ id: customerBotKnowledgeArticles.id, title: customerBotKnowledgeArticles.title, kind: customerBotKnowledgeArticles.kind, status: customerBotKnowledgeArticles.status }).from(customerBotRunKnowledgeSources).innerJoin(customerBotKnowledgeArticles, eq(customerBotRunKnowledgeSources.knowledgeArticleId, customerBotKnowledgeArticles.id)).where(and(eq(customerBotRunKnowledgeSources.storeId, storeId), eq(customerBotRunKnowledgeSources.runId, runId))).orderBy(desc(customerBotRunKnowledgeSources.id));
}

export async function listCustomerBotKnowledgeGaps(storeId: number, status?: GapStatus) {
  const db = await requireDb();
  return db.select().from(customerBotKnowledgeGaps).where(and(eq(customerBotKnowledgeGaps.storeId, storeId), status ? eq(customerBotKnowledgeGaps.status, status) : undefined)).orderBy(desc(customerBotKnowledgeGaps.updatedAt), desc(customerBotKnowledgeGaps.id));
}

export async function createCustomerBotKnowledgeGap(input: { storeId: number; actorUserId: number; runId?: number | null; category: GapCategory; title: string; questionSnapshot?: string | null }) {
  const db = await requireDb();
  if (input.runId) await scopedRun(db, input.storeId, input.runId);
  const result = await db.insert(customerBotKnowledgeGaps).values({ storeId: input.storeId, runId: input.runId ?? null, category: input.category, title: input.title, questionSnapshot: input.questionSnapshot ?? null, createdByUserId: input.actorUserId });
  const [gap] = await db.select().from(customerBotKnowledgeGaps).where(eq(customerBotKnowledgeGaps.id, Number(result[0].insertId))).limit(1);
  return gap;
}

export async function resolveCustomerBotKnowledgeGap(input: { storeId: number; actorUserId: number; gapId: number; status: Extract<GapStatus, "resolved" | "dismissed">; resolutionNote?: string | null }) {
  const db = await requireDb();
  const [gap] = await db.select().from(customerBotKnowledgeGaps).where(and(eq(customerBotKnowledgeGaps.id, input.gapId), eq(customerBotKnowledgeGaps.storeId, input.storeId))).limit(1);
  if (!gap) throw new Error("فجوة المعرفة غير موجودة في المتجر التشغيلي الحالي.");
  await db.update(customerBotKnowledgeGaps).set({ status: input.status, resolutionNote: input.resolutionNote ?? null, resolvedAt: new Date(), resolvedByUserId: input.actorUserId }).where(eq(customerBotKnowledgeGaps.id, gap.id));
  const [updated] = await db.select().from(customerBotKnowledgeGaps).where(eq(customerBotKnowledgeGaps.id, gap.id)).limit(1);
  return updated;
}

export async function getCustomerBotQualitySummary(storeId: number) {
  const db = await requireDb();
  const [reviewed, approvedAsIs, approvedEdited, rejected, handoffs, openGaps] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(customerBotRunReviews).where(eq(customerBotRunReviews.storeId, storeId)),
    db.select({ count: sql<number>`count(*)` }).from(customerBotRunReviews).where(and(eq(customerBotRunReviews.storeId, storeId), eq(customerBotRunReviews.outcome, "approved_as_is"))),
    db.select({ count: sql<number>`count(*)` }).from(customerBotRunReviews).where(and(eq(customerBotRunReviews.storeId, storeId), eq(customerBotRunReviews.outcome, "approved_edited"))),
    db.select({ count: sql<number>`count(*)` }).from(customerBotRunReviews).where(and(eq(customerBotRunReviews.storeId, storeId), eq(customerBotRunReviews.outcome, "rejected"))),
    db.select({ count: sql<number>`count(*)` }).from(customerBotRunReviews).where(and(eq(customerBotRunReviews.storeId, storeId), eq(customerBotRunReviews.outcome, "human_handoff"))),
    db.select({ count: sql<number>`count(*)` }).from(customerBotKnowledgeGaps).where(and(eq(customerBotKnowledgeGaps.storeId, storeId), eq(customerBotKnowledgeGaps.status, "open"))),
  ]);
  return { reviewed: Number(reviewed[0]?.count ?? 0), approvedAsIs: Number(approvedAsIs[0]?.count ?? 0), approvedEdited: Number(approvedEdited[0]?.count ?? 0), rejected: Number(rejected[0]?.count ?? 0), handoffs: Number(handoffs[0]?.count ?? 0), openGaps: Number(openGaps[0]?.count ?? 0) };
}

export async function getCustomerBotQualityComparison(storeId: number) {
  const db = await requireDb();
  const [summary, approvedKnowledge, sourceRuns, reviewedWithKnowledge, approvedAsIsWithKnowledgeQuery, editedWithKnowledge, rejectedWithKnowledge] = await Promise.all([
    getCustomerBotQualitySummary(storeId),
    db.select({ count: sql<number>`count(*)` }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, storeId), eq(customerBotKnowledgeArticles.status, "approved"))),
    db.select({ count: sql<number>`count(distinct ${customerBotRunKnowledgeSources.runId})` }).from(customerBotRunKnowledgeSources).where(eq(customerBotRunKnowledgeSources.storeId, storeId)),
    db.select({ count: sql<number>`count(distinct ${customerBotRunReviews.runId})` }).from(customerBotRunReviews).innerJoin(customerBotRunKnowledgeSources, and(eq(customerBotRunKnowledgeSources.runId, customerBotRunReviews.runId), eq(customerBotRunKnowledgeSources.storeId, storeId))).where(eq(customerBotRunReviews.storeId, storeId)),
    db.select({ count: sql<number>`count(distinct ${customerBotRunReviews.runId})` }).from(customerBotRunReviews).innerJoin(customerBotRunKnowledgeSources, and(eq(customerBotRunKnowledgeSources.runId, customerBotRunReviews.runId), eq(customerBotRunKnowledgeSources.storeId, storeId))).where(and(eq(customerBotRunReviews.storeId, storeId), eq(customerBotRunReviews.outcome, "approved_as_is"))),
    db.select({ count: sql<number>`count(distinct ${customerBotRunReviews.runId})` }).from(customerBotRunReviews).innerJoin(customerBotRunKnowledgeSources, and(eq(customerBotRunKnowledgeSources.runId, customerBotRunReviews.runId), eq(customerBotRunKnowledgeSources.storeId, storeId))).where(and(eq(customerBotRunReviews.storeId, storeId), eq(customerBotRunReviews.outcome, "approved_edited"))),
    db.select({ count: sql<number>`count(distinct ${customerBotRunReviews.runId})` }).from(customerBotRunReviews).innerJoin(customerBotRunKnowledgeSources, and(eq(customerBotRunKnowledgeSources.runId, customerBotRunReviews.runId), eq(customerBotRunKnowledgeSources.storeId, storeId))).where(and(eq(customerBotRunReviews.storeId, storeId), eq(customerBotRunReviews.outcome, "rejected"))),
  ]);
  const reviewedWithApprovedKnowledgeCount = Number(reviewedWithKnowledge[0]?.count ?? 0);
  const approvedAsIsWithKnowledgeCount = Number(approvedAsIsWithKnowledgeQuery[0]?.count ?? 0);
  return {
    ...summary,
    approvedKnowledge: Number(approvedKnowledge[0]?.count ?? 0),
    runsWithApprovedKnowledge: Number(sourceRuns[0]?.count ?? 0),
    reviewedWithApprovedKnowledge: reviewedWithApprovedKnowledgeCount,
    approvedAsIsWithKnowledge: approvedAsIsWithKnowledgeCount,
    editedWithKnowledge: Number(editedWithKnowledge[0]?.count ?? 0),
    rejectedWithKnowledge: Number(rejectedWithKnowledge[0]?.count ?? 0),
    knowledgeCoverageRate: summary.reviewed ? Math.round((reviewedWithApprovedKnowledgeCount / summary.reviewed) * 100) : 0,
    knowledgeAlignmentRate: reviewedWithApprovedKnowledgeCount ? Math.round((approvedAsIsWithKnowledgeCount / reviewedWithApprovedKnowledgeCount) * 100) : 0,
  };
}
