import type { CatalogDriveItem } from "./catalog";
import { parseCatalogProductMetadata, type CatalogProductMetadata } from "./productMetadata";

export type CatalogGroupPreviewEntry = {
  productFolderId: string;
  productCode: string;
  state: "ready" | "already_exists" | "invalid";
  selectable: boolean;
  sourceReference: string;
  metadata: Pick<CatalogProductMetadata, "name" | "sellingPrice" | "description" | "sizes"> | null;
  imageCount: number;
  documentCount: number;
  problems: string[];
};

const isImageFile = (item: CatalogDriveItem) => item.kind === "file" && /\.(jpg|jpeg|png|webp)$/i.test(item.name);

/**
 * Scans product folders without downloading original images or creating any row.
 * Each folder is isolated so one malformed product never hides the rest.
 */
export async function previewCatalogGroupProducts(input: {
  groupName: string;
  productFolders: CatalogDriveItem[];
  existingProductCodes: Set<string>;
  readFolderContents: (folderId: string) => Promise<CatalogDriveItem[]>;
  readMetadataText: (fileId: string) => Promise<string>;
}): Promise<CatalogGroupPreviewEntry[]> {
  const folders = input.productFolders.filter(item => item.kind === "folder");
  const results: CatalogGroupPreviewEntry[] = [];
  const concurrency = 3;

  for (let index = 0; index < folders.length; index += concurrency) {
    const batch = folders.slice(index, index + concurrency);
    const inspected = await Promise.all(batch.map(async productFolder => {
      const sourceReference = `Catalog/${input.groupName}/${productFolder.name}`;
      try {
        const contents = await input.readFolderContents(productFolder.id);
        const metadataFile = contents.find(item => item.kind === "file" && item.name.toLowerCase() === "product.txt");
        const images = contents.filter(isImageFile);
        const documentCount = contents.filter(item => item.kind === "file" && item.id !== metadataFile?.id && !isImageFile(item)).length;
        if (!metadataFile) {
          return {
            productFolderId: productFolder.id,
            productCode: productFolder.name,
            state: "invalid" as const,
            selectable: false,
            sourceReference,
            metadata: null,
            imageCount: images.length,
            documentCount,
            problems: ["ملف product.txt غير موجود."],
          };
        }
        const metadata = parseCatalogProductMetadata(await input.readMetadataText(metadataFile.id));
        if (input.existingProductCodes.has(productFolder.name)) {
          return {
            productFolderId: productFolder.id,
            productCode: productFolder.name,
            state: "already_exists" as const,
            selectable: false,
            sourceReference,
            metadata: { name: metadata.name, sellingPrice: metadata.sellingPrice, description: metadata.description, sizes: metadata.sizes },
            imageCount: images.length,
            documentCount,
            problems: ["يوجد منتج بالرمز نفسه داخل المنصة؛ لن ينشئ النظام تكرارًا."],
          };
        }
        return {
          productFolderId: productFolder.id,
          productCode: productFolder.name,
          state: "ready" as const,
          selectable: true,
          sourceReference,
          metadata: { name: metadata.name, sellingPrice: metadata.sellingPrice, description: metadata.description, sizes: metadata.sizes },
          imageCount: images.length,
          documentCount,
          problems: [],
        };
      } catch (error) {
        return {
          productFolderId: productFolder.id,
          productCode: productFolder.name,
          state: "invalid" as const,
          selectable: false,
          sourceReference,
          metadata: null,
          imageCount: 0,
          documentCount: 0,
          problems: [error instanceof Error ? error.message : "تعذر فحص مجلد المنتج."],
        };
      }
    }));
    results.push(...inspected);
  }

  return results;
}

export type CatalogSelectedDraftResult = {
  productFolderId: string;
  productCode: string;
  state: "created" | "already_exists" | "rejected";
  message: string;
};

/**
 * Creates drafts only from entries that were already validated in the latest
 * preview. It receives no image bytes, colors, inventory, or publishing state.
 */
export async function createSelectedCatalogDrafts(input: {
  entries: CatalogGroupPreviewEntry[];
  selectedFolderIds: string[];
  createDraft: (entry: CatalogGroupPreviewEntry & { metadata: NonNullable<CatalogGroupPreviewEntry["metadata"]> }) => Promise<{ created: boolean }>;
}): Promise<CatalogSelectedDraftResult[]> {
  const byFolderId = new Map(input.entries.map(entry => [entry.productFolderId, entry]));
  const results: CatalogSelectedDraftResult[] = [];
  for (const productFolderId of input.selectedFolderIds) {
    const entry = byFolderId.get(productFolderId);
    if (!entry || !entry.selectable || !entry.metadata) {
      results.push({
        productFolderId,
        productCode: entry?.productCode ?? "غير معروف",
        state: entry?.state === "already_exists" ? "already_exists" : "rejected",
        message: entry?.problems[0] ?? "هذا المجلد غير صالح لإنشاء مسودة.",
      });
      continue;
    }
    try {
      const outcome = await input.createDraft({ ...entry, metadata: entry.metadata });
      results.push({
        productFolderId,
        productCode: entry.productCode,
        state: outcome.created ? "created" : "already_exists",
        message: outcome.created ? "أنشئت مسودة فقط؛ لم تنشأ ألوان أو مخزون أو وسائط." : "المنتج موجود مسبقًا؛ لم ينشئ النظام تكرارًا.",
      });
    } catch (error) {
      results.push({
        productFolderId,
        productCode: entry.productCode,
        state: "rejected",
        message: error instanceof Error ? error.message : "تعذر إنشاء المسودة.",
      });
    }
  }
  return results;
}
