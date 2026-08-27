import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { listLLMModels } from "../_core/llm";
import { employeeBotRequiredOperationalPermission, employeeBotStatuses, generateEmployeeBotCommand, getEmployeeBotCommand, getEmployeeBotSettings, getEmployeeBotSummary, listEmployeeBotCommands, reviewEmployeeBotCommand, updateEmployeeBotSettings } from "../employeeBot/db";

async function requireStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }, permission: "employee_bot.use" | "employee_bot.review" | "employee_bot.manage") {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, permission, ctx.operationalStore.id);
  return ctx.operationalStore;
}

const settingsInput = z.object({ enabled: z.boolean(), fastModel: z.string().trim().min(1).max(100), escalationModel: z.string().trim().min(1).max(100), minimumConfidence: z.number().int().min(1).max(100), maxDailyCommands: z.number().int().min(1).max(1000), maxDailyEscalations: z.number().int().min(1).max(500) });
const reviewInput = z.object({ commandId: z.number().int().positive(), decision: z.enum(["approved", "rejected", "needs_clarification"]), note: z.string().trim().max(2000).nullable().optional(), finalChanges: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable().optional() });

export const employeeBotRouter = router({
  settings: protectedProcedure.query(async ({ ctx }) => getEmployeeBotSettings((await requireStore(ctx, "employee_bot.manage")).id)),
  availableModels: protectedProcedure.query(async ({ ctx }) => {
    await requireStore(ctx, "employee_bot.manage");
    const models = await listLLMModels();
    return models.data.map(model => model.id);
  }),
  updateSettings: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "employee_bot.manage");
    const available = await listLLMModels();
    const ids = new Set(available.data.map(model => model.id));
    if (!ids.has(input.fastModel) || !ids.has(input.escalationModel)) throw new TRPCError({ code: "BAD_REQUEST", message: "النموذج المختار لم يعد متاحاً في كتالوج المنصة الحي." });
    const settings = await updateEmployeeBotSettings({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "employee_bot_settings", entityId: settings.id, action: "employee_bot.settings_updated", summary: `تم تحديث إعدادات مساعد الموظفين: سريع ${settings.fastModel} وتصعيد ${settings.escalationModel}.` });
    return settings;
  }),
  createCommand: protectedProcedure.input(z.object({ rawCommand: z.string().trim().min(3).max(2000) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "employee_bot.use");
    const command = await generateEmployeeBotCommand({ storeId: store.id, actorUserId: ctx.user.id, rawCommand: input.rawCommand });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "employee_bot_command", entityId: command.id, action: "employee_bot.command_drafted", summary: `أنشأ مساعد الموظفين مسودة: ${command.targetLabel ?? "تحتاج استيضاحاً"}.` });
    return command;
  }),
  myCommands: protectedProcedure.input(z.object({ status: z.enum(employeeBotStatuses).optional() }).optional()).query(async ({ ctx, input }) => listEmployeeBotCommands({ storeId: (await requireStore(ctx, "employee_bot.use")).id, requestedByUserId: ctx.user.id, status: input?.status })),
  reviewQueue: protectedProcedure.input(z.object({ status: z.enum(employeeBotStatuses).optional() }).optional()).query(async ({ ctx, input }) => listEmployeeBotCommands({ storeId: (await requireStore(ctx, "employee_bot.review")).id, status: input?.status })),
  summary: protectedProcedure.query(async ({ ctx }) => getEmployeeBotSummary((await requireStore(ctx, "employee_bot.review")).id)),
  review: protectedProcedure.input(reviewInput).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx, "employee_bot.review");
    const command = await getEmployeeBotCommand(store.id, input.commandId);
    if (input.decision === "approved") {
      const operationalPermission = await employeeBotRequiredOperationalPermission(command.intent);
      if (!operationalPermission) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن اعتماد هذه المسودة كعملية تشغيلية." });
      await assertPermission(ctx.user, operationalPermission, store.id);
    }
    const reviewed = await reviewEmployeeBotCommand({ ...input, storeId: store.id, reviewerUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "employee_bot_command", entityId: input.commandId, action: `employee_bot.command_${reviewed.status}`, summary: `قرار مراجعة مسودة مساعد الموظفين: ${reviewed.status}.` });
    return reviewed;
  }),
});
