import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { getAnalyticsOverview } from "../analytics/db";
import { protectedProcedure, router } from "../_core/trpc";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "استخدمي تاريخاً بصيغة YYYY-MM-DD.");

function asUtcDate(value: string, endOfDay = false) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "التاريخ غير صالح." });
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function defaultPeriod() {
  const now = new Date();
  const endAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const startAt = new Date(endAt.getTime());
  startAt.setUTCDate(startAt.getUTCDate() - 30);
  return { startAt, endAt };
}

function normalizePeriod(input?: { startDate?: string; endDate?: string }) {
  if (!input?.startDate && !input?.endDate) return defaultPeriod();
  if (!input.startDate || !input.endDate) throw new TRPCError({ code: "BAD_REQUEST", message: "اختاري تاريخ بداية ونهاية معاً." });
  const startAt = asUtcDate(input.startDate);
  const endAt = asUtcDate(input.endDate, true);
  const spanDays = (endAt.getTime() - startAt.getTime()) / 86_400_000;
  if (endAt <= startAt || spanDays > 366) throw new TRPCError({ code: "BAD_REQUEST", message: "اختاري فترة صحيحة لا تتجاوز 366 يوماً." });
  if (startAt > new Date() || endAt > new Date(Date.now() + 86_400_000)) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن طلب فترة مستقبلية." });
  return { startAt, endAt };
}

export const analyticsRouter = router({
  overview: protectedProcedure.input(z.object({ startDate: dateSchema.optional(), endDate: dateSchema.optional() }).optional()).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "analytics.view");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
    try {
      return await getAnalyticsOverview({ storeId: ctx.operationalStore.id, period: normalizePeriod(input) });
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر تحميل المؤشرات." });
    }
  }),
});
