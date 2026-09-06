import { and, desc, eq } from "drizzle-orm";
import { catalogFolderImports, catalogGroupImports, productImportJobs, productMedia, productOperations, products } from "../../drizzle/schema";
import { listCatalogChildren, readCatalogFileBytes, readCatalogTextFile, type CatalogDriveItem } from "../integrations/onedrive/catalog";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { parseCatalogProductMetadataLenient, parseCatalogProductMetadataLenientDocx, type LenientCatalogProductMetadata } from "../integrations/onedrive/productMetadata";
import { getDb } from "../db";
import { generateOperationalMediaForProduct, generateOperationalVideosForProduct } from "./operationalMediaService";
import { generateAutomaticColorSuggestion } from "./db";
import { notifyPermissionHolders } from "../notifications/db";

const isImage = (item: CatalogDriveItem) => item.kind === "file" && /\.(jpg|jpeg|png|webp)$/i.test(item.name);
const isVideo = (item: CatalogDriveItem) => item.kind === "file" && /\.(mp4|mov|m4v|webm)$/i.test(item.name);

export type CatalogAutomationSummary = {
  discovered: number;
  draftsCreated: number;
  existing: number;
  failed: number;
  operationalCopiesCreated: number;
};

export type CatalogScanProgress = {
  stage: "discovering_folders" | "reading_product" | "copying_operational_media" | "analyzing_colors" | "processing_folders";
  processedFolders: number;
  totalFolders: number;
  currentProduct?: string | null;
};

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) await worker(item);
    }
  }));
}

function sourceReference(groupName: string, productCode: string) {
  return `Catalog/${groupName}/${productCode}`;
}

type CatalogWorkItem = { folder: CatalogDriveItem; groupName: string };

/**
 * The merchant's folder tree is the category tree. Every leaf folder is a
 * product candidate, and its own name is the product Code. This deliberately
 * allows missing metadata or media: those shortcomings become editable draft
 * fields instead of hiding the product from the platform.
 */
async function discoverCatalogWorkItems(input: { encryptedAccessToken: string; driveId: string; groups: CatalogDriveItem[] }) {
  const workItems: CatalogWorkItem[] = [];
  const visited = new Set<string>();
  const visit = async (folder: CatalogDriveItem, categoryPath: string): Promise<void> => {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    const contents = await listCatalogChildren({ encryptedAccessToken: input.encryptedAccessToken, driveId: input.driveId, folderId: folder.id });
    const childFolders = contents.filter(item => item.kind === "folder");
    if (childFolders.length === 0) {
      workItems.push({ folder, groupName: categoryPath });
      return;
    }
    await mapWithConcurrency(childFolders, 2, async child => visit(child, `${categoryPath}/${folder.name}`));
  };
  for (const group of input.groups) {
    const children = (await listCatalogChildren({ encryptedAccessToken: input.encryptedAccessToken, driveId: input.driveId, folderId: group.id })).filter(item => item.kind === "folder");
    await mapWithConcurrency(children, 2, async child => visit(child, group.name));
  }
  return workItems;
}

export function classifyCatalogGroupObservation(existing: { state: "discovered" | "needs_review" | "missing"; groupName: string } | undefined, currentGroupName: string) {
  const renamed = Boolean(existing && existing.groupName !== currentGroupName);
  return {
    renamed,
    state: existing?.state === "needs_review" || renamed || !existing ? "needs_review" as const : "discovered" as const,
    lastError: renamed ? "source_group_identity_changed" : null,
  };
}

export function classifyCatalogFolderObservation(existing: { productCode: string; groupName: string; lastError?: string | null } | undefined, currentGroupName: string, currentProductCode: string) {
  const renamedOrMoved = Boolean(existing && (existing.productCode !== currentProductCode || existing.groupName !== currentGroupName));
  return {
    changed: renamedOrMoved,
    lastError: renamedOrMoved ? "source_folder_identity_changed" : null,
  };
}

