import { and, desc, eq, inArray } from "drizzle-orm";
import { catalogFolderImports, metaAssets, metaCatalogExportJobs, metaCatalogSourceUpdates, metaConnectionCapabilities, metaConnections, productMedia, productVariants, products, stores } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getMetaCatalogAccessToken } from "./db";
import { buildCatalogExportIdempotencyKey, buildMetaCatalogProductItems, chunkMetaCatalogBatchRequests, submitMetaCatalogBatch, toMetaCatalogBatchRequests, type MetaCatalogProductItem } from "./catalogExport";
import { getMetaRuntimeSettings } from "./platformSettings";
import { getMetaCatalogEnrichmentSettings, getMetaCatalogProductEnrichment } from "./catalogEnrichment";
import { markMetaCatalogSourceUpdatesExported } from "./catalogSourceUpdates";
import { storageGet } from "../../storage";
import { ENV } from "../../_core/env";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

function catalogStorageKey(input: { operationalMetadata: string | null }) {
  try {
    const parsed = JSON.parse(input.operationalMetadata ?? "null") as any;
    return typeof parsed?.metaCatalog?.storageKey === "string" ? parsed.metaCatalog.storageKey : null;
  } catch {
    // Ignore malformed legacy metadata; the media remains unavailable for export.
  }
  return null;
}

function metaCatalogPublicOrigin() {
  try {
    return new URL(ENV.metaRedirectUri).origin;
  } catch {
    throw new Error("لا يتوفر عنوان عام صالح للمنصة لإتاحة وسائط Meta Catalog.");
  }
}

export async function absoluteMetaCatalogStorageUrl(storageKey: string | null) {
  if (!storageKey) return null;
  return new URL((await storageGet(storageKey)).url, metaCatalogPublicOrigin()).toString();
}

