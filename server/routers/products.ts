import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { assertPermission } from "../access/authorization";
import { getEmployeePermissionCodesForUser } from "../access/db";
import { canViewSensitiveFinancialData } from "../access/permissions";
import { activateReadyProduct, archiveProduct, addManualProductImage, addProductColor, applyAutomaticColorSuggestionReview, assignProductMediaColor, createImportJob, createProduct, deleteProductColor, detachProductMediaReference, excludeProductMediaFromColorReview, generateAutomaticColorSuggestion, getCatalogProductFolderId, getProductForVariantInStore, getProductMedia, getProductWithVariants, getPublicStoreProduct, listImportJobs, listProductOperations, listProductsWithPrimaryOperationalMedia, listPublicProducts, permanentlyDeleteProduct, recordAutomaticColorSuggestionDecision, refreshProductReviewStatus, renameProductColor, restoreArchivedProduct, restoreProductMediaToColorReview, saveProductColorInventory, saveProductInventory, setPrimaryProductMedia, updateProductDetails, updateVariantInventory } from "../products/db";
import { presentProductForViewer } from "../products/financialVisibility";
import { recordInitialProductFinancialValues } from "../financials/db";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { listCatalogChildren, readCatalogImageDataUrl } from "../integrations/onedrive/catalog";
import { storageGet } from "../storage";
import { generateOperationalMediaForProduct, regenerateOperationalMediaForProduct } from "../products/operationalMediaService";
import { analyzeStoredProductColors } from "../products/colorAnalysis";
import { getPublicStore } from "../stores/db";
import { assignProductCategory, createManualProductCategory, listProductCategoryTree, renameProductCategory, reorderProductCategories } from "../products/categories";
import { enqueueMetaCatalogAutoSync, restoreInternalMetaCatalogAutoSync } from "../integrations/meta/catalogAutoSync";

const moneyString = z.string().regex(/^\d+(\.\d{1,2})?$/, "يجب إدخال رقم مالي صالح.");
const productStatus = z.enum(["draft", "needs_review", "ready", "active", "archived"]);