export function buildCatalogFolderReviewNotification(input: { storeId: number; entityId: number; folderId: string; folderName: string; groupName: string }) {
  return {
    storeId: input.storeId,
    permissionCode: "products.create" as const,
    type: "content_review_requested" as const,
    priority: "action" as const,
    title: "مجلد منتج Catalog يحتاج إلى مراجعة",
    body: `تغير مسار أو اسم مجلد المنتج «${input.folderName}» دون تعديل المنتج تلقائيًا.`,
    entityType: "catalog_folder",
    entityId: input.entityId,
    route: "/products?catalogReview=folders",
    dedupeKey: `catalog-folder-identity-change:${input.storeId}:${input.folderId}:${input.folderName}:${input.groupName}`,
  };
}

async function readCatalogProductMetadata(input: { contents: CatalogDriveItem[]; encryptedAccessToken: string; driveId: string }): Promise<LenientCatalogProductMetadata> {
  const textFile = input.contents.find(item => item.kind === "file" && item.name.toLowerCase() === "product.txt");
  if (textFile) return parseCatalogProductMetadataLenient(await readCatalogTextFile({ encryptedAccessToken: input.encryptedAccessToken, driveId: input.driveId, fileId: textFile.id }));
  const wordFile = input.contents.find(item => item.kind === "file" && item.name.toLowerCase() === "product.docx");
  if (wordFile) return parseCatalogProductMetadataLenientDocx(await readCatalogFileBytes({ encryptedAccessToken: input.encryptedAccessToken, driveId: input.driveId, fileId: wordFile.id, maxBytes: 5 * 1024 * 1024 }));
  return parseCatalogProductMetadataLenient(null);
}

function hasUnreviewedAutomaticSuggestion(operations: Array<{ id: number; action: string; changes: string }>) {
  const generated = operations.find(operation => operation.action === "color_suggestions_generated");
  if (!generated) return false;
  return !operations.some(operation => {
    if (operation.action !== "color_suggestions_reviewed") return false;
    try { return JSON.parse(operation.changes)?.suggestionOperationId === generated.id; } catch { return false; }
  });
}

async function ensureAutomaticColorSuggestion(input: { db: NonNullable<Awaited<ReturnType<typeof getDb>>>; productId: number; actorUserId: number }) {
  const media = await input.db.select().from(productMedia).where(eq(productMedia.productId, input.productId));
  const newUnassignedMediaIds = media.filter(item => Boolean(item.storageKey) && !item.variantId && !item.colorVerified).map(item => item.id);
  if (newUnassignedMediaIds.length === 0) return;
  const operations = await input.db.select().from(productOperations).where(eq(productOperations.productId, input.productId)).orderBy(desc(productOperations.createdAt), desc(productOperations.id));
  if (hasUnreviewedAutomaticSuggestion(operations)) return;
  try {
    await generateAutomaticColorSuggestion({ productId: input.productId, actorUserId: input.actorUserId, mediaIds: newUnassignedMediaIds });
  } catch (error) {
    await input.db.insert(productOperations).values({
      productId: input.productId,
      actorUserId: input.actorUserId,
      source: "catalog_scan",
      action: "color_suggestions_generation_failed",
      changes: JSON.stringify({ message: error instanceof Error ? error.message : "تعذر تحليل ألوان الصور تلقائيًا." }),
    });
  }
}

