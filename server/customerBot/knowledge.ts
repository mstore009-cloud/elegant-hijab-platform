import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { customerBotKnowledgeArticles, customerBotKnowledgeGaps, customerBotRunKnowledgeSources, customerBotRunReviews, customerBotRuns, inboxConversations, inboxMessages } from "../../drizzle/schema";
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

export async function extractHistoricalKnowledgeCandidates(input: { storeId: number; actorUserId: number; channels?: Array<"whatsapp" | "instagram" | "messenger">; limit?: number }) {
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
  }).from(inboxMessages).innerJoin(inboxConversations, eq(inboxMessages.conversationId, inboxConversations.id)).where(and(eq(inboxConversations.storeId, input.storeId), eq(inboxMessages.source, "historical_sync"), or(eq(inboxMessages.direction, "inbound"), eq(inboxMessages.direction, "outbound")), channelFilter)).orderBy(asc(inboxMessages.conversationId), asc(inboxMessages.occurredAt), asc(inboxMessages.id)).limit(limit * 8);

  const nextOutbound = new Map<number, typeof messages[number]>();
  const pendingInbound = new Map<number, typeof messages[number]>();
  for (const message of messages) {
    if (message.direction === "inbound") {
      pendingInbound.set(message.conversationId, message);
      continue;
    }
    const inbound = pendingInbound.get(message.conversationId);
    if (inbound && !nextOutbound.has(inbound.messageId)) nextOutbound.set(inbound.messageId, message);
    pendingInbound.delete(message.conversationId);
  }
  const pairs = Array.from(nextOutbound.entries()).slice(0, limit);
  if (!pairs.length) return { scannedMessages: messages.length, candidatePairs: 0, createdCandidates: 0, skippedExisting: 0 };

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
  return { scannedMessages: messages.length, candidatePairs: pairs.length, createdCandidates, skippedExisting };
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