export async function buildMetaCatalogExportSnapshot(input: { storeId: number; catalogAssetId: number; productIds?: number[] }) {
  const db = await requireDb();
  const [asset] = await db.select({ id: metaAssets.id, connectionId: metaAssets.connectionId, externalId: metaAssets.externalId, displayName: metaAssets.displayName, isSelected: metaAssets.isSelected }).from(metaAssets).where(and(eq(metaAssets.id, input.catalogAssetId), eq(metaAssets.storeId, input.storeId), eq(metaAssets.assetType, "catalog"))).limit(1);
  if (!asset) throw new Error("اختر أصل Catalog تابعًا للمتجر قبل التصدير.");
  if (!asset.isSelected) throw new Error("لا يمكن التصدير قبل تحديد أصل Catalog في مركز Meta.");
  const [connection] = await db.select({ id: metaConnections.id, status: metaConnections.status }).from(metaConnections).where(and(eq(metaConnections.id, asset.connectionId), eq(metaConnections.storeId, input.storeId))).limit(1);
  if (!connection || connection.status !== "connected") throw new Error("اتصال Meta الموحد غير جاهز لتصدير Catalog.");
  const [capability] = await db.select({ enabled: metaConnectionCapabilities.enabled, status: metaConnectionCapabilities.status, missingScopes: metaConnectionCapabilities.missingScopes }).from(metaConnectionCapabilities).where(and(eq(metaConnectionCapabilities.storeId, input.storeId), eq(metaConnectionCapabilities.connectionId, asset.connectionId), eq(metaConnectionCapabilities.purpose, "catalog"))).limit(1);
  if (!capability?.enabled || capability.status !== "ready") throw new Error(capability?.missingScopes ? `قدرة Catalog غير جاهزة؛ الصلاحيات الناقصة: ${capability.missingScopes}` : "فعّل قدرة Catalog واختر أصلها قبل التصدير.");
  const [[store], settings] = await Promise.all([
    db.select({ name: stores.name }).from(stores).where(eq(stores.id, input.storeId)).limit(1),
    getMetaCatalogEnrichmentSettings(input.storeId),
  ]);
  const selectedProductIds = input.productIds ? Array.from(new Set(input.productIds)) : null;
  const productRows = await db.select().from(products).where(and(
    eq(products.storeId, input.storeId),
    eq(products.status, "active"),
    ...(selectedProductIds?.length ? [inArray(products.id, selectedProductIds)] : []),
  )).orderBy(desc(products.updatedAt));
  const productIds = productRows.map(product => product.id);
  if (!productIds.length) return { catalogAssetId: asset.id, connectionId: connection.id, catalogId: asset.externalId, items: [] as MetaCatalogProductItem[], requests: [], idempotencyKey: buildCatalogExportIdempotencyKey({ storeId: input.storeId, catalogId: asset.externalId, productItems: [] }), skippedProducts: 0, skipped: [] as Array<{ productId: number; productCode: string; reason: string }>, productReports: [] as Array<{ productId: number; productCode: string; name: string; metaTitle: string; metaDescription: string; groupPath: string | null; itemCount: number; imageCount: number; videoCount: number; primaryImageUrl: string | null; imageUrls: string[]; videoUrls: string[]; status: "ready" | "needs_review"; category: { id: string; path: string } | null; material: string | null; materialSource: "product_override" | "onedrive_metadata" | "missing"; issues: string[] }>, storeName: store?.name ?? "عالم الحجابات الأنيقة" };
  const [variantRows, mediaRows] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.productId, productIds)),
    db.select().from(productMedia).where(inArray(productMedia.productId, productIds)),
  ]);
  const items: MetaCatalogProductItem[] = [];
  let skippedProducts = 0;
  const skipped: Array<{ productId: number; productCode: string; reason: string }> = [];
  const productReports: Array<{ productId: number; productCode: string; name: string; metaTitle: string; metaDescription: string; groupPath: string | null; itemCount: number; imageCount: number; videoCount: number; primaryImageUrl: string | null; imageUrls: string[]; videoUrls: string[]; status: "ready" | "needs_review"; category: { id: string; path: string } | null; material: string | null; materialSource: "product_override" | "onedrive_metadata" | "missing"; issues: string[] }> = [];
  for (const product of productRows) {
    const productVariantsForProduct = variantRows.filter(variant => variant.productId === product.id).map(variant => ({ id: variant.id, colorName: variant.colorName, sizeLabel: variant.sizeLabel, inventoryQuantity: variant.inventoryQuantity }));
    const enrichment = await getMetaCatalogProductEnrichment({ storeId: input.storeId, productId: product.id });
    const productMediaForProduct = await Promise.all(mediaRows.filter(media => media.productId === product.id).map(async media => ({
      id: media.id,
      variantId: media.variantId,
      mediaType: media.mediaType,
      catalogUrl: await absoluteMetaCatalogStorageUrl(catalogStorageKey({ operationalMetadata: media.operationalMetadata })),
      operationalUrl: settings.mediaPolicy === "operational_fallback" ? await absoluteMetaCatalogStorageUrl(media.storageKey) : null,
      sortOrder: media.sortOrder,
    })));
    const result = buildMetaCatalogProductItems({
      product: {
        id: product.id,
        productCode: product.productCode,
        name: product.name,
        category: product.category,
        description: product.description,
        status: product.status,
        sellingPrice: product.sellingPrice,
        previousPrice: product.previousPrice,
        exportEnabled: enrichment.exportEnabled,
        productLink: enrichment.effective.productLink,
        fbProductCategory: enrichment.effective.fbProductCategory,
        googleProductCategory: enrichment.effective.googleProductCategory,
        material: enrichment.effective.material,
        pattern: enrichment.effective.pattern,
        gender: enrichment.effective.gender,
        ageGroup: enrichment.effective.ageGroup,
        productType: enrichment.effective.productType,
        defaultAvailability: settings.defaultAvailability,
        condition: settings.condition,
      },
      variants: productVariantsForProduct,
      media: productMediaForProduct,
      brand: enrichment.effective.brand || store?.name || "",
      currency: enrichment.effective.currency,
    });
    const resultIssues = result.issues ?? [];
    if (result.skipped) {
      skippedProducts += 1;
      skipped.push({ productId: product.id, productCode: product.productCode, reason: result.reason ?? "لم يكتمل المنتج للتصدير." });
    }
    productReports.push({
      productId: product.id,
      productCode: product.productCode,
      name: product.name,
      metaTitle: result.items[0]?.title ?? product.name,
      metaDescription: result.items[0]?.description ?? product.description ?? "",
      groupPath: enrichment.groupPath,
      itemCount: result.items.length,
      imageCount: result.items.reduce((count, item) => count + (item.image?.length ?? 0), 0),
      videoCount: result.items.reduce((count, item) => count + (item.video?.length ?? 0), 0),
      primaryImageUrl: result.items.find(item => item.image?.[0])?.image?.[0]?.url ?? null,
      imageUrls: Array.from(new Set(result.items.flatMap(item => item.image?.map(entry => entry.url) ?? []))),
      videoUrls: Array.from(new Set(result.items.flatMap(item => item.video?.map(entry => entry.url) ?? []))),
      status: result.skipped || resultIssues.length ? "needs_review" : "ready",
      category: enrichment.effective.fbProductCategoryDetails,
      material: enrichment.effective.material,
      materialSource: enrichment.effective.materialSource,
      issues: result.skipped ? [result.reason ?? "لم يكتمل المنتج للتصدير."] : resultIssues,
    });
    items.push(...result.items);
  }
  const requests = toMetaCatalogBatchRequests(items);
  return { catalogAssetId: asset.id, connectionId: connection.id, catalogId: asset.externalId, items, requests, idempotencyKey: buildCatalogExportIdempotencyKey({ storeId: input.storeId, catalogId: asset.externalId, productItems: items }), skippedProducts, skipped, productReports, storeName: store?.name ?? "عالم الحجابات الأنيقة" };
}

