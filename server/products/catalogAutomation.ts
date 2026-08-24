import { and, desc, eq } from "drizzle-orm";
import { catalogFolderImports, productImportJobs, productMedia, productOperations, products } from "../../drizzle/schema";
import { listCatalogChildren, readCatalogTextFile, type CatalogDriveItem } from "../integrations/onedrive/catalog";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { parseCatalogProductMetadataLenient } from "../integrations/onedrive/productMetadata";
import { getDb } from "../db";
import { generateOperationalMediaForProduct } from "./operationalMediaService";
import { generateAutomaticColorSuggestion } from "./db";

const isImage = (item: CatalogDriveItem) => item.kind === "file" && /\.(jpg|jpeg|png|webp)$/i.test(item.name);

export type CatalogAutomationSummary = {
  discovered: number;
  draftsCreated: number;
  existing: number;
  failed: number;
  operationalCopiesCreated: number;
};

function sourceReference(groupName: string, productCode: string) {
  return `Catalog/${groupName}/${productCode}`;
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

async function upsertFolderObservation(input: {
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
  const [existing] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.ownerUserId, input.ownerUserId), eq(catalogFolderImports.productFolderId, input.productFolderId))).limit(1);
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
  const result = await db.insert(catalogFolderImports).values({ ownerUserId: input.ownerUserId, productFolderId: input.productFolderId, ...values });
  return { id: Number(result[0].insertId), linkedProductId: values.linkedProductId };
}

async function createDraftFromFolder(input: {
  ownerUserId: number;
  groupName: string;
  folder: CatalogDriveItem;
  images: CatalogDriveItem[];
  metadataText: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const metadata = parseCatalogProductMetadataLenient(input.metadataText);
  const missingFields = [...metadata.problems, ...(input.images.length === 0 ? ["images"] : [])];
  const source = sourceReference(input.groupName, input.folder.name);
  const result = await db.transaction(async tx => {
    const created = await tx.insert(products).values({
      productCode: input.folder.name,
      name: metadata.name ?? `منتج يحتاج بيانات — ${input.folder.name}`,
      category: input.groupName,
      description: metadata.description,
      sizeLabels: JSON.stringify(metadata.sizes),
      status: "draft",
      // The placeholder is never a public price: the draft is withheld and the
      // missing field is shown until a staff member enters a valid amount.
      sellingPrice: metadata.sellingPrice ?? "0.00",
      createdByUserId: input.ownerUserId,
    });
    const productId = Number(created[0].insertId);
    await tx.insert(productImportJobs).values({
      source: "onedrive",
      sourceReference: source,
      status: "needs_review",
      linkedProductId: productId,
      missingFields: JSON.stringify(missingFields),
      createdByUserId: input.ownerUserId,
    });
    if (input.images.length > 0) {
      await tx.insert(productMedia).values(input.images.map((image, index) => ({
        productId,
        source: "onedrive" as const,
        mediaType: "image" as const,
        originalUrl: image.webUrl,
        originalFileName: image.name,
        storageKey: null,
        colorVerified: false,
        sortOrder: index,
      })));
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

/**
 * Deterministic, idempotent scanner. It only reads Catalog and writes platform
 * records; it never changes files, folders, permissions, or source data in OneDrive.
 */
export async function scanCatalogForOwner(ownerUserId: number): Promise<CatalogAutomationSummary> {
  const connection = await getUsableCatalogConnection(ownerUserId);
  if (!connection || connection.status !== "catalog_selected" || !connection.selectedDriveId || !connection.selectedFolderId) {
    throw new Error("مرجع Catalog المفوض غير جاهز للفحص التلقائي.");
  }
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const summary: CatalogAutomationSummary = { discovered: 0, draftsCreated: 0, existing: 0, failed: 0, operationalCopiesCreated: 0 };
  const knownProducts = await db.select({ id: products.id, productCode: products.productCode }).from(products);
  const productByCode = new Map(knownProducts.map(product => [product.productCode, product]));
  const groups = (await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: connection.selectedFolderId })).filter(item => item.kind === "folder");

  for (const group of groups) {
    const folders = (await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: group.id })).filter(item => item.kind === "folder");
    for (const folder of folders) {
      summary.discovered += 1;
      const source = sourceReference(group.name, folder.name);
      try {
        const contents = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: folder.id });
        const images = contents.filter(isImage);
        const metadataFile = contents.find(item => item.kind === "file" && item.name.toLowerCase() === "product.txt");
        const metadataText = metadataFile ? await readCatalogTextFile({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, fileId: metadataFile.id }) : null;
        const existingProduct = productByCode.get(folder.name);
        const [priorFolder] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.ownerUserId, ownerUserId), eq(catalogFolderImports.productFolderId, folder.id))).limit(1);
        if (!existingProduct && priorFolder?.lastError === "deleted_by_user") {
          await upsertFolderObservation({ ownerUserId, productFolderId: folder.id, groupName: group.name, productCode: folder.name, source, state: "needs_review", linkedProductId: null, missingFields: [], imageCount: images.length, lastError: "deleted_by_user" });
          summary.existing += 1;
          continue;
        }
        if (existingProduct) {
          const preserveDraftState = priorFolder?.linkedProductId === existingProduct.id;
          await upsertFolderObservation({
            ownerUserId,
            productFolderId: folder.id,
            groupName: group.name,
            productCode: folder.name,
            source,
            state: preserveDraftState ? "draft_created" : "already_exists",
            linkedProductId: existingProduct.id,
            imageCount: images.length,
            missingFields: preserveDraftState ? JSON.parse(priorFolder?.missingFields ?? "[]") : [],
          });
          await ensureAutomaticColorSuggestion({ db, productId: existingProduct.id, actorUserId: ownerUserId });
          summary.existing += 1;
          continue;
        }
        const created = await createDraftFromFolder({ ownerUserId, groupName: group.name, folder, images, metadataText });
        productByCode.set(folder.name, { id: created.productId, productCode: folder.name });
        await upsertFolderObservation({ ownerUserId, productFolderId: folder.id, groupName: group.name, productCode: folder.name, source, state: "draft_created", linkedProductId: created.productId, missingFields: created.missingFields, imageCount: images.length });
        summary.draftsCreated += 1;
        if (images.length > 0) {
          const copies = await generateOperationalMediaForProduct({ userId: ownerUserId, productId: created.productId });
          summary.operationalCopiesCreated += copies.created.length;
          await ensureAutomaticColorSuggestion({ db, productId: created.productId, actorUserId: ownerUserId });
        }
      } catch (error) {
        summary.failed += 1;
        await upsertFolderObservation({
          ownerUserId,
          productFolderId: folder.id,
          groupName: group.name,
          productCode: folder.name,
          source,
          state: "failed",
          imageCount: 0,
          lastError: error instanceof Error ? error.message : "تعذر فحص مجلد المنتج.",
        });
      }
    }
  }
  return summary;
}

