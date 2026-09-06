import { and, desc, eq, inArray } from "drizzle-orm";
import { metaAssets, metaCatalogExportJobs, metaConnectionCapabilities, metaConnections, productMedia, productVariants, products, stores } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getMetaCatalogAccessToken } from "./db";
import { buildCatalogExportIdempotencyKey, buildMetaCatalogProductItems, chunkMetaCatalogBatchRequests, submitMetaCatalogBatch, toMetaCatalogBatchRequests, type MetaCatalogProductItem } from "./catalogExport";
import { getMetaRuntimeSettings } from "./platformSettings";
import { getMetaCatalogEnrichmentSettings, getMetaCatalogProductEnrichment } from "./catalogEnrichment";
import { storageGet } from "../../storage";

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

async function absoluteStorageUrl(baseUrl: string | null, storageKey: string | null) {
  if (!baseUrl || !storageKey) return null;
  return `${baseUrl}${(await storageGet(storageKey)).url}`;
}

export async function buildMetaCatalogExportSnapshot(input: { storeId: number; catalogAssetId: number }) {
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
  const productRows = await db.select().from(products).where(and(eq(products.storeId, input.storeId), eq(products.status, "active"))).orderBy(desc(products.updatedAt));
  const productIds = productRows.map(product => product.id);
  if (!productIds.length) return { catalogAssetId: asset.id, connectionId: connection.id, catalogId: asset.externalId, items: [] as MetaCatalogProductItem[], requests: [], idempotencyKey: buildCatalogExportIdempotencyKey({ storeId: input.storeId, catalogId: asset.externalId, productItems: [] }), skippedProducts: 0, skipped: [] as Array<{ productId: number; productCode: string; reason: string }>, storeName: store?.name ?? "عالم الحجابات الأنيقة" };
  const [variantRows, mediaRows] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.productId, productIds)),
    db.select().from(productMedia).where(inArray(productMedia.productId, productIds)),
  ]);
  const items: MetaCatalogProductItem[] = [];
  let skippedProducts = 0;
  const skipped: Array<{ productId: number; productCode: string; reason: string }> = [];
  for (const product of productRows) {
    const productVariantsForProduct = variantRows.filter(variant => variant.productId === product.id).map(variant => ({ id: variant.id, colorName: variant.colorName, sizeLabel: variant.sizeLabel, inventoryQuantity: variant.inventoryQuantity }));
    const enrichment = await getMetaCatalogProductEnrichment({ storeId: input.storeId, productId: product.id });
    const productMediaForProduct = await Promise.all(mediaRows.filter(media => media.productId === product.id).map(async media => ({
      id: media.id,
      variantId: media.variantId,
      mediaType: media.mediaType,
      catalogUrl: await absoluteStorageUrl(settings.productLinkBaseUrl, catalogStorageKey({ operationalMetadata: media.operationalMetadata })),
      operationalUrl: settings.mediaPolicy === "operational_fallback" ? await absoluteStorageUrl(settings.productLinkBaseUrl, media.storageKey) : null,
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
        material: enrichment.material,
        pattern: enrichment.pattern,
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
    if (result.skipped) {
      skippedProducts += 1;
      skipped.push({ productId: product.id, productCode: product.productCode, reason: result.reason ?? "لم يكتمل المنتج للتصدير." });
    }
    items.push(...result.items);
  }
  const requests = toMetaCatalogBatchRequests(items);
  return { catalogAssetId: asset.id, connectionId: connection.id, catalogId: asset.externalId, items, requests, idempotencyKey: buildCatalogExportIdempotencyKey({ storeId: input.storeId, catalogId: asset.externalId, productItems: items }), skippedProducts, skipped, storeName: store?.name ?? "عالم الحجابات الأنيقة" };
}

export async function previewMetaCatalogExport(input: { storeId: number; catalogAssetId: number }) {
  const snapshot = await buildMetaCatalogExportSnapshot(input);
  return {
    catalogAssetId: snapshot.catalogAssetId,
    catalogId: snapshot.catalogId,
    itemCount: snapshot.items.length,
    skippedProducts: snapshot.skippedProducts,
    skipped: snapshot.skipped.slice(0, 20),
    idempotencyKey: snapshot.idempotencyKey,
    sampleItems: snapshot.items.slice(0, 10).map(({ id, retailer_id, title, availability, price, sale_price, color, size, item_group_id, fb_product_category, material, image, video }) => ({ id, retailer_id, title, availability, price, sale_price, color, size, item_group_id, fb_product_category, material, imageCount: image?.length ?? 0, videoCount: video?.length ?? 0 })),
  };
}

export async function runMetaCatalogExport(input: { storeId: number; catalogAssetId: number; createdByUserId: number }) {
  const db = await requireDb();
  const snapshot = await buildMetaCatalogExportSnapshot(input);
  if (!snapshot.requests.length) throw new Error("لا توجد منتجات نشطة بمتغيرات صالحة للتصدير.");
  const existing = await db.select().from(metaCatalogExportJobs).where(and(eq(metaCatalogExportJobs.storeId, input.storeId), eq(metaCatalogExportJobs.catalogAssetId, input.catalogAssetId), eq(metaCatalogExportJobs.idempotencyKey, snapshot.idempotencyKey))).orderBy(desc(metaCatalogExportJobs.id)).limit(1);
  let job = existing[0];
  if (!job) {
    await db.insert(metaCatalogExportJobs).values({ storeId: input.storeId, connectionId: snapshot.connectionId, catalogAssetId: snapshot.catalogAssetId, status: "pending", idempotencyKey: snapshot.idempotencyKey, requestCount: snapshot.requests.length, createdByUserId: input.createdByUserId }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
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
    await db.update(metaCatalogExportJobs).set({ status: validationStatus.some((entry: any) => entry?.status === "ERROR") ? "partial" : "submitted", handle: handles[0] ?? null, validationJson: JSON.stringify(validationStatus).slice(0, 20_000), completedAt: new Date() }).where(eq(metaCatalogExportJobs.id, job.id));
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
