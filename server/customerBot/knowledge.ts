import { and, desc, eq, sql } from "drizzle-orm";
import { customerBotKnowledgeArticles, customerBotKnowledgeGaps, customerBotRunKnowledgeSources, customerBotRunReviews, customerBotRuns, inboxConversations } from "../../drizzle/schema";
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
