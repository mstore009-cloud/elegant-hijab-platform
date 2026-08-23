import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { getEmployeePermissionCodesForUser } from "../access/db";
import { canViewSensitiveFinancialData } from "../access/permissions";
import { createImportJob, createProduct, getProductWithVariants, listImportJobs, listProducts, listPublicProducts, updateVariantInventory } from "../products/db";
import { presentProductForViewer } from "../products/financialVisibility";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";

const moneyString = z.string().regex(/^\d+(\.\d{1,2})?$/, "يجب إدخال رقم مالي صالح.");
const productStatus = z.enum(["draft", "needs_review", "ready", "active", "archived"]);

async function viewerFinancialAccess(user: { id: number; role: "admin" | "user" }) {
  const grantedPermissionCodes = await getEmployeePermissionCodesForUser(user.id);
  return canViewSensitiveFinancialData({ isPlatformAdmin: user.role === "admin", grantedPermissionCodes });
}

export const productsRouter = router({
  publicList: publicProcedure.query(async () => listPublicProducts()),
  list: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const canViewFinancials = await viewerFinancialAccess(ctx.user);
    const productList = await listProducts();
    return productList.map(product => presentProductForViewer(product, canViewFinancials));
  }),
  byId: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const item = await getProductWithVariants(input.productId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
    const canViewFinancials = await viewerFinancialAccess(ctx.user);
    return { product: presentProductForViewer(item.product, canViewFinancials), variants: item.variants };
  }),
  create: protectedProcedure.input(z.object({
    productCode: z.string().trim().min(2).max(80),
    name: z.string().trim().min(2).max(220),
    category: z.string().trim().max(120).optional(),
    description: z.string().trim().max(4000).optional(),
    status: productStatus.default("draft"),
    sellingPrice: moneyString,
    costPrice: moneyString.optional(),
    targetMarginPercent: moneyString.optional(),
    variants: z.array(z.object({
      colorName: z.string().trim().min(1).max(100),
      sizeLabel: z.string().trim().max(80).optional(),
      inventoryQuantity: z.number().int().min(0).max(100000),
    })).min(1).max(250),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const canViewFinancials = await viewerFinancialAccess(ctx.user);
    if (!canViewFinancials && (input.costPrice || input.targetMarginPercent)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك إدخال تكلفة أو هامش الربح." });
    }
    const productId = await createProduct({ ...input, createdByUserId: ctx.user.id });
    return { productId };
  }),
  updateInventory: protectedProcedure.input(z.object({ variantId: z.number().int().positive(), inventoryQuantity: z.number().int().min(0).max(100000) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    await updateVariantInventory(input.variantId, input.inventoryQuantity);
    return { success: true };
  }),
  importJobs: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertPermission(ctx.user, "products.create");
      return listImportJobs();
    }),
    createManualFallback: protectedProcedure.input(z.object({ sourceReference: z.string().trim().max(512).optional() })).mutation(async ({ ctx, input }) => {
      await assertPermission(ctx.user, "products.create");
      const jobId = await createImportJob({ source: "manual", sourceReference: input.sourceReference, createdByUserId: ctx.user.id });
      return { jobId };
    }),
  }),
});
