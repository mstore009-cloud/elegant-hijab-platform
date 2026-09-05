import type { CatalogDriveItem } from "./catalog";
import { parseCatalogProductMetadata, type CatalogProductMetadata } from "./productMetadata";

export type CatalogGroupPreviewEntry = {
  productFolderId: string;
  productCode: string;
  state: "ready" | "already_exists" | "invalid";
  selectable: boolean;
  sourceReference: string;
  metadata: {
    name: CatalogProductMetadata["name"];
    sellingPrice: CatalogProductMetadata["sellingPrice"];
    previousPrice: string | null;
    description: CatalogProductMetadata["description"];
    sizes: CatalogProductMetadata["sizes"];
  } | null;
  imageCount: number;
  documentCount: number;
  problems: string[];
};

const isImageFile = (item: CatalogDriveItem) => item.kind === "file" && /\.(jpg|jpeg|png|webp)$/i.test(item.name);
const isVideoFile = (item: CatalogDriveItem) => item.kind === "file" && /\.(mp4|mov|m4v|webm)$/i.test(item.name);

type DiscoveredProductFolder = { folder: CatalogDriveItem; contents: CatalogDriveItem[]; sourceReference: string };

async function discoverProductFolders(input: { groupName: string; folders: CatalogDriveItem[]; readFolderContents: (folderId: string) => Promise<CatalogDriveItem[]> }) {
  const discovered: DiscoveredProductFolder[] = [];
  const visited = new Set<string>();
  const visit = async (folder: CatalogDriveItem, categoryPath: string): Promise<void> => {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    const contents = await input.readFolderContents(folder.id);
    const hasProductMarker = contents.some(item => item.kind === "file" && (["product.txt", "product.docx"].includes(item.name.toLowerCase()) || isImageFile(item) || isVideoFile(item)));
    if (hasProductMarker) {
      discovered.push({ folder, contents, sourceReference: `Catalog/${categoryPath}/${folder.name}` });
      return;
    }
    for (const child of contents.filter(item => item.kind === "folder")) await visit(child, `${categoryPath}/${folder.name}`);
  };
  for (const folder of input.folders.filter(item => item.kind === "folder")) await visit(folder, input.groupName);
  return discovered;
}

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
  readMetadataDocx?: (fileId: string) => Promise<CatalogProductMetadata>;
}): Promise<CatalogGroupPreviewEntry[]> {
  const folders = await discoverProductFolders({ groupName: input.groupName, folders: input.productFolders, readFolderContents: input.readFolderContents });
  const results: CatalogGroupPreviewEntry[] = [];
  const concurrency = 3;

  for (let index = 0; index < folders.length; index += concurrency) {
    const batch = folders.slice(index, index + concurrency);
    const inspected = await Promise.all(batch.map(async discoveredFolder => {
      const productFolder = discoveredFolder.folder;
      const sourceReference = discoveredFolder.sourceReference;
      try {
        const contents = discoveredFolder.contents;
        const metadataFile = contents.find(item => item.kind === "file" && ["product.txt", "product.docx"].includes(item.name.toLowerCase()));
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
            problems: ["ملف product.txt أو product.docx غير موجود."],
          };
        }
        const metadata = metadataFile.name.toLowerCase() === "product.docx"
          ? await input.readMetadataDocx?.(metadataFile.id)
          : parseCatalogProductMetadata(await input.readMetadataText(metadataFile.id));
        if (!metadata) throw new Error("تعذر قراءة product.docx لأن مسار المحول غير متاح.");
        if (input.existingProductCodes.has(productFolder.name)) {
          return {
            productFolderId: productFolder.id,
            productCode: productFolder.name,
            state: "already_exists" as const,
            selectable: false,
            sourceReference,
            metadata: { name: metadata.name, sellingPrice: metadata.sellingPrice, previousPrice: metadata.previousPrice ?? null, description: metadata.description, sizes: metadata.sizes },
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
          metadata: { name: metadata.name, sellingPrice: metadata.sellingPrice, previousPrice: metadata.previousPrice ?? null, description: metadata.description, sizes: metadata.sizes },
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