async function upsertGroupObservation(input: { storeId: number; ownerUserId: number; groupFolderId: string; groupName: string; state: "discovered" | "needs_review" | "missing"; lastError?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [existing] = await db.select().from(catalogGroupImports).where(and(eq(catalogGroupImports.storeId, input.storeId), eq(catalogGroupImports.groupFolderId, input.groupFolderId))).limit(1);
  const values = {
    groupName: input.groupName,
    sourceReference: `Catalog/${input.groupName}`,
    state: input.state,
    lastError: input.lastError ?? null,
    lastScannedAt: new Date(),
  };
  if (existing) {
    await db.update(catalogGroupImports).set(values).where(eq(catalogGroupImports.id, existing.id));
    return { ...existing, ...values };
  }
  const result = await db.insert(catalogGroupImports).values({ storeId: input.storeId, ownerUserId: input.ownerUserId, groupFolderId: input.groupFolderId, ...values });
  return { id: Number(result[0].insertId), ...values };
}

async function upsertFolderObservation(input: {
  storeId: number;
  ownerUserId: number;
  productFolderId: string;
  groupName: string;
  productCode: string;
  source: string;
  state: "discovered" | "draft_created" | "already_exists" | "needs_review" | "failed";
  linkedProductId?: number | null;
  missingFields?: string[];
  imageCount: number;
  lastError?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [existing] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.storeId, input.storeId), eq(catalogFolderImports.productFolderId, input.productFolderId))).limit(1);
  const values = {
    groupName: input.groupName,
    productCode: input.productCode,
    sourceReference: input.source,
    state: input.state,
    linkedProductId: input.linkedProductId ?? null,
    missingFields: JSON.stringify(input.missingFields ?? []),
    imageCount: input.imageCount,
    lastError: input.lastError ?? null,
    lastScannedAt: new Date(),
  };
  if (existing) {
    await db.update(catalogFolderImports).set(values).where(eq(catalogFolderImports.id, existing.id));
    return existing;
  }
  const result = await db.insert(catalogFolderImports).values({ storeId: input.storeId, ownerUserId: input.ownerUserId, productFolderId: input.productFolderId, ...values });
  return { id: Number(result[0].insertId), linkedProductId: values.linkedProductId };
}

async function createDraftFromFolder(input: {
  storeId: number;
  ownerUserId: number;
  groupName: string;
  folder: CatalogDriveItem;
  images: CatalogDriveItem[];
  videos: CatalogDriveItem[];
  metadata: LenientCatalogProductMetadata;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const missingFields = [...input.metadata.problems, ...(input.images.length === 0 ? ["images"] : [])];
  const source = sourceReference(input.groupName, input.folder.name);
  const result = await db.transaction(async tx => {
    const created = await tx.insert(products).values({
      storeId: input.storeId,
      productCode: input.folder.name,
      name: input.metadata.name ?? `منتج يحتاج بيانات — ${input.folder.name}`,
      category: input.groupName,
      description: input.metadata.description,
      material: input.metadata.material,
      sizeLabels: JSON.stringify(input.metadata.sizes),
      status: "draft",
      // The placeholder is never a public price: the draft is withheld and the
      // missing field is shown until a staff member enters a valid amount.
      sellingPrice: input.metadata.sellingPrice ?? "0.00",
      previousPrice: input.metadata.previousPrice ?? null,
      createdByUserId: input.ownerUserId,
    });
    const productId = Number(created[0].insertId);
    await tx.insert(productImportJobs).values({
      storeId: input.storeId,
      source: "onedrive",
      sourceReference: source,
      status: "needs_review",
      linkedProductId: productId,
      missingFields: JSON.stringify(missingFields),
      createdByUserId: input.ownerUserId,
    });
    const catalogMedia = [
      ...input.images.map((image, index) => ({ productId, source: "onedrive" as const, mediaType: "image" as const, originalUrl: image.webUrl, originalFileName: image.name, storageKey: null, colorVerified: false, sortOrder: index })),
      ...input.videos.map((video, index) => ({ productId, source: "onedrive" as const, mediaType: "video" as const, originalUrl: video.webUrl, originalFileName: video.name, storageKey: null, colorVerified: true, sortOrder: input.images.length + index })),
    ];
    if (catalogMedia.length > 0) {
      await tx.insert(productMedia).values(catalogMedia);
    }
    await tx.insert(productOperations).values({
      productId,
      actorUserId: input.ownerUserId,
      source: "catalog_scan",
      action: "draft_created_from_catalog",
      changes: JSON.stringify({ source, missingFields, imageCount: input.images.length }),
    });
    return { productId, missingFields };
  });
  return result;
}

async function syncCatalogSourceMaterial(input: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  productId: number;
  actorUserId: number;
  material?: string;
}) {
  const material = input.material ?? null;
  const [current] = await input.db.select({ material: products.material }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!current || current.material === material) return false;
  await input.db.transaction(async tx => {
    await tx.update(products).set({ material }).where(eq(products.id, input.productId));
    await tx.insert(productOperations).values({
      productId: input.productId,
      actorUserId: input.actorUserId,
      source: "catalog_scan",
      action: "catalog_material_synced",
      changes: JSON.stringify({ source: "onedrive_product_metadata", material }),
    });
  });
  return true;
}

