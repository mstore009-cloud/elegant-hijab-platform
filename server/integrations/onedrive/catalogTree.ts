import type { CatalogDriveItem } from "./catalog";

const METADATA_FILE = /^product\.(txt|docx)$/i;
const PRODUCT_MEDIA = /\.(avif|gif|jpe?g|mov|mp4|png|webp)$/i;
const PRODUCT_IMAGE = /\.(avif|gif|jpe?g|png|webp)$/i;

export type CatalogTreeNode = {
  folderId: string;
  name: string;
  path: string;
  depth: number;
  kind: "category" | "product" | "needs_review";
  metadataFileName: string | null;
  mediaFileCount: number;
  children: CatalogTreeNode[];
  warning: string | null;
};

export type CatalogTreeSummary = {
  categories: number;
  products: number;
  needsReview: number;
  scannedFolders: number;
  maxDepthReached: boolean;
};

export type CatalogTreeInspection = {
  root: CatalogTreeNode;
  summary: CatalogTreeSummary;
};

type ListChildren = (folderId: string) => Promise<CatalogDriveItem[]>;

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function classifyFolder(items: CatalogDriveItem[], hasSubfolders: boolean) {
  const metadata = items.find(item => item.kind === "file" && METADATA_FILE.test(item.name))?.name ?? null;
  const mediaFileCount = items.filter(item => item.kind === "file" && PRODUCT_MEDIA.test(item.name)).length;
  const imageFileCount = items.filter(item => item.kind === "file" && PRODUCT_IMAGE.test(item.name)).length;
  if (metadata && imageFileCount > 0) return { kind: "product" as const, metadataFileName: metadata, mediaFileCount, warning: null };
  if (hasSubfolders) return { kind: "category" as const, metadataFileName: metadata, mediaFileCount, warning: null };
  if (metadata || mediaFileCount > 0) {
    return {
      kind: "needs_review" as const,
      metadataFileName: metadata,
      mediaFileCount,
      warning: metadata ? "يحتاج هذا المجلد صورة صالحة ليُعامل كمنتج." : "يحتاج هذا المجلد ملف product.txt أو product.docx ليُعامل كمنتج.",
    };
  }
  return { kind: "needs_review" as const, metadataFileName: null, mediaFileCount: 0, warning: "المجلد فارغ أو لا يطابق بنية تصنيف أو منتج." };
}

/**
 * Reads folder names and file metadata only. It never downloads product media,
 * parses product metadata, or writes to OneDrive.
 */
export async function inspectCatalogTree(input: {
  rootFolderId: string;
  rootFolderName: string;
  listChildren: ListChildren;
  maxDepth?: number;
  maxFolders?: number;
}): Promise<CatalogTreeInspection> {
  const maxDepth = input.maxDepth ?? 8;
  const maxFolders = input.maxFolders ?? 150;
  const summary: CatalogTreeSummary = { categories: 0, products: 0, needsReview: 0, scannedFolders: 0, maxDepthReached: false };

  const visit = async (folderId: string, name: string, path: string, depth: number): Promise<CatalogTreeNode> => {
    if (summary.scannedFolders >= maxFolders) {
      summary.needsReview += 1;
      return { folderId, name, path, depth, kind: "needs_review", metadataFileName: null, mediaFileCount: 0, children: [], warning: `توقفت المعاينة عند حد ${maxFolders} مجلدًا.` };
    }
    summary.scannedFolders += 1;
    const items = await input.listChildren(folderId);
    const childFolders = items.filter(item => item.kind === "folder");
    const classification = classifyFolder(items, childFolders.length > 0);
    const node: CatalogTreeNode = { folderId, name, path, depth, ...classification, children: [] };

    if (node.kind === "product") {
      summary.products += 1;
      return node;
    }
    if (node.kind === "needs_review") {
      summary.needsReview += 1;
      return node;
    }
    summary.categories += 1;
    if (depth >= maxDepth) {
      summary.maxDepthReached = childFolders.length > 0;
      if (childFolders.length > 0) node.warning = `وصلت المعاينة إلى الحد الأقصى للعمق (${maxDepth}).`;
      return node;
    }
    node.children = await mapWithConcurrency(childFolders, 4, folder => visit(folder.id, folder.name, `${path}/${folder.name}`, depth + 1));
    node.children.sort((left, right) => left.name.localeCompare(right.name, "ar"));
    return node;
  };

  const root = await visit(input.rootFolderId, input.rootFolderName, input.rootFolderName, 0);
  return { root, summary };
}

export function flattenCategoryNodes(root: CatalogTreeNode) {
  const result: Array<Pick<CatalogTreeNode, "folderId" | "name" | "path" | "depth">> = [];
  const walk = (node: CatalogTreeNode) => {
    if (node.kind !== "category") return;
    if (node.depth > 0) result.push({ folderId: node.folderId, name: node.name, path: node.path, depth: node.depth });
    node.children.forEach(walk);
  };
  walk(root);
  return result;
}