function requireOperationalStoreId(storeId: number | null | undefined) {
  if (!storeId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لا يوجد متجر تشغيلي نشط لحسابك." });
  return storeId;
}

async function viewerFinancialAccess(user: { id: number; role: "admin" | "user" }) {
  const grantedPermissionCodes = await getEmployeePermissionCodesForUser(user.id);
  return canViewSensitiveFinancialData({ isPlatformAdmin: user.role === "admin", grantedPermissionCodes });
}

async function requireProductInOperationalStore(ctx: { operationalStore: { id: number } | null | undefined }, productId: number) {
  const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
  const product = await getProductWithVariants(productId, storeId);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود في متجرك التشغيلي." });
  return { storeId, product };
}

async function queueProductMetaSync(
  ctx: { user: { id: number }; req: { headers: { cookie?: string } }; operationalStore: { id: number } | null | undefined },
  productId: number,
  options?: { changeType?: "price" | "inventory" | "image" | "details" | "internal" | "system"; isInternalOnly?: boolean },
) {
  return enqueueMetaCatalogAutoSync({
    storeId: requireOperationalStoreId(ctx.operationalStore?.id),
    productIds: [productId],
    changeType: options?.changeType,
    isInternalOnly: options?.isInternalOnly,
    requestedByUserId: ctx.user.id,
    sessionToken: parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "",
  });
}

export const productsRouter = router({
  publicList: publicProcedure.query(async () => {
    const store = await getPublicStore();
    if (!store) return [];
    const activeProducts = await listPublicProducts(store.id);
    return Promise.all(activeProducts.map(async product => {
      const publicProduct = await getPublicStoreProduct({ storeId: store.id, productCode: product.productCode });
      const primaryImage = publicProduct?.media.find(media => media.mediaType === "image" && Boolean(media.storageKey));
      const featuredVideo = publicProduct?.media.find(media => media.mediaType === "video");
      return {
        ...product,
        primaryImageUrl: primaryImage?.storageKey ? (await storageGet(primaryImage.storageKey)).url : null,
        featuredVideoUrl: featuredVideo ? (featuredVideo.storageKey ? (await storageGet(featuredVideo.storageKey)).url : `/api/products/${publicProduct?.product.id}/media/${featuredVideo.id}/video`) : null,
      };
    }));
  }),
  publicByCode: publicProcedure.input(z.object({ productCode: z.string().trim().min(1).max(80) })).query(async ({ input }) => {
    const store = await getPublicStore();
    if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "المتجر غير متاح حاليًا." });
    const item = await getPublicStoreProduct({ storeId: store.id, productCode: input.productCode });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير متاح حاليًا." });
    const variantById = new Map(item.variants.map(variant => [variant.id, variant]));
    const media = await Promise.all(item.media.map(async entry => ({
      mediaId: entry.id,
      mediaType: entry.mediaType,
      colorName: variantById.get(entry.variantId ?? -1)?.colorName ?? null,
      originalFileName: entry.originalFileName ?? "وسيط المنتج",
      url: entry.storageKey ? (await storageGet(entry.storageKey)).url : entry.mediaType === "video" ? `/api/products/${item.product.id}/media/${entry.id}/video` : null,
    })));
    return {
      product: { productCode: item.product.productCode, name: item.product.name, category: item.product.category, description: item.product.description, sellingPrice: item.product.sellingPrice, previousPrice: item.product.previousPrice && Number(item.product.previousPrice) > Number(item.product.sellingPrice) ? item.product.previousPrice : null, sizeLabels: item.product.sizeLabels },
      colors: Array.from(new Set(item.variants.map(variant => variant.colorName))),
      media: media.filter(entry => Boolean(entry.url)),
    };
  }),
  list: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const canViewFinancials = await viewerFinancialAccess(ctx.user);
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const [productList, categoryTree] = await Promise.all([listProductsWithPrimaryOperationalMedia(storeId), listProductCategoryTree(storeId)]);
    const categoryPathById = new Map(categoryTree.map(category => [category.id, category.displayPath]));
    return Promise.all(productList.map(async ({ product, primaryMedia, missingFields, variants }) => ({
      ...presentProductForViewer({ ...product, category: product.categoryId ? categoryPathById.get(product.categoryId) ?? product.category : product.category }, canViewFinancials),
      updatedAt: product.updatedAt,
      lastMetaCatalogChangeAt: product.lastMetaCatalogChangeAt,
      lastMetaCatalogChangeType: product.lastMetaCatalogChangeType,
      lastMetaCatalogChangeInternal: product.lastMetaCatalogChangeInternal,
      metaCatalogSyncIgnoredAt: product.metaCatalogSyncIgnoredAt,
      primaryImageUrl: primaryMedia?.storageKey ? (await storageGet(primaryMedia.storageKey)).url : null,
      primaryImageAlt: primaryMedia ? `صورة ${product.name}` : null,
      missingFields,
      variants,
    })));
  }),
  categories: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertPermission(ctx.user, "products.inventory.update");
      return listProductCategoryTree(requireOperationalStoreId(ctx.operationalStore?.id));
    }),
    create: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(180), parentId: z.number().int().positive().nullable().optional() })).mutation(async ({ ctx, input }) => {
      await assertPermission(ctx.user, "products.create");
      return createManualProductCategory({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), name: input.name, parentId: input.parentId ?? null });
    }),
    rename: protectedProcedure.input(z.object({ categoryId: z.number().int().positive(), name: z.string().trim().min(1).max(180) })).mutation(async ({ ctx, input }) => {
      await assertPermission(ctx.user, "products.edit");
      return renameProductCategory({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), ...input });
    }),
    reorder: protectedProcedure.input(z.object({ categoryIds: z.array(z.number().int().positive()).min(1).max(250) })).mutation(async ({ ctx, input }) => {
      await assertPermission(ctx.user, "products.edit");
      return reorderProductCategories({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), categoryIds: input.categoryIds });
    }),
    assign: protectedProcedure.input(z.object({ productId: z.number().int().positive(), categoryId: z.number().int().positive().nullable() })).mutation(async ({ ctx, input }) => {
      await assertPermission(ctx.user, "products.edit");
      return assignProductCategory({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), actorUserId: ctx.user.id, ...input });
    }),
  }),
  byId: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const { product: item } = await requireProductInOperationalStore(ctx, input.productId);
    await refreshProductReviewStatus({ productId: input.productId, actorUserId: ctx.user.id });
    const canViewFinancials = await viewerFinancialAccess(ctx.user);
    const media = await getProductMedia(input.productId);
    const categoryTree = await listProductCategoryTree(item.product.storeId);
    const selectedCategory = item.product.categoryId ? categoryTree.find(category => category.id === item.product.categoryId) : null;
    return {
      product: presentProductForViewer({ ...item.product, category: selectedCategory?.displayPath ?? item.product.category }, canViewFinancials),
      variants: item.variants,
      media,
      missingFields: item.missingFields,
      pendingColorSuggestion: item.pendingColorSuggestion,
      reviewReadiness: item.reviewReadiness,
      publishEligibility: {
        eligible: item.reviewReadiness.ready,
        message: item.product.status === "active" ? "المنتج نشط في الكتالوج." : item.reviewReadiness.ready ? "المنتج مكتمل وجاهز لاعتماد النشر." : "المنتج غير قابل للنشر قبل إكمال عناصر الجهوزية الظاهرة أدناه.",
      },
    };
  }),
  operations: protectedProcedure.input(z.object({ productId: z.number().int().positive(), limit: z.number().int().min(1).max(100).optional() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    await requireProductInOperationalStore(ctx, input.productId);
    return listProductOperations({ storeId, productId: input.productId, limit: input.limit, includeSensitive: await viewerFinancialAccess(ctx.user) });
  }),
  mediaPreviews: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const { product: item } = await requireProductInOperationalStore(ctx, input.productId);
    const media = await getProductMedia(input.productId);
    const oneDriveMedia = media.filter(entry => entry.source === "onedrive" && entry.originalFileName);
    const variantById = new Map(item.variants.map(variant => [variant.id, variant]));
    const primaryImageId = media.find(entry => entry.mediaType === "image")?.id ?? null;
    const storedPreviews = await Promise.all(media
      .filter(entry => Boolean(entry.storageKey))
      .map(async entry => ({
        mediaId: entry.id,
        mediaType: entry.mediaType,
        isPrimary: entry.id === primaryImageId,
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
    const connection = await getUsableCatalogConnection(item.product.storeId);
    if (!connection?.selectedDriveId || !connection.selectedFolderId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "مرجع Catalog غير متاح لمعاينة الصور." });
    const driveId = connection.selectedDriveId;
    const productFolderId = await getCatalogProductFolderId({ productId: item.product.id, storeId: item.product.storeId });
    if (!productFolderId) throw new TRPCError({ code: "NOT_FOUND", message: "لم يوجد مرجع مجلد OneDrive لهذا المنتج." });
    const sourceFiles = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId, folderId: productFolderId });
    const byName = new Map(sourceFiles.map(file => [file.name, file]));
    const temporaryPreviews = await Promise.all(missingOperationalCopy.slice(0, 12).map(async entry => {
      const sourceFile = byName.get(entry.originalFileName!);
      const sourceFileId = sourceFile?.id;
      if (!sourceFile || sourceFile.kind !== "file" || !sourceFileId) throw new TRPCError({ code: "NOT_FOUND", message: `لم توجد الصورة ${entry.originalFileName} في Catalog.` });
      return {
        mediaId: entry.id,
        mediaType: "image" as const,
        isPrimary: entry.id === primaryImageId,
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
  setPrimaryMedia: protectedProcedure.input(z.object({ productId: z.number().int().positive(), mediaId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await setPrimaryProductMedia({ ...input, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId, { changeType: "image", isInternalOnly: false });
    return result;
  }),
  generateOperationalMedia: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    await requireProductInOperationalStore(ctx, input.productId);
    return generateOperationalMediaForProduct({ userId: ctx.user.id, productId: input.productId });
  }),
  regenerateOperationalMedia: protectedProcedure.input(z.object({ productId: z.number().int().positive(), mediaId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    return regenerateOperationalMediaForProduct({ userId: ctx.user.id, productId: input.productId, mediaId: input.mediaId });
  }),
  detachMediaReference: protectedProcedure.input(z.object({ productId: z.number().int().positive(), mediaId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    return detachProductMediaReference({ ...input, createdByUserId: ctx.user.id });
  }),
  deletePermanently: protectedProcedure.input(z.object({ productId: z.number().int().positive(), confirmProductCode: z.string().trim().min(2).max(80) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.delete");
    await requireProductInOperationalStore(ctx, input.productId);
    return permanentlyDeleteProduct({ productId: input.productId, expectedProductCode: input.confirmProductCode, createdByUserId: ctx.user.id });
  }),
  create: protectedProcedure.input(z.object({
    productCode: z.string().trim().min(2).max(80),
    name: z.string().trim().min(2).max(220),
    category: z.string().trim().max(120).optional(),
    categoryId: z.number().int().positive().optional(),
    description: z.string().trim().max(4000).optional(),
    status: productStatus.default("draft"),
    sellingPrice: moneyString,
    previousPrice: moneyString.optional(),
    costPrice: moneyString.optional(),
    targetMarginPercent: moneyString.optional(),
    variants: z.array(z.object({
      colorName: z.string().trim().min(1).max(100),
      sizeLabel: z.string().trim().max(80).optional(),
      inventoryQuantity: z.number().int().min(0).max(100000),
    })).min(1).max(250),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const hasFinancialValues = input.costPrice !== undefined || input.targetMarginPercent !== undefined;
    if (hasFinancialValues) {
      await assertPermission(ctx.user, "finance.manage_sensitive", storeId);
    }
    if (!await viewerFinancialAccess(ctx.user) && hasFinancialValues) {
      throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك إدخال تكلفة أو هامش الربح." });
    }
    if (input.previousPrice !== undefined && Number(input.previousPrice) <= Number(input.sellingPrice)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "السعر السابق يجب أن يكون أعلى من السعر الحالي لعرض خصم حقيقي." });
    }
    const { categoryId, ...productInput } = input;
    const productId = await createProduct({ ...productInput, storeId, createdByUserId: ctx.user.id });
    if (categoryId) await assignProductCategory({ storeId, productId, categoryId, actorUserId: ctx.user.id });
    await recordInitialProductFinancialValues({ ...input, storeId, productId, actorUserId: ctx.user.id });
    if (input.status === "active") await queueProductMetaSync(ctx, productId);
    return { productId };
  }),
  updateInventory: protectedProcedure.input(z.object({ variantId: z.number().int().positive(), inventoryQuantity: z.number().int().min(0).max(100000) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    if (!await getProductForVariantInStore(input.variantId, storeId)) throw new TRPCError({ code: "NOT_FOUND", message: "متغير المنتج غير موجود في متجرك التشغيلي." });
    await updateVariantInventory({ ...input, actorUserId: ctx.user.id, source: "products_ui" });
    const product = await getProductForVariantInStore(input.variantId, storeId);
    if (product) await queueProductMetaSync(ctx, product.id, { changeType: "inventory", isInternalOnly: false });
    return { success: true };
  }),
  updateDetails: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    name: z.string().trim().min(2).max(220).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    sellingPrice: moneyString.optional(),
    previousPrice: moneyString.nullable().optional(),
    sizeLabels: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    status: z.enum(["draft", "needs_review", "ready", "archived"]).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const { product: currentProduct } = await requireProductInOperationalStore(ctx, input.productId);
    if (input.previousPrice !== undefined && input.previousPrice !== null && Number(input.previousPrice) <= Number(input.sellingPrice ?? currentProduct.product.sellingPrice)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "السعر السابق يجب أن يكون أعلى من السعر الحالي لعرض خصم حقيقي." });
    }
    const { productId, categoryId, ...patch } = input;
    const updated = await updateProductDetails({ productId, ...patch, actorUserId: ctx.user.id, source: "products_ui" });
    const categoryAssignment = categoryId !== undefined ? await assignProductCategory({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), productId, categoryId, actorUserId: ctx.user.id }) : null;
    const hasPrice = patch.sellingPrice !== undefined || patch.previousPrice !== undefined;
    const hasCatalogFields = patch.name !== undefined || patch.description !== undefined || patch.sizeLabels !== undefined || categoryId !== undefined;
    const isInternalOnly = !hasPrice && !hasCatalogFields;
    const changeType = hasPrice ? "price" as const : isInternalOnly ? "internal" as const : "details" as const;
    await queueProductMetaSync(ctx, productId, { changeType, isInternalOnly });
    return { ...updated, categoryAssignment };
  }),
  activate: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await activateReadyProduct({ productId: input.productId, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId);
    return result;
  }),
  activateMany: protectedProcedure.input(z.object({ productIds: z.array(z.number().int().positive()).min(1).max(100) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const productIds = Array.from(new Set(input.productIds));
    const results = await Promise.allSettled(productIds.map(async productId => {
      await requireProductInOperationalStore(ctx, productId);
      const result = await activateReadyProduct({ productId, actorUserId: ctx.user.id });
      await queueProductMetaSync(ctx, productId);
      return { productId, result };
    }));
    const activatedProductIds = results.flatMap(result => result.status === "fulfilled" ? [result.value.productId] : []);
    const skipped = results.flatMap((result, index) => result.status === "rejected" ? [{ productId: productIds[index], reason: result.reason instanceof Error ? result.reason.message : "تعذر اعتماد المنتج." }] : []);
    return { activatedProductIds, skipped };
  }),
  archive: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    return archiveProduct({ productId: input.productId, actorUserId: ctx.user.id });
  }),
  restoreFromArchive: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    return restoreArchivedProduct({ productId: input.productId, actorUserId: ctx.user.id });
  }),
  addColor: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    colorName: z.string().trim().min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await addProductColor({ ...input, actorUserId: ctx.user.id, source: "products_ui" });
    if (result.created) await queueProductMetaSync(ctx, input.productId);
    return result;
  }),
  assignMediaColor: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    mediaId: z.number().int().positive(),
    colorName: z.string().trim().min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await assignProductMediaColor({ ...input, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId);
    return result;
  }),
  renameColor: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    previousColorName: z.string().trim().min(1).max(100),
    colorName: z.string().trim().min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await renameProductColor({ ...input, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId);
    return result;
  }),
  deleteColor: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    colorName: z.string().trim().min(1).max(100),
    confirmColorName: z.string().trim().min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.delete");
    await requireProductInOperationalStore(ctx, input.productId);
    if (input.colorName !== input.confirmColorName) throw new TRPCError({ code: "BAD_REQUEST", message: "اسم تأكيد الحذف لا يطابق اسم اللون." });
    const result = await deleteProductColor({ productId: input.productId, colorName: input.colorName, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId);
    return result;
  }),
  excludeMediaFromColorReview: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    mediaIds: z.array(z.number().int().positive()).min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await excludeProductMediaFromColorReview({ ...input, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId);
    return result;
  }),
  restoreMediaToColorReview: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    mediaIds: z.array(z.number().int().positive()).min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await restoreProductMediaToColorReview({ ...input, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId);
    return result;
  }),
  analyzeColors: protectedProcedure.input(z.object({ productId: z.number().int().positive(), mediaIds: z.array(z.number().int().positive()).min(1).max(160).optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const { product } = await requireProductInOperationalStore(ctx, input.productId);
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
    await requireProductInOperationalStore(ctx, input.productId);
    const generated = await generateAutomaticColorSuggestion({ productId: input.productId, actorUserId: ctx.user.id });
    if (!generated) throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد صور جديدة أو غير مسندة تحتاج إلى تحليل." });
    return generated;
  }),
  reviewAutomaticColorSuggestion: protectedProcedure.input(z.object({ productId: z.number().int().positive(), suggestionOperationId: z.number().int().positive(), decision: z.enum(["accepted", "rejected"]) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    return recordAutomaticColorSuggestionDecision({ ...input, actorUserId: ctx.user.id });
  }),
  applyAutomaticColorSuggestion: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    suggestionOperationId: z.number().int().positive(),
    groups: z.array(z.object({ colorName: z.string().trim().min(1).max(100), mediaIds: z.array(z.number().int().positive()).min(1).max(160) })).min(1).max(80),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await applyAutomaticColorSuggestionReview({ ...input, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId);
    return result;
  }),
  saveInventory: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    quantities: z.array(z.object({ variantId: z.number().int().positive(), inventoryQuantity: z.number().int().min(0).max(100000) })).min(1).max(250),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await saveProductInventory({ ...input, actorUserId: ctx.user.id, source: "products_ui" });
    await queueProductMetaSync(ctx, input.productId, { changeType: "inventory", isInternalOnly: false });
    return result;
  }),
  saveColorInventory: protectedProcedure.input(z.object({ productId: z.number().int().positive(), colorName: z.string().trim().min(1).max(100), inventoryQuantity: z.number().int().min(0).max(100000) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.inventory.update");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await saveProductColorInventory({ ...input, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId, { changeType: "inventory", isInternalOnly: false });
    return result;
  }),
  uploadManualImage: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/),
    base64Data: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const bytes = Buffer.from(input.base64Data, "base64");
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الصورة يجب أن يكون بين 1 بايت و25 ميغابايت." });
    const uploaded = await addManualProductImage({ productId: input.productId, fileName: input.fileName, bytes, actorUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId, { changeType: "image", isInternalOnly: false });
    let colorAnalysis: Awaited<ReturnType<typeof generateAutomaticColorSuggestion>> = null;
    let colorAnalysisError: string | null = null;
    try {
      colorAnalysis = await generateAutomaticColorSuggestion({ productId: input.productId, actorUserId: ctx.user.id, source: "products_ui", mediaIds: [uploaded.mediaId] });
    } catch (error) {
      colorAnalysisError = error instanceof Error ? error.message : "تعذر إنشاء اقتراح ألوان للصورة المضافة.";
    }
    return {
      ...uploaded,
      colorAnalysis: colorAnalysis
        ? { status: "suggestion_ready" as const, operationId: colorAnalysis.operationId }
        : colorAnalysisError
          ? { status: "analysis_failed" as const, message: colorAnalysisError }
          : { status: "review_pending" as const },
    };
  }),
  detachMedia: protectedProcedure.input(z.object({
    productId: z.number().int().positive(),
    mediaId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    await requireProductInOperationalStore(ctx, input.productId);
    const result = await detachProductMediaReference({ productId: input.productId, mediaId: input.mediaId, createdByUserId: ctx.user.id });
    await queueProductMetaSync(ctx, input.productId, { changeType: "image", isInternalOnly: false });
    return result;
  }),
  dismissInternalMetaSync: protectedProcedure.input(z.object({ productId: z.number().int().positive(), reason: z.string().trim().max(200).optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const { storeId } = await requireProductInOperationalStore(ctx, input.productId);
    const { dismissInternalMetaCatalogAutoSync } = await import("../integrations/meta/catalogAutoSync");
    return dismissInternalMetaCatalogAutoSync({ storeId, productId: input.productId, userId: ctx.user.id, reason: input.reason });
  }),
  restoreInternalMetaSync: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const { storeId } = await requireProductInOperationalStore(ctx, input.productId);
    return restoreInternalMetaCatalogAutoSync({ storeId, productId: input.productId, userId: ctx.user.id, sessionToken: parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "" });
  }),
  importJobs: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await assertPermission(ctx.user, "products.create");
      return listImportJobs(requireOperationalStoreId(ctx.operationalStore?.id));
    }),
    createManualFallback: protectedProcedure.input(z.object({ sourceReference: z.string().trim().max(512).optional() })).mutation(async ({ ctx, input }) => {
      await assertPermission(ctx.user, "products.create");
      const jobId = await createImportJob({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), source: "manual", sourceReference: input.sourceReference, createdByUserId: ctx.user.id });
      return { jobId };
    }),
  }),
});
