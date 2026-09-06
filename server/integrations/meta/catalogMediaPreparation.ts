import sharp from "sharp";
import { listCatalogChildren, readCatalogOriginalImageBytes, readCatalogOriginalVideoBytes } from "../onedrive/catalog";
import { getUsableCatalogConnection } from "../onedrive/catalogAuth";
import { getCatalogProductFolderId, getProductMedia, getProductWithVariants, saveMetaCatalogMediaCopy } from "../../products/db";
import { storageGet, storagePut } from "../../storage";

const MAX_META_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_META_VIDEO_BYTES = 200 * 1024 * 1024;

type Prepared = { mediaId: number; storageKey: string; mediaType: "image" | "video"; source: "onedrive_original" | "manual_fallback" | "catalog_existing" };
type Skipped = { mediaId: number; reason: string };

function extensionFromMime(mimeType: string, fallback: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "video/mp4") return "mp4";
  return fallback;
}

async function catalogImageBytes(input: { bytes: Buffer; mimeType: string }) {
  const metadata = await sharp(input.bytes, { failOn: "none" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 500 || height < 500) throw new Error("دقة الصورة أقل من الحد الأدنى 500 × 500 لكتالوج Meta.");
  const compatibleOriginal = ["image/jpeg", "image/png"].includes(input.mimeType) && input.bytes.length <= MAX_META_IMAGE_BYTES;
  if (compatibleOriginal) return { bytes: input.bytes, mimeType: input.mimeType, extension: extensionFromMime(input.mimeType, "jpg"), sourceRendition: "onedrive_original" as const, width, height };
  const converted = await sharp(input.bytes, { failOn: "none" })
    .rotate()
    .resize({ width: 2400, height: 3000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  if (converted.data.length > MAX_META_IMAGE_BYTES) throw new Error("تعذر تجهيز صورة Catalog بحجم لا يتجاوز 8 ميغابايت.");
  return { bytes: converted.data, mimeType: "image/jpeg", extension: "jpg", sourceRendition: "catalog_high_quality_jpeg" as const, width: converted.info.width, height: converted.info.height };
}

async function readManualCatalogImage(storageKey: string) {
  const url = (await storageGet(storageKey)).url;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("تعذر قراءة الصورة اليدوية الأصلية لإعداد Catalog.");
  return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type")?.split(";")[0] || "image/webp" };
}

export async function prepareMetaCatalogMediaForProduct(input: { storeId: number; productId: number; actorUserId: number }) {
  const item = await getProductWithVariants(input.productId, input.storeId);
  if (!item) throw new Error("المنتج غير موجود في متجرك التشغيلي.");
  const media = await getProductMedia(input.productId);
  const prepared: Prepared[] = [];
  const skipped: Skipped[] = [];
  const onedriveCandidates = media.filter(entry => entry.source === "onedrive" && ["image", "video"].includes(entry.mediaType) && entry.originalFileName);
  let byName = new Map<string, Awaited<ReturnType<typeof listCatalogChildren>>[number]>();
  let connection: Awaited<ReturnType<typeof getUsableCatalogConnection>> | null = null;
  if (onedriveCandidates.length) {
    connection = await getUsableCatalogConnection(input.storeId);
    const folderId = await getCatalogProductFolderId({ productId: input.productId, storeId: input.storeId });
    if (!connection?.selectedDriveId || !folderId) throw new Error("لا يتوفر مرجع OneDrive لنسخ وسائط Catalog الأصلية.");
    const sourceFiles = await listCatalogChildren({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, folderId });
    byName = new Map(sourceFiles.map(file => [file.name, file]));
  }
  for (const entry of media.filter(entry => ["image", "video"].includes(entry.mediaType))) {
    let existingCatalogKey: string | null = null;
    try {
      const parsed = JSON.parse(entry.operationalMetadata ?? "{}");
      existingCatalogKey = typeof parsed?.metaCatalog?.storageKey === "string" ? parsed.metaCatalog.storageKey : null;
    } catch { /* A legacy malformed metadata field can be replaced safely. */ }
    if (existingCatalogKey) {
      prepared.push({ mediaId: entry.id, storageKey: existingCatalogKey, mediaType: entry.mediaType as "image" | "video", source: "catalog_existing" });
      continue;
    }
    try {
      if (entry.mediaType === "image") {
        const original = entry.source === "onedrive"
          ? await (async () => {
              const sourceFile = byName.get(entry.originalFileName ?? "");
              if (!sourceFile || sourceFile.kind !== "file" || !connection?.selectedDriveId) throw new Error(`لم توجد الصورة ${entry.originalFileName ?? ""} في OneDrive.`);
              return readCatalogOriginalImageBytes({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, fileId: sourceFile.id });
            })()
          : entry.storageKey ? await readManualCatalogImage(entry.storageKey) : null;
        if (!original) throw new Error("لا توجد نسخة مصدر قابلة لتهيئة صورة Catalog.");
        const converted = await catalogImageBytes({ bytes: original.bytes, mimeType: original.mimeType });
        const uploaded = await storagePut(`products/${item.product.id}/meta-catalog/image/${entry.id}.${converted.extension}`, converted.bytes, converted.mimeType);
        await saveMetaCatalogMediaCopy({ mediaId: entry.id, storageKey: uploaded.key, metadata: { mimeType: converted.mimeType, sourceRendition: converted.sourceRendition, width: converted.width, height: converted.height, outputBytes: converted.bytes.length }, createdByUserId: input.actorUserId });
        prepared.push({ mediaId: entry.id, storageKey: uploaded.key, mediaType: "image", source: entry.source === "onedrive" ? "onedrive_original" : "manual_fallback" });
      } else {
        if (entry.source !== "onedrive") {
          if (!entry.storageKey) throw new Error("لا توجد نسخة فيديو قابلة لتهيئة Catalog.");
          await saveMetaCatalogMediaCopy({ mediaId: entry.id, storageKey: entry.storageKey, metadata: { mimeType: "video/*", sourceRendition: "manual_fallback" }, createdByUserId: input.actorUserId });
          prepared.push({ mediaId: entry.id, storageKey: entry.storageKey, mediaType: "video", source: "manual_fallback" });
          continue;
        }
        const sourceFile = byName.get(entry.originalFileName ?? "");
        if (!sourceFile || sourceFile.kind !== "file" || !connection?.selectedDriveId) throw new Error(`لم يوجد الفيديو ${entry.originalFileName ?? ""} في OneDrive.`);
        const original = await readCatalogOriginalVideoBytes({ encryptedAccessToken: connection.encryptedAccessToken, driveId: connection.selectedDriveId, fileId: sourceFile.id });
        if (original.bytes.length > MAX_META_VIDEO_BYTES) throw new Error("حجم فيديو Catalog أكبر من الحد المسموح 200 ميغابايت.");
        const extension = entry.originalFileName?.split(".").pop()?.toLowerCase() || extensionFromMime(original.mimeType, "mp4");
        const uploaded = await storagePut(`products/${item.product.id}/meta-catalog/video/${entry.id}.${extension}`, original.bytes, original.mimeType);
        await saveMetaCatalogMediaCopy({ mediaId: entry.id, storageKey: uploaded.key, metadata: { mimeType: original.mimeType, sourceRendition: "onedrive_original", outputBytes: original.bytes.length }, createdByUserId: input.actorUserId });
        prepared.push({ mediaId: entry.id, storageKey: uploaded.key, mediaType: "video", source: "onedrive_original" });
      }
    } catch (error) {
      skipped.push({ mediaId: entry.id, reason: error instanceof Error ? error.message : "تعذر تجهيز وسيط Catalog." });
    }
  }
  return { productId: item.product.id, prepared, skipped };
}

export async function prepareMetaCatalogMediaForStore(input: { storeId: number; productIds: number[]; actorUserId: number }) {
  const results = [] as Array<Awaited<ReturnType<typeof prepareMetaCatalogMediaForProduct>>>;
  for (const productId of Array.from(new Set(input.productIds))) results.push(await prepareMetaCatalogMediaForProduct({ ...input, productId }));
  return {
    products: results.length,
    prepared: results.flatMap(result => result.prepared),
    skipped: results.flatMap(result => result.skipped.map(entry => ({ productId: result.productId, ...entry }))),
  };
}
