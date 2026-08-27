import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { listLLMModels } from "../_core/llm";
import { botModes, dismissCustomerBotRun, generateCustomerBotDraft, getCustomerBotSettings, listCustomerBotRuns, updateCustomerBotSettings } from "../customerBot/db";

async function requireStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }, permission: "inbox.read" | "inbox.reply" | "bot.manage") {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, permission, ctx.operationalStore.id);
  return ctx.operationalStore;
}

const settingsInput = z.object({
  enabled: z.boolean(), mode: z.enum(botModes), fastModel: z.string().trim().min(1).max(80), escalationModel: z.string().trim().min(1).max(80),
  minimumConfidence: z.number().int().min(1).max(100), maxDailyReplies: z.number().int().min(1).max(1000), maxDailyEscalations: z.number().int().min(1).max(500),
});

export const customerBotRouter = router({
  settings: protectedProcedure.query(async ({ ctx }) => getCustomerBotSettings((await requireStore(ctx, "bot.manage")).id)),
  availableModels: protectedProcedure.query(async ({ ctx }) => {
    await requireStore(ctx, "bot.manage");
    const models = await listLLMModels();
    return models.data.map(model => model.id);
  }),
  updateSettings: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "bot.manage");
    if (input.mode === "auto_reply") throw new TRPCError({ code: "BAD_REQUEST", message: "الإرسال الآلي غير متاح قبل ربط قناة رسمية واختبارها. استخدم وضع المسودات للمراجعة." });
    const available = await listLLMModels();
    const ids = new Set(available.data.map(model => model.id));
    if (!ids.has(input.fastModel) || !ids.has(input.escalationModel)) throw new TRPCError({ code: "BAD_REQUEST", message: "النموذج المختار لم يعد متاحاً في كتالوج المنصة الحي." });
    const settings = await updateCustomerBotSettings({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_settings", entityId: settings.id, action: "bot.settings_updated", summary: `تم تحديث إعدادات البوت: سريع ${settings.fastModel}، وتصعيد ${settings.escalationModel}.` });
    return settings;
  }),
  runs: protectedProcedure.input(z.object({ conversationId: z.number().int().positive() })).query(async ({ ctx, input }) => listCustomerBotRuns((await requireStore(ctx, "inbox.read")).id, input.conversationId)),
  generateDraft: protectedProcedure.input(z.object({ conversationId: z.number().int().positive(), sourceMessageId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "inbox.reply");
    const result = await generateCustomerBotDraft({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_run", entityId: result.runId, action: "bot.draft_generated", summary: result.route === "human_handoff" ? "حوّل البوت الحالة إلى موظف للمراجعة." : `أنشأ البوت مسودة رد عبر مسار ${result.route}.` });
    return result;
  }),
  dismissDraft: protectedProcedure.input(z.object({ conversationId: z.number().int().positive(), runId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "inbox.reply");
    await dismissCustomerBotRun({ ...input, storeId: store.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_bot_run", entityId: input.runId, action: "bot.draft_dismissed", summary: "رُفضت مسودة البوت قبل اعتمادها أو إرسالها." });
  }),
});