async function syncNewCatalogMediaReferences(input: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  productId: number;
  images: CatalogDriveItem[];
  videos: CatalogDriveItem[];
}) {
  const existing = await input.db.select().from(productMedia).where(eq(productMedia.productId, input.productId));
  const known = new Set(existing.map(entry => `${entry.mediaType}:${entry.originalFileName ?? ""}`));
  const additions = [
    ...input.images.filter(image => !known.has(`image:${image.name}`)).map((image, index) => ({ productId: input.productId, source: "onedrive" as const, mediaType: "image" as const, originalUrl: image.webUrl, originalFileName: image.name, storageKey: null, colorVerified: false, sortOrder: existing.length + index })),
    ...input.videos.filter(video => !known.has(`video:${video.name}`)).map((video, index) => ({ productId: input.productId, source: "onedrive" as const, mediaType: "video" as const, originalUrl: video.webUrl, originalFileName: video.name, storageKey: null, colorVerified: true, sortOrder: existing.length + input.images.length + index })),
  ];
  if (additions.length > 0) await input.db.insert(productMedia).values(additions);
  return { imagesAdded: additions.filter(entry => entry.mediaType === "image").length, videosAdded: additions.filter(entry => entry.mediaType === "video").length };
}

async function copyCatalogVideosSafely(input: { db: NonNullable<Awaited<ReturnType<typeof getDb>>>; productId: number; actorUserId: number }) {
  try {
    return await generateOperationalVideosForProduct({ userId: input.actorUserId, productId: input.productId });
  } catch (error) {
    await input.db.insert(productOperations).values({ productId: input.productId, actorUserId: input.actorUserId, source: "catalog_scan", action: "video_operational_copy_failed", changes: JSON.stringify({ message: error instanceof Error ? error.message : "تعذر نسخ الفيديو التشغيلي." }) });
    return { created: [] as Array<{ mediaId: number; storageKey: string; outputBytes: number }>, skipped: [] as number[], originalFilesModified: false as const };
  }
}

/**
 * Deterministic, idempotent scanner. It only reads Catalog and writes platform
 * records; it never changes files, folders, permissions, or source data in OneDrive.
 */