export async function listDeletedCatalogProducts(ownerUserId: number) {
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
  }).from(catalogFolderImports).where(and(eq(catalogFolderImports.ownerUserId, ownerUserId), eq(catalogFolderImports.lastError, "deleted_by_user"))).orderBy(desc(catalogFolderImports.lastScannedAt));
}

export async function restoreDeletedCatalogProduct(input: { ownerUserId: number; productFolderId: string }) {
  const connection = await getUsableCatalogConnection(input.ownerUserId);
  if (!connection || connection.status !== "catalog_selected" || !connection.selectedDriveId || !connection.selectedFolderId) throw new Error("مرجع Catalog المفوض غير جاهز للاستعادة.");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [deleted] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.ownerUserId, input.ownerUserId), eq(catalogFolderImports.productFolderId, input.productFolderId), eq(catalogFolderImports.lastError, "deleted_by_user"))).limit(1);
  if (!deleted) throw new Error("لا يوجد منتج محذوف قابل للاستعادة بهذا المرجع.");
  const [existing] = await db.select().from(products).where(eq(products.productCode, deleted.productCode)).limit(1);
  if (existing) throw new Error("المنتج موجود بالفعل داخل المنصة؛ لا يحتاج إلى استعادة.");

  const groups = (await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: connection.selectedFolderId })).filter(item => item.kind === "folder");
  const group = groups.find(item => item.name === deleted.groupName);
  if (!group) throw new Error("لم تعد مجموعة المنتج موجودة في Catalog.");
  const folders = (await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: group.id })).filter(item => item.kind === "folder");
  const folder = folders.find(item => item.id === deleted.productFolderId);
  if (!folder) throw new Error("لم يعد مجلد المنتج موجودًا في Catalog.");
  const contents = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: folder.id });
  const images = contents.filter(isImage);
  const metadataFile = contents.find(item => item.kind === "file" && item.name.toLowerCase() === "product.txt");
  const metadataText = metadataFile ? await readCatalogTextFile({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, fileId: metadataFile.id }) : null;
  const created = await createDraftFromFolder({ ownerUserId: input.ownerUserId, groupName: group.name, folder, images, metadataText });
  await upsertFolderObservation({ ownerUserId: input.ownerUserId, productFolderId: folder.id, groupName: group.name, productCode: folder.name, source: sourceReference(group.name, folder.name), state: "draft_created", linkedProductId: created.productId, missingFields: created.missingFields, imageCount: images.length, lastError: null });
  let operationalCopiesCreated = 0;
  if (images.length > 0) {
    const copies = await generateOperationalMediaForProduct({ userId: input.ownerUserId, productId: created.productId });
    operationalCopiesCreated = copies.created.length;
    if (operationalCopiesCreated !== images.length) throw new Error(`استُعيدت ${operationalCopiesCreated} من أصل ${images.length} صورة فقط؛ لم تكتمل الاستعادة.`);
    const freshDb = await getDb();
    if (freshDb) await ensureAutomaticColorSuggestion({ db: freshDb, productId: created.productId, actorUserId: input.ownerUserId });
  }
  const freshDb = await getDb();
  if (freshDb) await freshDb.insert(productOperations).values({ productId: created.productId, actorUserId: input.ownerUserId, source: "products_ui", action: "restored_from_catalog", changes: JSON.stringify({ productFolderId: folder.id, sourceReference: sourceReference(group.name, folder.name) }) });
  return { productId: created.productId, productCode: folder.name, state: "draft" as const, imageCount: images.length, operationalCopiesCreated };
}
