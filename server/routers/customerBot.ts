import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { listLLMModels } from "../_core/llm";
import { botModes, dismissCustomerBotRun, generateCustomerBotDraft, getCustomerBotSettings, listCustomerBotRuns, simulateCustomerBotInstruction, updateCustomerBotSettings } from "../customerBot/db";
import { createCustomerBotKnowledge, createCustomerBotKnowledgeGap, extractHistoricalKnowledgeCandidates, gapCategories, gapStatuses, getCustomerBotQualitySummary, knowledgeKinds, knowledgeStatuses, listCustomerBotKnowledge, listCustomerBotKnowledgeGaps, listCustomerBotKnowledgeSources, listCustomerBotReviewQueue, resolveCustomerBotKnowledgeGap, reviewCustomerBotRun, reviewOutcomes, setCustomerBotKnowledgeStatus, teachCustomerBotFromReviewedRun, updateCustomerBotKnowledge } from "../customerBot/knowledge";
import { analyzeCustomerMessageImage } from "../customerBot/imageAnalysis";
import { archiveCustomerBotOrderDraft, createFinalOrderFromCustomerBotDraft, listCustomerBotOrderDrafts } from "../customerBot/orderDrafts";
import { createStyleCandidateFromTrainingAsset, listCustomerBotTrainingAssets, uploadCustomerBotTrainingAsset } from "../customerBot/training";
import { createAudioCommandRequest, createLearningProposal, createPlaygroundSession, createTextCommandRequest, closePlaygroundSession, getPlaygroundSession, listBehaviorCards, listCommandRequests, listLearningProposals, listPlaybooks, listPlaygroundSessions, listTestCases, playgroundChannels, playgroundModes, proposalCategories, proposalStatuses, saveCommandAsProposal, sendPlaygroundMessage, setBehaviorCardStatus, setLearningProposalStatus, setPlaybookStatus, setTestCaseStatus } from "../customerBot/playground";

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
  welcomeTemplate: z.string().trim().max(1000).nullable(),
  priceReplyTemplate: z.string().trim().max(1000).nullable(),
  colorOfferTemplate: z.string().trim().max(1000).nullable(),
  productCardTemplate: z.string().trim().max(1000).nullable(),
  orderSummaryTemplate: z.string().trim().max(1500).nullable(),
  confirmationTemplate: z.string().trim().max(1000).nullable(),
  humanWaitingTemplate: z.string().trim().max(1000).nullable(),
  productResponseMode: z.enum(["smart", "images", "product_card", "ask_first"]),
  learningEnabled: z.boolean(),
  learningReviewDays: z.number().int().min(1).max(90),
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
  orderDrafts: protectedProcedure.query(async ({ ctx }) => listCustomerBotOrderDrafts((await requireStore(ctx, "bot.manage")).id)),
  trainingAssets: protectedProcedure.query(async ({ ctx }) => listCustomerBotTrainingAssets((await requireStore(ctx, "bot.manage")).id)),
  uploadTrainingAsset: protectedProcedure.input(z.object({ fileName: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(3).max(120), base64: z.string().min(4).max(23_000_000) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const asset = await uploadCustomerBotTrainingAsset({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_training_asset", entityId: asset.id, action: "bot.training_asset_uploaded", summary: `رُفع مصدر تدريب ${asset.kind === "audio" ? "صوتي" : "نصي"} للمراجعة.` });
    return asset;
  }),
  createStyleCandidateFromAsset: protectedProcedure.input(z.object({ assetId: z.number().int().positive(), title: z.string().trim().min(3).max(240).optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const result = await createStyleCandidateFromTrainingAsset({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_training_asset", entityId: input.assetId, action: "bot.training_candidate_created", summary: "حُوّل مصدر تدريب إلى بطاقة أسلوب مسودة تنتظر الاعتماد." });
    return result;
  }),
  archiveOrderDraft: protectedProcedure.input(z.object({ draftId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const result = await archiveCustomerBotOrderDraft({ storeId: store.id, draftId: input.draftId });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_order_draft", entityId: input.draftId, action: "bot.order_draft_archived", summary: "أُرشفت مسودة طلب بوت غير نهائية." });
    return result;
  }),
  createOrderFromDraft: protectedProcedure.input(z.object({ draftId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    await assertPermission(ctx.user, "orders.confirm", store.id);
    const result = await createFinalOrderFromCustomerBotDraft({ storeId: store.id, draftId: input.draftId, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "order", entityId: result.orderId, action: "bot.order_draft_approved", summary: `حوّل الموظف مسودة Bot-H3 #${input.draftId} إلى طلب ${result.orderNumber}.` });
    return result;
  }),
  simulateInstruction: protectedProcedure.input(z.object({ instruction: z.string().trim().min(3).max(12000), sampleMessage: z.string().trim().min(2).max(1200) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const result = await simulateCustomerBotInstruction({ ...input, storeId: store.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_simulation", entityId: store.id, action: "bot.instruction_simulated", summary: "تم اختبار تعليمة مشغل داخل المحاكاة دون إرسال أو إنشاء تشغيل." });
    return result;
  }),
  playgroundSessions: protectedProcedure.query(async ({ ctx }) => listPlaygroundSessions((await requireStore(ctx, "bot.manage")).id)),
  playgroundSession: protectedProcedure.input(z.object({ sessionId: z.number().int().positive() })).query(async ({ ctx, input }) => getPlaygroundSession((await requireStore(ctx, "bot.manage")).id, input.sessionId)),
  createPlaygroundSession: protectedProcedure.input(z.object({ mode: z.enum(playgroundModes), channel: z.enum(playgroundChannels), conversationId: z.number().int().positive().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const session = await createPlaygroundSession({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_playground", entityId: session.id, action: "bot.playground_created", summary: "بدأت جلسة اختبار داخلية لا ترسل إلى Meta ولا تنشئ طلباً نهائياً." });
    return session;
  }),
  sendPlaygroundMessage: protectedProcedure.input(z.object({ sessionId: z.number().int().positive(), body: z.string().trim().min(2).max(1800) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const result = await sendPlaygroundMessage({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_playground", entityId: input.sessionId, action: "bot.playground_message_sent", summary: "شُغلت رسالة اختبار داخل المختبر من دون إرسال خارجي أو إنشاء طلب نهائي." });
    return result;
  }),
  closePlaygroundSession: protectedProcedure.input(z.object({ sessionId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    await closePlaygroundSession({ storeId: store.id, sessionId: input.sessionId });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_playground", entityId: input.sessionId, action: "bot.playground_closed", summary: "أُغلقت جلسة الاختبار الداخلية." });
  }),
  learningProposals: protectedProcedure.input(z.object({ status: z.enum(proposalStatuses).optional() }).optional()).query(async ({ ctx, input }) => listLearningProposals((await requireStore(ctx, "bot.manage")).id, input?.status)),
  createLearningProposal: protectedProcedure.input(z.object({ sessionId: z.number().int().positive(), sourceMessageId: z.number().int().positive(), category: z.enum(proposalCategories), editedReply: z.string().trim().min(2).max(5000), title: z.string().trim().min(3).max(240).nullable().optional(), body: z.string().trim().min(2).max(12000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const proposal = await createLearningProposal({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_learning_proposal", entityId: proposal.id, action: "bot.playground_learning_proposal_created", summary: `حُفظ تعديل مختبر كمسودة ${proposal.category} للمراجعة.` });
    return proposal;
  }),
  setLearningProposalStatus: protectedProcedure.input(z.object({ proposalId: z.number().int().positive(), status: z.enum(["approved", "rejected", "archived"]) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, input.status === "approved" ? "bot.knowledge.approve" : "bot.manage");
    const result = await setLearningProposalStatus({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_learning_proposal", entityId: input.proposalId, action: `bot.learning_proposal_${input.status}`, summary: `تغيرت حالة اقتراح التعلم إلى ${input.status}.` });
    return result;
  }),
  behaviorCards: protectedProcedure.query(async ({ ctx }) => listBehaviorCards((await requireStore(ctx, "bot.manage")).id)),
  playbooks: protectedProcedure.query(async ({ ctx }) => listPlaybooks((await requireStore(ctx, "bot.manage")).id)),
  testCases: protectedProcedure.query(async ({ ctx }) => listTestCases((await requireStore(ctx, "bot.manage")).id)),
  setBehaviorCardStatus: protectedProcedure.input(z.object({ cardId: z.number().int().positive(), status: z.enum(["approved", "archived"]) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.knowledge.approve");
    const card = await setBehaviorCardStatus({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_behavior_card", entityId: card.id, action: `bot.behavior_card_${input.status}`, summary: `تغيرت حالة بطاقة السلوك إلى ${input.status}.` });
    return card;
  }),
  setPlaybookStatus: protectedProcedure.input(z.object({ playbookId: z.number().int().positive(), status: z.enum(["approved", "archived"]) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.knowledge.approve");
    const playbook = await setPlaybookStatus({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_playbook", entityId: playbook.id, action: `bot.playbook_${input.status}`, summary: `تغيرت حالة إجراء البيع إلى ${input.status}.` });
    return playbook;
  }),
  setTestCaseStatus: protectedProcedure.input(z.object({ testCaseId: z.number().int().positive(), status: z.enum(["approved", "archived"]) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.knowledge.approve");
    const testCase = await setTestCaseStatus({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_test_case", entityId: testCase.id, action: `bot.test_case_${input.status}`, summary: `تغيرت حالة اختبار البوت إلى ${input.status}.` });
    return testCase;
  }),
  commandRequests: protectedProcedure.query(async ({ ctx }) => listCommandRequests((await requireStore(ctx, "bot.manage")).id)),
  createTextCommand: protectedProcedure.input(z.object({ text: z.string().trim().min(3).max(12000) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const result = await createTextCommandRequest({ storeId: store.id, actorUserId: ctx.user.id, text: input.text });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_command", entityId: result.command.id, action: "bot.command_interpreted", summary: "فُسّر أمر نصي إلى تغيير مقترح ينتظر تأكيد المدير." });
    return result;
  }),
  createAudioCommand: protectedProcedure.input(z.object({ fileName: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(3).max(120), base64: z.string().min(4).max(23_000_000) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const result = await createAudioCommandRequest({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_command", entityId: result.command.id, action: "bot.voice_command_transcribed", summary: "حُوّل أمر صوتي إلى نص وتغيير مقترح؛ لم يُنفذ أي تغيير تلقائياً." });
    return result;
  }),
  saveCommandAsProposal: protectedProcedure.input(z.object({ commandId: z.number().int().positive(), category: z.enum(proposalCategories), title: z.string().trim().min(3).max(240), body: z.string().trim().min(2).max(12000) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const proposal = await saveCommandAsProposal({ storeId: store.id, actorUserId: ctx.user.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_learning_proposal", entityId: proposal.id, action: "bot.command_saved_as_draft", summary: "حُفظ تفسير مساعد الأوامر كمسودة تعليمية تنتظر المراجعة." });
    return proposal;
  }),
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
  teachFromReview: protectedProcedure.input(z.object({ runId: z.number().int().positive(), title: z.string().trim().min(3).max(240).optional(), kind: z.enum(["faq", "policy", "style_guidance"]).optional(), body: z.string().trim().min(12).max(1800).optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const result = await teachCustomerBotFromReviewedRun({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_knowledge", entityId: result.article.id, action: "bot.teach_from_review", summary: `أُنشئ مرشح تعليم من مراجعة Bot-H3 رقم ${result.sourceRunId}، وهو ينتظر اعتماداً مستقلاً.` });
    return result;
  }),
  reviewRun: protectedProcedure.input(z.object({ runId: z.number().int().positive(), outcome: z.enum(reviewOutcomes), finalReply: z.string().trim().max(1800).nullable().optional(), feedback: z.string().trim().max(3000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const review = await reviewCustomerBotRun({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_run", entityId: input.runId, action: "bot.run_reviewed", summary: `تمت مراجعة مسودة البوت: ${input.outcome}.` });
    return review;
  }),
  knowledge: protectedProcedure.input(z.object({ status: z.enum(knowledgeStatuses).optional() }).optional()).query(async ({ ctx, input }) => listCustomerBotKnowledge((await requireStore(ctx, "bot.manage")).id, input?.status)),
  extractHistoricalCandidates: protectedProcedure.input(z.object({ channels: z.array(z.enum(["whatsapp", "instagram", "messenger"])).min(1).optional(), limit: z.number().int().min(1).max(100).optional() }).optional()).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    const settings = await getCustomerBotSettings(store.id);
    if (!settings.learningEnabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "التعلم المراقب معطل من إعدادات البوت." });
    const since = new Date(Date.now() - settings.learningReviewDays * 24 * 60 * 60 * 1000);
    const result = await extractHistoricalKnowledgeCandidates({ ...input, storeId: store.id, actorUserId: ctx.user.id, since });
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
