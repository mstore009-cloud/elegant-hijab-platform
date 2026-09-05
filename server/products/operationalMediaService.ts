import { TRPCError } from "@trpc/server";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { listCatalogChildren, readCatalogImageDataUrl, readCatalogOriginalImageBytes, readCatalogOriginalVideoBytes } from "../integrations/onedrive/catalog";
import { createOperationalImageDerivative } from "../integrations/onedrive/operationalMedia";
import { storagePut } from "../storage";
import { getProductMedia, getProductWithVariants, saveOperationalMediaCopy } from "./db";
import { selectForcedOperationalRegenerationCandidates, selectOperationalRegenerationCandidates } from "./operationalMediaLifecycle";

export async function generateOperationalMediaForProduct(input: { userId: number; productId: number }) {
  return materializeOperationalMediaForProduct({ ...input, lifecycleAction: "operational_copy_created" });
}

export async function generateOperationalVideosForProduct(input: { userId: number; productId: number }) {
  const item = await getProductWithVariants(input.productId);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
  const media = await getProductMedia(input.productId);
  const candidates = media.filter(entry => entry.source === "onedrive" && entry.mediaType === "video" && Boolean(entry.originalFileName) && !entry.storageKey);
  if (candidates.length === 0) return { created: [], skipped: media.filter(entry => entry.mediaType === "video" && entry.storageKey).map(entry => entry.id) };

  const connection = await getUsableCatalogConnection(item.product.storeId);
  if (!connection?.selectedDriveId || !connection.selectedFolderId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "مرجع Catalog غير متاح لإنشاء نسخ الفيديو التشغيلية." });
  const groups = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: connection.selectedFolderId });
  const group = groups.find(entry => entry.kind === "folder" && entry.name === item.product.category);
  if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "لم توجد مجموعة المنتج في Catalog." });
  const folders = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: group.id });
  const folder = folders.find(entry => entry.kind === "folder" && entry.name === item.product.productCode);
  if (!folder) throw new TRPCError({ code: "NOT_FOUND", message: "لم يوجد مجلد المنتج في Catalog." });
  const files = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId: folder.id });
  const byName = new Map(files.map(file => [file.name, file]));
  const created: Array<{ mediaId: number; storageKey: string; outputBytes: number }> = [];
  for (const entry of candidates) {
    const sourceFile = byName.get(entry.originalFileName!);
    if (!sourceFile || sourceFile.kind !== "file") throw new TRPCError({ code: "NOT_FOUND", message: `لم يوجد الفيديو ${entry.originalFileName} في Catalog.` });
    const original = await readCatalogOriginalVideoBytes({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, fileId: sourceFile.id });
    const extension = entry.originalFileName!.split(".").pop()?.toLowerCase() || "mp4";
    const uploaded = await storagePut(`products/${item.product.id}/operational/video/${entry.id}.${extension}`, original.bytes, original.mimeType);
    await saveOperationalMediaCopy({ mediaId: entry.id, storageKey: uploaded.key, metadata: { format: extension, outputBytes: original.bytes.length, sourceFileId: sourceFile.id, sourceMimeType: original.mimeType }, createdByUserId: input.userId, lifecycleAction: "operational_copy_created" });
    created.push({ mediaId: entry.id, storageKey: uploaded.key, outputBytes: original.bytes.length });
  }
  return { created, skipped: [] as number[], originalFilesModified: false as const };
}

export async function regenerateOperationalMediaForProduct(input: { userId: number; productId: number; mediaId?: number }) {
  return materializeOperationalMediaForProduct({ ...input, lifecycleAction: "operational_copy_regenerated", forceRegeneration: true });
}

async function readOperationalImageSource(input: { encryptedAccessToken: string; driveId: string; fileId: string }) {
  try {
    const dataUrl = await readCatalogImageDataUrl(input);
    const [header, payload] = dataUrl.split(",", 2);
    if (!header || !payload) throw new Error("تعذر تحضير مصغرة تشغيلية للصورة.");
    const mimeType = header.match(/^data:([^;]+);base64$/)?.[1] ?? "image/jpeg";
    return { bytes: Buffer.from(payload, "base64"), mimeType, sourceRendition: "onedrive_thumbnail_fallback" as const };
  } catch {
    const original = await readCatalogOriginalImageBytes(input);
    return { ...original, sourceRendition: "onedrive_original" as const };
  }
}

async function materializeOperationalMediaForProduct(input: {
  userId: number;
  productId: number;
  mediaId?: number;
  lifecycleAction: "operational_copy_created" | "operational_copy_regenerated";
  forceRegeneration?: boolean;
}) {
  const item = await getProductWithVariants(input.productId);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
  const media = await getProductMedia(input.productId);
  const candidates = input.forceRegeneration
    ? selectForcedOperationalRegenerationCandidates(media, input.mediaId)
    : selectOperationalRegenerationCandidates(media);
  if (candidates.length === 0) return { created: [], skipped: media.filter(entry => entry.storageKey).map(entry => entry.id) };

  const connection = await getUsableCatalogConnection(item.product.storeId);
  if (!connection?.selectedDriveId || !connection.selectedFolderId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "مرجع Catalog غير متاح لإنشاء النسخ التشغيلية." });
  }
  const driveId = connection.selectedDriveId;
  const groups = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId, folderId: connection.selectedFolderId });
  const group = groups.find(entry => entry.kind === "folder" && entry.name === item.product.category);
  if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "لم توجد مجموعة المنتج في Catalog." });
  const folders = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId, folderId: group.id });
  const productFolder = folders.find(entry => entry.kind === "folder" && entry.name === item.product.productCode);
  if (!productFolder) throw new TRPCError({ code: "NOT_FOUND", message: "لم يوجد مجلد المنتج في Catalog." });
  const sourceFiles = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId, folderId: productFolder.id });
  const byName = new Map(sourceFiles.map(file => [file.name, file]));
  const created = [] as Array<{ mediaId: number; storageKey: string; outputBytes: number }>;

  for (const entry of candidates) {
    const sourceFile = byName.get(entry.originalFileName!);
    if (!sourceFile || sourceFile.kind !== "file") {
      throw new TRPCError({ code: "NOT_FOUND", message: `لم توجد الصورة ${entry.originalFileName} في Catalog.` });
    }
    const original = await readOperationalImageSource({ encryptedAccessToken: connection.encryptedAccessToken, driveId, fileId: sourceFile.id });
    const derivative = await createOperationalImageDerivative(original.bytes);
    const variantSegment = entry.variantId ? String(entry.variantId) : "unassigned";
    const uploaded = await storagePut(`products/${item.product.id}/operational/${variantSegment}/${entry.id}.webp`, derivative.bytes, "image/webp");
    await saveOperationalMediaCopy({
      mediaId: entry.id,
      storageKey: uploaded.key,
      metadata: { ...derivative.metadata, sourceFileId: sourceFile.id, sourceMimeType: original.mimeType, sourceRendition: original.sourceRendition },
      createdByUserId: input.userId,
      lifecycleAction: input.lifecycleAction,
    });
    created.push({ mediaId: entry.id, storageKey: uploaded.key, outputBytes: derivative.metadata.outputBytes });
  }
  return { created, skipped: [] as number[], originalFilesModified: false as const };
}
