import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { getEmployeePermissionCodesForUser } from "../access/db";
import { canViewSensitiveFinancialData } from "../access/permissions";
import { createImportJob, createProduct, getProductMedia, getProductWithVariants, listImportJobs, listProductsWithPrimaryOperationalMedia, listPublicProducts, updateVariantInventory } from "../products/db";
import { presentProductForViewer } from "../products/financialVisibility";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { listCatalogChildren, readCatalogImageDataUrl } from "../integrations/onedrive/catalog";
import { storageGet } from "../storage";
import { generateOperationalMediaForProduct } from "../products/operationalMediaService";

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
    const productList = await listProductsWithPrimaryOperationalMedia();
    return Promise.all(productList.map(async ({ product, primaryMedia }) => ({
      ...presentProductForViewer(product, canViewFinancials),
      primaryImageUrl: primaryMedia?.storageKey ? (await storageGet(primaryMedia.storageKey)).url : null,
      primaryImageAlt: primaryMedia ? `صورة ${product.name}` : null,
    })));
  }),
  byId: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const item = await getProductWithVariants(input.productId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
    const canViewFinancials = await viewerFinancialAccess(ctx.user);
    const media = await getProductMedia(input.productId);
    return { product: presentProductForViewer(item.product, canViewFinancials), variants: item.variants, media };
  }),
  mediaPreviews: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const item = await getProductWithVariants(input.productId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
    const media = await getProductMedia(input.productId);
    const oneDriveMedia = media.filter(entry => entry.source === "onedrive" && entry.originalFileName);
    if (oneDriveMedia.length === 0) return [];
    const variantById = new Map(item.variants.map(variant => [variant.id, variant]));
    const storedPreviews = await Promise.all(oneDriveMedia
      .filter(entry => Boolean(entry.storageKey))
      .map(async entry => ({
        mediaId: entry.id,
        colorName: variantById.get(entry.variantId ?? -1)?.colorName ?? "",
        inventoryQuantity: variantById.get(entry.variantId ?? -1)?.inventoryQuantity ?? 0,
        originalFileName: entry.originalFileName!,
        dataUrl: (await storageGet(entry.storageKey!)).url,
        rendition: "operational_webp" as const,
      })));
    const missingOperationalCopy = oneDriveMedia.filter(entry => !entry.storageKey);
    if (missingOperationalCopy.length === 0) return storedPreviews;
    const connection = await getUsableCatalogConnection(ctx.user.id);
    if (!connection?.selectedDriveId || !connection.selectedFolderId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "مرجع Catalog غير متاح لمعاينة الصور." });
    const driveId = connection.selectedDriveId;
    const groups = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId, folderId: connection.selectedFolderId });
    const group = groups.find(entry => entry.kind === "folder" && entry.name === item.product.category);
    if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "لم توجد مجموعة المنتج في Catalog." });
    const folders = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId, folderId: group.id });
    const productFolder = folders.find(entry => entry.kind === "folder" && entry.name === item.product.productCode);
    if (!productFolder) throw new TRPCError({ code: "NOT_FOUND", message: "لم يوجد مجلد المنتج في Catalog." });
    const sourceFiles = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId, folderId: productFolder.id });
    const byName = new Map(sourceFiles.map(file => [file.name, file]));
    const temporaryPreviews = await Promise.all(missingOperationalCopy.slice(0, 12).map(async entry => {
      const sourceFile = byName.get(entry.originalFileName!);
      const sourceFileId = sourceFile?.id;
      if (!sourceFile || sourceFile.kind !== "file" || !sourceFileId) throw new TRPCError({ code: "NOT_FOUND", message: `لم توجد الصورة ${entry.originalFileName} في Catalog.` });
      return {
        mediaId: entry.id,
        colorName: variantById.get(entry.variantId ?? -1)?.colorName ?? "",
        inventoryQuantity: variantById.get(entry.variantId ?? -1)?.inventoryQuantity ?? 0,
        originalFileName: entry.originalFileName!,
        dataUrl: await readCatalogImageDataUrl({ encryptedAccessToken: connection.encryptedAccessToken, driveId, fileId: sourceFileId }),
        rendition: "onedrive_thumbnail_c300x400" as const,
      };
    }));
    return [...storedPreviews, ...temporaryPreviews];
  }),
  generateOperationalMedia: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    return generateOperationalMediaForProduct({ userId: ctx.user.id, productId: input.productId });
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
