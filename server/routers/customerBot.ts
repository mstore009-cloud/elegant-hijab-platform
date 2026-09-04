import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { listLLMModels } from "../_core/llm";
import { botModes, dismissCustomerBotRun, generateCustomerBotDraft, getCustomerBotSettings, listCustomerBotRuns, updateCustomerBotSettings } from "../customerBot/db";
import { createCustomerBotKnowledge, createCustomerBotKnowledgeGap, extractHistoricalKnowledgeCandidates, gapCategories, gapStatuses, getCustomerBotQualitySummary, knowledgeKinds, knowledgeStatuses, listCustomerBotKnowledge, listCustomerBotKnowledgeGaps, listCustomerBotKnowledgeSources, listCustomerBotReviewQueue, resolveCustomerBotKnowledgeGap, reviewCustomerBotRun, reviewOutcomes, setCustomerBotKnowledgeStatus, updateCustomerBotKnowledge } from "../customerBot/knowledge";
import { analyzeCustomerMessageImage } from "../customerBot/imageAnalysis";

async function requireStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }, permission: "inbox.read" | "inbox.reply" | "bot.manage" | "bot.knowledge.approve") {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, permission, ctx.operationalStore.id);
  return ctx.operationalStore;
}

const settingsInput = z.object({
  enabled: z.boolean(),
  mode: z.enum(botModes),
  messengerEnabled: z.boolean(),
  instagramEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  dialect: z.string().trim().min(2).max(80),
  tone: z.enum(["warm", "professional", "concise"]),
  operatorInstructions: z.string().trim().max(12000).nullable(),
  fastModel: z.string().trim().min(1).max(80),
  escalationModel: z.string().trim().min(1).max(80),
  minimumConfidence: z.number().int().min(1).max(100),
  maxDailyReplies: z.number().int().min(1).max(1000),
  maxDailyEscalations: z.number().int().min(1).max(500),
});
const knowledgeInput = z.object({ title: z.string().trim().min(3).max(240), kind: z.enum(knowledgeKinds), body: z.string().trim().min(12).max(12000) });

