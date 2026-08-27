import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { getProductFinancialDetail, listFinancialProducts, updateProductFinancials } from "../financials/db";
import { protectedProcedure, router } from "../_core/trpc";

const moneyValue = z.string().regex(/^\d+(\.\d{1,2})?$/, "أدخل قيمة مالية صحيحة.");
const marginValue = z.string().regex(/^\d+(\.\d{1,2})?$/, "أدخل نسبة صحيحة.").refine(value => Number(value) <= 100, "لا يمكن أن تتجاوز النسبة 100٪.");

function storeId(store: { id: number } | null | undefined) {
  if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
  return store.id;
}

function toTrpcError(error: unknown) {
  if (error instanceof TRPCError) return error;
  return new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر إتمام العملية المالية." });
}

export const financialsRouter = router({
  listProducts: protectedProcedure.query(async ({ ctx }) => {
    const activeStoreId = storeId(ctx.operationalStore);
    await assertPermission(ctx.user, "finance.view_sensitive", activeStoreId);
    return listFinancialProducts(activeStoreId);
  }),
  byProduct: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const activeStoreId = storeId(ctx.operationalStore);
    await assertPermission(ctx.user, "finance.view_sensitive", activeStoreId);
    try {
      return await getProductFinancialDetail({ storeId: activeStoreId, productId: input.productId });
    } catch (error) {
      throw toTrpcError(error);
    }
  }),
  updateProduct: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    costPrice: moneyValue.nullable().optional(),
    targetMarginPercent: marginValue.nullable().optional(),
    reason: z.string().trim().min(3).max(360),
  })).mutation(async ({ ctx, input }) => {
    const activeStoreId = storeId(ctx.operationalStore);
    await assertPermission(ctx.user, "finance.manage_sensitive", activeStoreId);
    try {
      const result = await updateProductFinancials({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({
        storeId: activeStoreId,
        actorUserId: ctx.user.id,
        entityType: "product_financials",
        entityId: input.productId,
        action: "updated",
        summary: "حدّث حقول تكلفة أو هامش منتج حساسة.",
        metadata: { updatedCost: input.costPrice !== undefined, updatedTargetMargin: input.targetMarginPercent !== undefined },
      });
      return result;
    } catch (error) {
      throw toTrpcError(error);
    }
  }),
});