export async function scanCatalogForOwner(input: { ownerUserId: number; storeId: number; onProgress?: (progress: CatalogScanProgress) => Promise<void> | void }): Promise<CatalogAutomationSummary> {
  const connection = await getUsableCatalogConnection(input.storeId);
  if (!connection || connection.status !== "catalog_selected" || !connection.selectedDriveId || !connection.selectedFolderId) {
    throw new Error("مرجع Catalog المفوض غير جاهز للفحص التلقائي.");
  }
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const summary: CatalogAutomationSummary = { discovered: 0, draftsCreated: 0, existing: 0, failed: 0, operationalCopiesCreated: 0 };
  const knownProducts = await db.select({ id: products.id, productCode: products.productCode }).from(products).where(eq(products.storeId, input.storeId));
  const productByCode = new Map(knownProducts.map(product => [product.productCode, product]));
  const productById = new Map(knownProducts.map(product => [product.id, product]));
  const groups = (await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: connection.selectedFolderId })).filter(item => item.kind === "folder");
  const seenGroupFolderIds = new Set(groups.map(group => group.id));
  await mapWithConcurrency(groups, 2, async group => {
    const [existing] = await db.select({ id: catalogGroupImports.id, state: catalogGroupImports.state, groupName: catalogGroupImports.groupName }).from(catalogGroupImports).where(and(eq(catalogGroupImports.storeId, input.storeId), eq(catalogGroupImports.groupFolderId, group.id))).limit(1);
    const groupObservation = classifyCatalogGroupObservation(existing, group.name);
    const observation = await upsertGroupObservation({
      storeId: input.storeId,
      ownerUserId: input.ownerUserId,
      groupFolderId: group.id,
      groupName: group.name,
      state: groupObservation.state,
      lastError: groupObservation.lastError,
    });
    if (!existing || groupObservation.renamed) {
      await notifyPermissionHolders({
        storeId: input.storeId,
        permissionCode: "products.create",
        type: "content_review_requested",
        priority: "action",
        title: "مجلد Catalog يحتاج إلى مراجعة",
        body: groupObservation.renamed ? `تغير اسم مجموعة Catalog إلى «${group.name}» دون تعديل تلقائي.` : `اكتُشفت مجموعة Catalog جديدة «${group.name}» وتنتظر المراجعة.`,
        entityType: "catalog_group",
        entityId: observation.id,
        route: "/products?catalogReview=groups",
        dedupeKey: `catalog-group-review:${input.storeId}:${group.id}:${group.name}`,
      });
    }
  });
  const workItems = await discoverCatalogWorkItems({
    encryptedAccessToken: connection.encryptedAccessToken,
    driveId: connection.selectedDriveId,
    groups,
  });
  const seenProductFolderIds = new Set<string>();
  let processedFolders = 0;
  const report = async (stage: CatalogScanProgress["stage"], currentProduct: string | null = null) => {
    if (!input.onProgress) return;
    try {
      await input.onProgress({ stage, processedFolders, totalFolders: workItems.length, currentProduct });
    } catch {
      // Progress visibility must never interrupt a successful Catalog scan.
    }
  };

  await report("discovering_folders");
  await mapWithConcurrency(workItems, 2, async ({ groupName, folder }) => {
    seenProductFolderIds.add(folder.id);
    summary.discovered += 1;
    const source = sourceReference(groupName, folder.name);
    await report("reading_product", folder.name);
    try {
      const contents = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId!, folderId: folder.id });
      const images = contents.filter(isImage);
      const videos = contents.filter(isVideo);
      const metadata = await readCatalogProductMetadata({ contents, encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId! });
      const [priorFolder] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.storeId, input.storeId), eq(catalogFolderImports.productFolderId, folder.id))).limit(1);
      const existingProduct = productByCode.get(folder.name) ?? (priorFolder?.linkedProductId ? productById.get(priorFolder.linkedProductId) : undefined);
      const folderObservation = classifyCatalogFolderObservation(priorFolder, groupName, folder.name);
      if (!existingProduct && priorFolder?.lastError === "deleted_by_user") {
        await upsertFolderObservation({ storeId: input.storeId, ownerUserId: input.ownerUserId, productFolderId: folder.id, groupName, productCode: folder.name, source, state: "needs_review", linkedProductId: null, missingFields: [], imageCount: images.length, lastError: "deleted_by_user" });
        summary.existing += 1;
        return;
      }
      if (existingProduct) {
        const preserveDraftState = priorFolder?.linkedProductId === existingProduct.id;
        const folderObservationRecord = await upsertFolderObservation({
          storeId: input.storeId,
          ownerUserId: input.ownerUserId,
          productFolderId: folder.id,
          groupName,
          productCode: folder.name,
          source,
          state: folderObservation.changed ? "needs_review" : preserveDraftState ? "draft_created" : "already_exists",
          linkedProductId: existingProduct.id,
          imageCount: images.length,
          missingFields: preserveDraftState ? JSON.parse(priorFolder?.missingFields ?? "[]") : [],
          lastError: folderObservation.lastError,
        });
        if (folderObservation.changed) {
          await notifyPermissionHolders(buildCatalogFolderReviewNotification({ storeId: input.storeId, entityId: folderObservationRecord.id, folderId: folder.id, folderName: folder.name, groupName }));
        }
        await syncCatalogSourceMaterial({ db, productId: existingProduct.id, actorUserId: input.ownerUserId, material: metadata.material });
        await syncNewCatalogMediaReferences({ db, productId: existingProduct.id, images, videos });
        await report("copying_operational_media", folder.name);
        const imageCopies = await generateOperationalMediaForProduct({ userId: input.ownerUserId, productId: existingProduct.id });
        summary.operationalCopiesCreated += imageCopies.created.length;
        const videoCopies = await copyCatalogVideosSafely({ db, productId: existingProduct.id, actorUserId: input.ownerUserId });
        summary.operationalCopiesCreated += videoCopies.created.length;
        await report("analyzing_colors", folder.name);
        await ensureAutomaticColorSuggestion({ db, productId: existingProduct.id, actorUserId: input.ownerUserId });
        summary.existing += 1;
        return;
      }
      const created = await createDraftFromFolder({ storeId: input.storeId, ownerUserId: input.ownerUserId, groupName, folder, images, videos, metadata });
      productByCode.set(folder.name, { id: created.productId, productCode: folder.name });
      await upsertFolderObservation({ storeId: input.storeId, ownerUserId: input.ownerUserId, productFolderId: folder.id, groupName, productCode: folder.name, source, state: "draft_created", linkedProductId: created.productId, missingFields: created.missingFields, imageCount: images.length });
      summary.draftsCreated += 1;
      await report("copying_operational_media", folder.name);
      if (images.length > 0) {
        const copies = await generateOperationalMediaForProduct({ userId: input.ownerUserId, productId: created.productId });
        summary.operationalCopiesCreated += copies.created.length;
      }
      if (videos.length > 0) {
        const copies = await copyCatalogVideosSafely({ db, productId: created.productId, actorUserId: input.ownerUserId });
        summary.operationalCopiesCreated += copies.created.length;
      }
      await report("analyzing_colors", folder.name);
      await ensureAutomaticColorSuggestion({ db, productId: created.productId, actorUserId: input.ownerUserId });
    } catch (error) {
      summary.failed += 1;
      await upsertFolderObservation({ storeId: input.storeId, ownerUserId: input.ownerUserId, productFolderId: folder.id, groupName, productCode: folder.name, source, state: "failed", imageCount: 0, lastError: error instanceof Error ? error.message : "تعذر فحص مجلد المنتج." });
    } finally {
      processedFolders += 1;
      await report("processing_folders", folder.name);
    }
  });

  const priorFolders = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.storeId, input.storeId));
  for (const prior of priorFolders) {
    if (seenProductFolderIds.has(prior.productFolderId) || prior.lastError === "deleted_by_user" || prior.lastError === "source_folder_missing") continue;
    await db.update(catalogFolderImports).set({ state: "needs_review", lastError: "source_folder_missing", lastScannedAt: new Date() }).where(eq(catalogFolderImports.id, prior.id));
    await notifyPermissionHolders({
      storeId: input.storeId,
      permissionCode: "products.create",
      type: "content_review_requested",
      priority: "action",
      title: "مجلد منتج Catalog غير ظاهر",
      body: `لم يظهر مجلد المنتج «${prior.productCode}» في آخر فحص؛ لم يُحذف المنتج أو ملف OneDrive تلقائيًا.`,
      entityType: "catalog_folder",
      entityId: prior.id,
      route: "/products?catalogReview=folders",
      dedupeKey: `catalog-folder-missing:${input.storeId}:${prior.productFolderId}`,
    });
  }
  const priorGroups = await db.select().from(catalogGroupImports).where(eq(catalogGroupImports.storeId, input.storeId));
  for (const prior of priorGroups) {
    if (seenGroupFolderIds.has(prior.groupFolderId) || prior.state === "missing") continue;
    await db.update(catalogGroupImports).set({ state: "missing", lastError: "source_group_missing", lastScannedAt: new Date() }).where(eq(catalogGroupImports.id, prior.id));
    await notifyPermissionHolders({
      storeId: input.storeId,
      permissionCode: "products.create",
      type: "content_review_requested",
      priority: "action",
      title: "مجموعة Catalog غير ظاهرة",
      body: `لم تظهر مجموعة «${prior.groupName}» في آخر فحص؛ لم تُحذف المنتجات تلقائيًا.`,
      entityType: "catalog_group",
      entityId: prior.id,
      route: "/products?catalogReview=groups",
      dedupeKey: `catalog-group-missing:${input.storeId}:${prior.groupFolderId}`,
    });
  }
  return summary;
}

