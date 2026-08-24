import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { getEmployeePermissionCodesForUser } from "../access/db";
import { canViewSensitiveFinancialData } from "../access/permissions";
import { addManualProductImage, addProductColor, applyAutomaticColorSuggestionReview, assignProductMediaColor, createImportJob, createProduct, deleteProductColor, detachProductMediaReference, excludeProductMediaFromColorReview, generateAutomaticColorSuggestion, getProductMedia, getProductWithVariants, listImportJobs, listProductsWithPrimaryOperationalMedia, listPublicProducts, permanentlyDeleteProduct, recordAutomaticColorSuggestionDecision, renameProductColor, saveProductColorInventory, saveProductInventory, updateProductDetails, updateVariantInventory } from "../products/db";
import { presentProductForViewer } from "../products/financialVisibility";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { listCatalogChildren, readCatalogImageDataUrl } from "../integrations/onedrive/catalog";
import { storageGet } from "../storage";
import { generateOperationalMediaForProduct, regenerateOperationalMediaForProduct } from "../products/operationalMediaService";
import { analyzeStoredProductColors } from "../products/colorAnalysis";

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
    return Promise.all(productList.map(async ({ product, primaryMedia, missingFields }) => ({
      ...presentProductForViewer(product, canViewFinancials),
      primaryImageUrl: primaryMedia?.storageKey ? (await storageGet(primaryMedia.storageKey)).url : null,
      primaryImageAlt: primaryMedia ? `صورة ${product.name}` : null,
      missingFields,
    })));
  }),
  byId: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const item = await getProductWithVariants(input.productId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
    const canViewFinancials = await viewerFinancialAccess(ctx.user);
    const media = await getProductMedia(input.productId);
    return { product: presentProductForViewer(item.product, canViewFinancials), variants: item.variants, media, missingFields: item.missingFields, pendingColorSuggestion: item.pendingColorSuggestion };
  }),
  mediaPreviews: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const item = await getProductWithVariants(input.productId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
    const media = await getProductMedia(input.productId);
    const oneDriveMedia = media.filter(entry => entry.source === "onedrive" && entry.originalFileName);
    const variantById = new Map(item.variants.map(variant => [variant.id, variant]));
    const storedPreviews = await Promise.all(media
      .filter(entry => Boolean(entry.storageKey))
      .map(async entry => ({
        mediaId: entry.id,
        mediaType: entry.mediaType,
        playbackReady: true,
        colorName: variantById.get(entry.variantId ?? -1)?.colorName ?? "",
        colorReviewState: entry.variantId ? "assigned" as const : entry.colorVerified ? "excluded" as const : "unconfirmed" as const,
        inventoryQuantity: variantById.get(entry.variantId ?? -1)?.inventoryQuantity ?? 0,
        originalFileName: entry.originalFileName ?? "صورة المنتج",
        dataUrl: (await storageGet(entry.storageKey!)).url,
        rendition: "operational_webp" as const,
      })));
    const missingOperationalCopy = oneDriveMedia.filter(entry => entry.mediaType === "image" && !entry.storageKey);
    const unavailableVideos = media.filter(entry => entry.mediaType === "video" && !entry.storageKey).map(entry => ({
      mediaId: entry.id,
      mediaType: "video" as const,
      playbackReady: true,
      colorName: "",
      colorReviewState: "excluded" as const,
      inventoryQuantity: 0,
      originalFileName: entry.originalFileName ?? "فيديو المنتج",
      dataUrl: `/api/products/${input.productId}/media/${entry.id}/video`,
      rendition: "catalog_video_stream_proxy" as const,
    }));
    if (missingOperationalCopy.length === 0) return [...storedPreviews, ...unavailableVideos];
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
        mediaType: "image" as const,
        playbackReady: true,
        colorName: variantById.get(entry.variantId ?? -1)?.colorName ?? "",
        colorReviewState: entry.variantId ? "assigned" as const : entry.colorVerified ? "excluded" as const : "unconfirmed" as const,
        inventoryQuantity: variantById.get(entry.variantId ?? -1)?.inventoryQuantity ?? 0,
        originalFileName: entry.originalFileName!,
        dataUrl: await readCatalogImageDataUrl({ encryptedAccessToken: connection.encryptedAccessToken, driveId, fileId: sourceFileId }),
        rendition: "onedrive_thumbnail_c300x400" as const,
      };
    }));
    return [...storedPreviews, ...unavailableVideos, ...temporaryPreviews];
  }),
  generateOperationalMedia: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    return generateOperationalMediaForProduct({ userId: ctx.user.id, productId: input.productId });
  }),
  regenerateOperationalMedia: protectedProcedure.input(z.object({ productId: z.number().int().positive(), mediaId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return regenerateOperationalMediaForProduct({ userId: ctx.user.id, productId: input.productId, mediaId: input.mediaId });
  }),
  detachMediaReference: protectedProcedure.input(z.object({ productId: z.number().int().positive(), mediaId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return detachProductMediaReference({ ...input, createdByUserId: ctx.user.id });
  }),
  deletePermanently: protectedProcedure.input(z.object({ productId: z.number().int().positive(), confirmProductCode: z.string().trim().min(2).max(80) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.delete");
    return permanentlyDeleteProduct({ productId: input.productId, expectedProductCode: input.confirmProductCode, createdByUserId: ctx.user.id });
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
    await updateVariantInventory({ ...input, actorUserId: ctx.user.id, source: "products_ui" });
    return { success: true };
  }),
  updateDetails: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    name: z.string().trim().min(2).max(220).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    sellingPrice: moneyString.optional(),
    sizeLabels: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    status: z.enum(["draft", "needs_review", "ready", "archived"]).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const { productId, ...patch } = input;
    return updateProductDetails({ productId, ...patch, actorUserId: ctx.user.id, source: "products_ui" });
  }),
  addColor: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    colorName: z.string().trim().min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return addProductColor({ ...input, actorUserId: ctx.user.id, source: "products_ui" });
  }),
  assignMediaColor: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    mediaId: z.number().int().positive(),
    colorName: z.string().trim().min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return assignProductMediaColor({ ...input, actorUserId: ctx.user.id });
  }),
  renameColor: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    previousColorName: z.string().trim().min(1).max(100),
    colorName: z.string().trim().min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return renameProductColor({ ...input, actorUserId: ctx.user.id });
  }),
  deleteColor: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    colorName: z.string().trim().min(1).max(100),
    confirmColorName: z.string().trim().min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.delete");
    if (input.colorName !== input.confirmColorName) throw new TRPCError({ code: "BAD_REQUEST", message: "اسم تأكيد الحذف لا يطابق اسم اللون." });
    return deleteProductColor({ productId: input.productId, colorName: input.colorName, actorUserId: ctx.user.id });
  }),
  excludeMediaFromColorReview: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    mediaIds: z.array(z.number().int().positive()).min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return excludeProductMediaFromColorReview({ ...input, actorUserId: ctx.user.id });
  }),
  analyzeColors: protectedProcedure.input(z.object({ productId: z.number().int().positive(), mediaIds: z.array(z.number().int().positive()).min(1).max(160).optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const product = await getProductWithVariants(input.productId);
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
    const allMedia = await getProductMedia(input.productId);
    const media = input.mediaIds ? allMedia.filter(entry => input.mediaIds!.includes(entry.id)) : allMedia;
    if (input.mediaIds && media.length !== input.mediaIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "تتضمن الصور المختارة صورة لا تنتمي إلى هذا المنتج." });
    try {
      return await analyzeStoredProductColors({ productCode: product.product.productCode, media });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر تحليل ألوان الصور." });
    }
  }),
  generateAutomaticColorSuggestion: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const generated = await generateAutomaticColorSuggestion({ productId: input.productId, actorUserId: ctx.user.id });
    if (!generated) throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد صور جديدة أو غير مسندة تحتاج إلى تحليل." });
    return generated;
  }),
  reviewAutomaticColorSuggestion: protectedProcedure.input(z.object({ productId: z.number().int().positive(), suggestionOperationId: z.number().int().positive(), decision: z.enum(["accepted", "rejected"]) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return recordAutomaticColorSuggestionDecision({ ...input, actorUserId: ctx.user.id });
  }),
  applyAutomaticColorSuggestion: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    suggestionOperationId: z.number().int().positive(),
    groups: z.array(z.object({ colorName: z.string().trim().min(1).max(100), mediaIds: z.array(z.number().int().positive()).min(1).max(160) })).min(1).max(80),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return applyAutomaticColorSuggestionReview({ ...input, actorUserId: ctx.user.id });
  }),
  saveInventory: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    quantities: z.array(z.object({ variantId: z.number().int().positive(), inventoryQuantity: z.number().int().min(0).max(100000) })).min(1).max(250),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    return saveProductInventory({ ...input, actorUserId: ctx.user.id, source: "products_ui" });
  }),
  saveColorInventory: protectedProcedure.input(z.object({ productId: z.number().int().positive(), colorName: z.string().trim().min(1).max(100), inventoryQuantity: z.number().int().min(0).max(100000) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    return saveProductColorInventory({ ...input, actorUserId: ctx.user.id });
  }),
  uploadManualImage: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/),
    base64Data: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const bytes = Buffer.from(input.base64Data, "base64");
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الصورة يجب أن يكون بين 1 بايت و25 ميغابايت." });
    return addManualProductImage({ productId: input.productId, fileName: input.fileName, bytes, actorUserId: ctx.user.id });
  }),
  detachMedia: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    mediaId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    return detachProductMediaReference({ productId: input.productId, mediaId: input.mediaId, createdByUserId: ctx.user.id });
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
