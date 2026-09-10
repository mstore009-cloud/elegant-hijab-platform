import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { recordAuditEvent } from "../audit/db";
import { aiTaskNames } from "../../drizzle/schema";
import { getAiConnection, getAiOverview, listAiModels, listAiUsage, saveAiConnection, testAiConnection, updateAiTask } from "../ai/db";
import type { AiProvider, AiTask } from "../ai/types";

function requireStore(ctx: { operationalStore: { id: number } | null }) {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي لسجل التدقيق الحالي." });
  return ctx.operationalStore;
}

const provider = z.enum(["openai", "gemini", "anthropic"]);
const task = z.enum(aiTaskNames);
const connectionInput = z.object({ id: z.number().int().positive().optional(), provider, displayName: z.string().trim().min(2).max(160), connectionType: z.enum(["api_key", "vertex_ai"]).default("api_key"), apiKey: z.string().trim().max(500).optional(), enabled: z.boolean().default(false) });
const taskInput = z.object({ task, providerConnectionId: z.number().int().positive().nullable(), model: z.string().trim().min(1).max(160), enabled: z.boolean(), maxTokens: z.number().int().min(1).max(100000), timeoutMs: z.number().int().min(1000).max(120000), maxRetries: z.number().int().min(0).max(6), fallbackEnabled: z.boolean(), dailyQuota: z.number().int().positive().nullable(), monthlyQuota: z.number().int().positive().nullable(), monthlyBudget: z.string().regex(/^\d+(\.\d{1,6})?$/).nullable(), overLimitAction: z.enum(["pause", "draft_only", "handoff"]) });

export const aiRouter = router({
  overview: adminProcedure.query(async () => getAiOverview()),
  usage: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional()).query(async ({ input }) => listAiUsage(input?.limit ?? 100)),
  saveConnection: adminProcedure.input(connectionInput).mutation(async ({ ctx, input }) => {
    try {
      const result = await saveAiConnection({ ...input, actorUserId: ctx.user.id });
      const store = requireStore(ctx);
      await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "ai_provider_connection", entityId: String(input.id ?? "new"), action: "ai.connection_saved", summary: `تم حفظ إعداد اتصال ${input.provider} دون تسجيل المفتاح.` });
      return result;
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر حفظ اتصال AI." }); }
  }),
  testConnection: adminProcedure.input(z.object({ id: z.number().int().positive(), provider })).mutation(async ({ ctx, input }) => {
    try {
      const result = await testAiConnection(input);
      const store = requireStore(ctx);
      await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "ai_provider_connection", entityId: input.id, action: "ai.connection_tested", summary: `تم اختبار اتصال ${input.provider} بنجاح مع ${result.modelCount} نموذجًا.` });
      return result;
    } catch (error) { throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "فشل اختبار اتصال AI." }); }
  }),
  models: adminProcedure.input(z.object({ connectionId: z.number().int().positive() })).query(async ({ input }) => listAiModels({ id: input.connectionId })),
  updateTask: adminProcedure.input(taskInput).mutation(async ({ ctx, input }) => {
    try {
      const result = await updateAiTask({ ...input, task: input.task as AiTask, actorUserId: ctx.user.id });
      const store = requireStore(ctx);
      await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "ai_task_configuration", entityId: input.task, action: "ai.task_updated", summary: `تم تحديث مسار مهمة AI: ${input.task}.` });
      return result;
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر تحديث مهمة AI." }); }
  }),
});