export async function listDeletedCatalogProducts(input: { ownerUserId: number; storeId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db.select({
    id: catalogFolderImports.id,
    productFolderId: catalogFolderImports.productFolderId,
    groupName: catalogFolderImports.groupName,
    productCode: catalogFolderImports.productCode,
    sourceReference: catalogFolderImports.sourceReference,
    imageCount: catalogFolderImports.imageCount,
    lastScannedAt: catalogFolderImports.lastScannedAt,
  }).from(catalogFolderImports).where(and(eq(catalogFolderImports.storeId, input.storeId), eq(catalogFolderImports.ownerUserId, input.ownerUserId), eq(catalogFolderImports.lastError, "deleted_by_user"))).orderBy(desc(catalogFolderImports.lastScannedAt));
}

export async function restoreDeletedCatalogProduct(input: { ownerUserId: number; storeId: number; productFolderId: string }) {
  const connection = await getUsableCatalogConnection(input.storeId);
  if (!connection || connection.status !== "catalog_selected" || !connection.selectedDriveId || !connection.selectedFolderId) throw new Error("مرجع Catalog المفوض غير جاهز للاستعادة.");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [deleted] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.storeId, input.storeId), eq(catalogFolderImports.ownerUserId, input.ownerUserId), eq(catalogFolderImports.productFolderId, input.productFolderId), eq(catalogFolderImports.lastError, "deleted_by_user"))).limit(1);
  if (!deleted) throw new Error("لا يوجد منتج محذوف قابل للاستعادة بهذا المرجع.");
  const [existing] = await db.select().from(products).where(and(eq(products.storeId, input.storeId), eq(products.productCode, deleted.productCode))).limit(1);
  if (existing) throw new Error("المنتج موجود بالفعل داخل المنصة؛ لا يحتاج إلى استعادة.");

  const groups = (await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: connection.selectedFolderId })).filter(item => item.kind === "folder");
  const group = groups.find(item => item.name === deleted.groupName);
  if (!group) throw new Error("لم تعد مجموعة المنتج موجودة في Catalog.");
  const folders = (await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: group.id })).filter(item => item.kind === "folder");
  const folder = folders.find(item => item.id === deleted.productFolderId);
  if (!folder) throw new Error("لم يعد مجلد المنتج موجودًا في Catalog.");
  const contents = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: folder.id });
  const images = contents.filter(isImage);
  const videos = contents.filter(isVideo);
  const metadata = await readCatalogProductMetadata({ contents, encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId });
  const created = await createDraftFromFolder({ storeId: input.storeId, ownerUserId: input.ownerUserId, groupName: group.name, folder, images, videos, metadata });
  await upsertFolderObservation({ storeId: input.storeId, ownerUserId: input.ownerUserId, productFolderId: folder.id, groupName: group.name, productCode: folder.name, source: sourceReference(group.name, folder.name), state: "draft_created", linkedProductId: created.productId, missingFields: created.missingFields, imageCount: images.length, lastError: null });
  let operationalCopiesCreated = 0;
  if (images.length > 0) {
    const copies = await generateOperationalMediaForProduct({ userId: input.ownerUserId, productId: created.productId });
    operationalCopiesCreated = copies.created.length;
    if (operationalCopiesCreated !== images.length) throw new Error(`استُعيدت ${operationalCopiesCreated} من أصل ${images.length} صورة فقط؛ لم تكتمل الاستعادة.`);
    const freshDb = await getDb();
    if (freshDb) await ensureAutomaticColorSuggestion({ db: freshDb, productId: created.productId, actorUserId: input.ownerUserId });
  }
  if (videos.length > 0) {
    const copies = await generateOperationalVideosForProduct({ userId: input.ownerUserId, productId: created.productId });
    operationalCopiesCreated += copies.created.length;
    if (copies.created.length !== videos.length) throw new Error(`استُعيد ${copies.created.length} من أصل ${videos.length} فيديو فقط؛ لم تكتمل الاستعادة.`);
  }
  const freshDb = await getDb();
  if (freshDb) await freshDb.insert(productOperations).values({ productId: created.productId, actorUserId: input.ownerUserId, source: "products_ui", action: "restored_from_catalog", changes: JSON.stringify({ productFolderId: folder.id, sourceReference: sourceReference(group.name, folder.name) }) });
  return { productId: created.productId, productCode: folder.name, state: "draft" as const, imageCount: images.length, operationalCopiesCreated };
}