export async function previewMetaCatalogExport(input: { storeId: number; catalogAssetId: number; productIds?: number[] }) {
  const snapshot = await buildMetaCatalogExportSnapshot(input);
  return {
    catalogAssetId: snapshot.catalogAssetId,
    catalogId: snapshot.catalogId,
    itemCount: snapshot.items.length,
    skippedProducts: snapshot.skippedProducts,
    skipped: snapshot.skipped.slice(0, 20),
    productReports: snapshot.productReports.slice(0, 50),
    idempotencyKey: snapshot.idempotencyKey,
    sampleItems: snapshot.items.slice(0, 10).map(({ id, retailer_id, title, description, availability, price, sale_price, color, size, item_group_id, fb_product_category, material, image, video }) => ({ id, retailer_id, title, description, availability, price, sale_price, color, size, item_group_id, fb_product_category, material, imageUrls: image?.map(entry => entry.url) ?? [], videoUrls: video?.map(entry => entry.url) ?? [] })),
  };
}

export async function runMetaCatalogExport(input: { storeId: number; catalogAssetId: number; productIds: number[]; createdByUserId: number }) {
  const db = await requireDb();
  if (!input.productIds.length) throw new Error("اختر منتجًا واحدًا على الأقل من مساحة عمل Meta Catalog قبل التصدير.");
  const snapshot = await buildMetaCatalogExportSnapshot(input);
  if (!snapshot.requests.length) throw new Error("لا توجد منتجات نشطة بمتغيرات صالحة للتصدير.");
  const existing = await db.select().from(metaCatalogExportJobs).where(and(eq(metaCatalogExportJobs.storeId, input.storeId), eq(metaCatalogExportJobs.catalogAssetId, input.catalogAssetId), eq(metaCatalogExportJobs.idempotencyKey, snapshot.idempotencyKey))).orderBy(desc(metaCatalogExportJobs.id)).limit(1);
  let job = existing[0];
  if (!job) {
    await db.insert(metaCatalogExportJobs).values({ storeId: input.storeId, connectionId: snapshot.connectionId, catalogAssetId: snapshot.catalogAssetId, status: "pending", idempotencyKey: snapshot.idempotencyKey, scopeJson: JSON.stringify({ productIds: Array.from(new Set(input.productIds)) }), requestCount: snapshot.requests.length, createdByUserId: input.createdByUserId }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
    [job] = await db.select().from(metaCatalogExportJobs).where(and(eq(metaCatalogExportJobs.storeId, input.storeId), eq(metaCatalogExportJobs.catalogAssetId, input.catalogAssetId), eq(metaCatalogExportJobs.idempotencyKey, snapshot.idempotencyKey))).orderBy(desc(metaCatalogExportJobs.id)).limit(1);
  }
  if (!job) throw new Error("تعذر إنشاء سجل تصدير Meta Catalog.");
  if (["submitted", "processing", "completed"].includes(job.status)) return { job, reused: true, snapshot: { itemCount: snapshot.items.length, idempotencyKey: snapshot.idempotencyKey } };
  await db.update(metaCatalogExportJobs).set({ status: "processing", startedAt: new Date(), lastError: null }).where(eq(metaCatalogExportJobs.id, job.id));
  try {
    const accessToken = await getMetaCatalogAccessToken({ storeId: input.storeId, connectionId: snapshot.connectionId, assetId: snapshot.catalogAssetId });
    const runtime = await getMetaRuntimeSettings();
    const handles: string[] = [];
    const validationStatus: unknown[] = [];
    for (const chunk of chunkMetaCatalogBatchRequests(snapshot.requests)) {
      const result = await submitMetaCatalogBatch({ catalogId: snapshot.catalogId, accessToken, requests: chunk, graphApiVersion: runtime.graphApiVersion });
      handles.push(...result.handles);
      validationStatus.push(...result.validationStatus);
    }
    const exportStatus = validationStatus.some((entry: any) => entry?.status === "ERROR") ? "partial" : "submitted" as const;
    await db.update(metaCatalogExportJobs).set({ status: exportStatus, handle: handles[0] ?? null, validationJson: JSON.stringify(validationStatus).slice(0, 20_000), completedAt: new Date() }).where(eq(metaCatalogExportJobs.id, job.id));
    if (exportStatus === "submitted") await markMetaCatalogSourceUpdatesExported({ storeId: input.storeId, productIds: input.productIds, exportJobId: job.id });
    const [updated] = await db.select().from(metaCatalogExportJobs).where(eq(metaCatalogExportJobs.id, job.id)).limit(1);
    return { job: updated ?? job, reused: false, snapshot: { itemCount: snapshot.items.length, idempotencyKey: snapshot.idempotencyKey } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل تصدير Meta Catalog.";
    await db.update(metaCatalogExportJobs).set({ status: "failed", lastError: message.slice(0, 500), completedAt: new Date() }).where(eq(metaCatalogExportJobs.id, job.id));
    throw error;
  }
}

export async function listMetaCatalogExportJobs(input: { storeId: number }) {
  const db = await requireDb();
  return db.select().from(metaCatalogExportJobs).where(eq(metaCatalogExportJobs.storeId, input.storeId)).orderBy(desc(metaCatalogExportJobs.createdAt)).limit(20);
}

/** Returns the selectable active products without duplicating full export validation. */
export async function listMetaCatalogWorkspaceProducts(input: { storeId: number }) {
  const db = await requireDb();
  const productRows = await db.select({
    id: products.id,
    productCode: products.productCode,
    name: products.name,
    category: products.category,
    material: products.material,
    status: products.status,
    updatedAt: products.updatedAt,
  }).from(products).where(and(eq(products.storeId, input.storeId), eq(products.status, "active"))).orderBy(desc(products.updatedAt));
  if (!productRows.length) return [] as Array<{
    id: number; productCode: string; name: string; category: string | null; groupPath: string | null; material: string | null; variantCount: number; imageCount: number; videoCount: number; preparedMediaCount: number; sourceUpdateStatus: "pending_review" | "media_prepared" | null; sourceChangeCount: number; updatedAt: Date;
  }>;
  const productIds = productRows.map(product => product.id);
  const [folders, variants, media, sourceUpdates] = await Promise.all([
    db.select({ productId: catalogFolderImports.linkedProductId, groupPath: catalogFolderImports.groupName }).from(catalogFolderImports).where(and(eq(catalogFolderImports.storeId, input.storeId), inArray(catalogFolderImports.linkedProductId, productIds))),
    db.select({ productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.productId, productIds)),
    db.select({ productId: productMedia.productId, mediaType: productMedia.mediaType, operationalMetadata: productMedia.operationalMetadata }).from(productMedia).where(inArray(productMedia.productId, productIds)),
    db.select({ productId: metaCatalogSourceUpdates.productId, status: metaCatalogSourceUpdates.status, changesJson: metaCatalogSourceUpdates.changesJson }).from(metaCatalogSourceUpdates).where(and(eq(metaCatalogSourceUpdates.storeId, input.storeId), inArray(metaCatalogSourceUpdates.productId, productIds), inArray(metaCatalogSourceUpdates.status, ["pending_review", "media_prepared"]))),
  ]);
  const groupByProduct = new Map(folders.filter(folder => folder.productId !== null).map(folder => [folder.productId!, folder.groupPath]));
  const countByProduct = new Map<number, { variants: number; images: number; videos: number; prepared: number }>();
  const sourceUpdateByProduct = new Map(sourceUpdates.map(update => [update.productId, update]));
  for (const product of productRows) countByProduct.set(product.id, { variants: 0, images: 0, videos: 0, prepared: 0 });
  for (const variant of variants) countByProduct.get(variant.productId)!.variants += 1;
  for (const entry of media) {
    const counts = countByProduct.get(entry.productId);
    if (!counts) continue;
    if (entry.mediaType === "image") counts.images += 1;
    if (entry.mediaType === "video") counts.videos += 1;
    if (catalogStorageKey({ operationalMetadata: entry.operationalMetadata })) counts.prepared += 1;
  }
  return productRows.map(product => {
    const counts = countByProduct.get(product.id)!;
    const sourceUpdate = sourceUpdateByProduct.get(product.id);
    let sourceChangeCount = 0;
    try { sourceChangeCount = Array.isArray(JSON.parse(sourceUpdate?.changesJson ?? "[]")) ? JSON.parse(sourceUpdate?.changesJson ?? "[]").length : 0; } catch { sourceChangeCount = 0; }
    return { ...product, groupPath: groupByProduct.get(product.id) ?? product.category ?? null, variantCount: counts.variants, imageCount: counts.images, videoCount: counts.videos, preparedMediaCount: counts.prepared, sourceUpdateStatus: sourceUpdate?.status === "pending_review" || sourceUpdate?.status === "media_prepared" ? sourceUpdate.status : null, sourceChangeCount };
  });
}