export const customerBotRouter = router({
  settings: protectedProcedure.query(async ({ ctx }) => getCustomerBotSettings((await requireStore(ctx, "bot.manage")).id)),
  availableModels: protectedProcedure.query(async ({ ctx }) => {
    await requireStore(ctx, "bot.manage");
    const models = await listLLMModels();
    return models.data.map(model => model.id);
  }),
  updateSettings: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    if (input.mode === "auto_reply" && !input.enabled) throw new TRPCError({ code: "BAD_REQUEST", message: "فعّل البوت أولاً أو استخدم وضع المسودات قبل حفظ الرد الآلي." });
    if (input.mode === "auto_reply" && !input.messengerEnabled && !input.instagramEnabled && !input.whatsappEnabled) throw new TRPCError({ code: "BAD_REQUEST", message: "اختر قناة واحدة على الأقل قبل تفعيل الرد الآلي." });
    const available = await listLLMModels();
    const ids = new Set(available.data.map(model => model.id));
    if (!ids.has(input.fastModel) || !ids.has(input.escalationModel)) throw new TRPCError({ code: "BAD_REQUEST", message: "النموذج المختار لم يعد متاحاً في كتالوج المنصة الحي." });
    const settings = await updateCustomerBotSettings({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_settings", entityId: settings.id, action: "bot.settings_updated", summary: `تم تحديث إعدادات البوت: وضع ${settings.mode}، سريع ${settings.fastModel}، وتصعيد ${settings.escalationModel}.` });
    return settings;
  }),
  runs: protectedProcedure.input(z.object({ conversationId: z.number().int().positive() })).query(async ({ ctx, input }) => listCustomerBotRuns((await requireStore(ctx, "inbox.read")).id, input.conversationId)),
  generateDraft: protectedProcedure.input(z.object({ conversationId: z.number().int().positive(), sourceMessageId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "inbox.reply");
    const result = await generateCustomerBotDraft({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_run", entityId: result.runId, action: "bot.draft_generated", summary: result.route === "human_handoff" ? "حوّل البوت الحالة إلى موظف للمراجعة." : `أنشأ البوت مسودة رد عبر مسار ${result.route}.` });
    return result;
  }),
  analyzeImage: protectedProcedure.input(z.object({ mediaId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "inbox.reply");
    const result = await analyzeCustomerMessageImage({ storeId: store.id, mediaId: input.mediaId });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_image_analysis", entityId: result.analysisId ?? input.mediaId, action: "bot.image_analyzed", summary: result.status === "completed" ? "تم تحليل صورة عميل كاقتراح للمراجعة." : "تعذر تحليل صورة عميل وسُجل سبب الفشل." });
    return result;
  }),
  dismissDraft: protectedProcedure.input(z.object({ conversationId: z.number().int().positive(), runId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "inbox.reply");
    await dismissCustomerBotRun({ ...input, storeId: store.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_run", entityId: input.runId, action: "bot.draft_dismissed", summary: "رُفضت مسودة البوت قبل اعتمادها أو إرسالها." });
  }),
  qualitySummary: protectedProcedure.query(async ({ ctx }) => getCustomerBotQualitySummary((await requireStore(ctx, "bot.manage")).id)),
  reviewQueue: protectedProcedure.query(async ({ ctx }) => listCustomerBotReviewQueue((await requireStore(ctx, "bot.manage")).id)),
  reviewRun: protectedProcedure.input(z.object({ runId: z.number().int().positive(), outcome: z.enum(reviewOutcomes), finalReply: z.string().trim().max(1800).nullable().optional(), feedback: z.string().trim().max(3000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const review = await reviewCustomerBotRun({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_run", entityId: input.runId, action: "bot.run_reviewed", summary: `تمت مراجعة مسودة البوت: ${input.outcome}.` });
    return review;
  }),
  knowledge: protectedProcedure.input(z.object({ status: z.enum(knowledgeStatuses).optional() }).optional()).query(async ({ ctx, input }) => listCustomerBotKnowledge((await requireStore(ctx, "bot.manage")).id, input?.status)),
  extractHistoricalCandidates: protectedProcedure.input(z.object({ channels: z.array(z.enum(["whatsapp", "instagram", "messenger"])).min(1).optional(), limit: z.number().int().min(1).max(100).optional() }).optional()).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const result = await extractHistoricalKnowledgeCandidates({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_knowledge", entityId: store.id, action: "bot.historical_candidates_extracted", summary: `تم فحص ${result.scannedMessages} رسالة تاريخية وإنشاء ${result.createdCandidates} مرشح معرفة للمراجعة.` });
    return result;
  }),
  createKnowledge: protectedProcedure.input(knowledgeInput.extend({ source: z.enum(["manual", "review_feedback", "historical_candidate"]).optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const article = await createCustomerBotKnowledge({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_knowledge", entityId: article.id, action: "bot.knowledge_created", summary: `أُنشئت بطاقة معرفة مسودة: ${article.title}.` });
    return article;
  }),
  updateKnowledge: protectedProcedure.input(knowledgeInput.extend({ articleId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const article = await updateCustomerBotKnowledge({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_knowledge", entityId: article.id, action: "bot.knowledge_updated", summary: `حُدّثت بطاقة المعرفة: ${article.title}.` });
    return article;
  }),
  setKnowledgeStatus: protectedProcedure.input(z.object({ articleId: z.number().int().positive(), status: z.enum(["approved", "archived"]) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.knowledge.approve");
    const article = await setCustomerBotKnowledgeStatus({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_knowledge", entityId: article.id, action: `bot.knowledge_${input.status}`, summary: `${input.status === "approved" ? "اعتمدت" : "أرشفت"} بطاقة المعرفة: ${article.title}.` });
    return article;
  }),
  knowledgeSources: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).query(async ({ ctx, input }) => listCustomerBotKnowledgeSources((await requireStore(ctx, "bot.manage")).id, input.runId)),
  knowledgeGaps: protectedProcedure.input(z.object({ status: z.enum(gapStatuses).optional() }).optional()).query(async ({ ctx, input }) => listCustomerBotKnowledgeGaps((await requireStore(ctx, "bot.manage")).id, input?.status)),
  createKnowledgeGap: protectedProcedure.input(z.object({ runId: z.number().int().positive().nullable().optional(), category: z.enum(gapCategories), title: z.string().trim().min(3).max(240), questionSnapshot: z.string().trim().max(4000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const gap = await createCustomerBotKnowledgeGap({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_gap", entityId: gap.id, action: "bot.knowledge_gap_created", summary: `فُتحت فجوة معرفة: ${gap.title}.` });
    return gap;
  }),
  resolveKnowledgeGap: protectedProcedure.input(z.object({ gapId: z.number().int().positive(), status: z.enum(["resolved", "dismissed"]), resolutionNote: z.string().trim().max(3000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const gap = await resolveCustomerBotKnowledgeGap({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_gap", entityId: gap.id, action: `bot.knowledge_gap_${input.status}`, summary: `${input.status === "resolved" ? "حُلّت" : "استُبعدت"} فجوة المعرفة: ${gap.title}.` });
    return gap;
  }),
});
