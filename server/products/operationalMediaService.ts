import { TRPCError } from "@trpc/server";
import { getUsableCatalogConnection } from "../integrations/onedrive/catalogAuth";
import { listCatalogChildren, readCatalogOriginalImageBytes } from "../integrations/onedrive/catalog";
import { createOperationalImageDerivative } from "../integrations/onedrive/operationalMedia";
import { storagePut } from "../storage";
import { getProductMedia, getProductWithVariants, saveOperationalMediaCopy } from "./db";

export async function generateOperationalMediaForProduct(input: { userId: number; productId: number }) {
  const item = await getProductWithVariants(input.productId);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "المنتج غير موجود." });
  const media = await getProductMedia(input.productId);
  const candidates = media.filter(entry => entry.source === "onedrive" && entry.originalFileName && !entry.storageKey);
  if (candidates.length === 0) return { created: [], skipped: media.filter(entry => entry.storageKey).map(entry => entry.id) };

  const connection = await getUsableCatalogConnection(input.userId);
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
    const original = await readCatalogOriginalImageBytes({ encryptedAccessToken: connection.encryptedAccessToken, driveId, fileId: sourceFile.id });
    const derivative = await createOperationalImageDerivative(original.bytes);
    const variantSegment = entry.variantId ? String(entry.variantId) : "unassigned";
    const uploaded = await storagePut(`products/${item.product.id}/operational/${variantSegment}/${entry.id}.webp`, derivative.bytes, "image/webp");
    await saveOperationalMediaCopy({
      mediaId: entry.id,
      storageKey: uploaded.key,
      metadata: { ...derivative.metadata, sourceFileId: sourceFile.id, sourceMimeType: original.mimeType },
    });
    created.push({ mediaId: entry.id, storageKey: uploaded.key, outputBytes: derivative.metadata.outputBytes });
  }
  return { created, skipped: [] as number[], originalFilesModified: false as const };
}
