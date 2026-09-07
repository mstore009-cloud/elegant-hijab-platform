import { and, desc, eq, inArray } from "drizzle-orm";
import { metaCatalogSourceUpdates, products } from "../../../drizzle/schema";
import { getDb } from "../../db";

export type CatalogSourceChange = {
  kind: "media_added" | "media_removed" | "media_changed" | "metadata_changed";
  label: string;
  names?: string[];
  before?: string | null;
  after?: string | null;
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

function parseChanges(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is CatalogSourceChange => Boolean(item && typeof item === "object" && typeof (item as { kind?: unknown }).kind === "string" && typeof (item as { label?: unknown }).label === "string")) : [];
  } catch {
    return [];
  }
}

export async function upsertMetaCatalogSourceUpdate(input: {
  storeId: number;
  productId: number;
  catalogFolderId: number | null;
  sourceFingerprint: string;
  changes: CatalogSourceChange[];
}) {
  if (!input.changes.length) return null;
  const db = await requireDb();
  const values = {
    catalogFolderId: input.catalogFolderId,
    status: "pending_review" as const,
    sourceFingerprint: input.sourceFingerprint,
    changesJson: JSON.stringify(input.changes),
    exportJobId: null,
    detectedAt: new Date(),
    reviewedAt: null,
    exportedAt: null,
  };
  await db.insert(metaCatalogSourceUpdates).values({ storeId: input.storeId, productId: input.productId, ...values }).onDuplicateKeyUpdate({ set: values });
  return getMetaCatalogSourceUpdate({ storeId: input.storeId, productId: input.productId });
}

export async function getMetaCatalogSourceUpdate(input: { storeId: number; productId: number }) {
  const db = await requireDb();
  const [row] = await db.select().from(metaCatalogSourceUpdates).where(and(eq(metaCatalogSourceUpdates.storeId, input.storeId), eq(metaCatalogSourceUpdates.productId, input.productId))).limit(1);
  return row ? { ...row, changes: parseChanges(row.changesJson) } : null;
}

export async function listMetaCatalogSourceUpdates(input: { storeId: number; productIds?: number[] }) {
  const db = await requireDb();
  const ids = input.productIds ? Array.from(new Set(input.productIds)) : null;
  const rows = await db.select({
    id: metaCatalogSourceUpdates.id,
    productId: metaCatalogSourceUpdates.productId,
    status: metaCatalogSourceUpdates.status,
    changesJson: metaCatalogSourceUpdates.changesJson,
    detectedAt: metaCatalogSourceUpdates.detectedAt,
    updatedAt: metaCatalogSourceUpdates.updatedAt,
    productCode: products.productCode,
    productName: products.name,
  }).from(metaCatalogSourceUpdates).innerJoin(products, eq(metaCatalogSourceUpdates.productId, products.id)).where(and(
    eq(metaCatalogSourceUpdates.storeId, input.storeId),
    ...(ids?.length ? [inArray(metaCatalogSourceUpdates.productId, ids)] : []),
  )).orderBy(desc(metaCatalogSourceUpdates.updatedAt));
  return rows.map(row => ({ ...row, changes: parseChanges(row.changesJson) }));
}

export async function markMetaCatalogSourceUpdateStatus(input: { storeId: number; productId: number; status: "media_prepared" | "dismissed" }) {
  const db = await requireDb();
  const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId))).limit(1);
  if (!product) throw new Error("المنتج غير موجود في متجرك التشغيلي.");
  await db.update(metaCatalogSourceUpdates).set({ status: input.status, reviewedAt: new Date() }).where(and(eq(metaCatalogSourceUpdates.storeId, input.storeId), eq(metaCatalogSourceUpdates.productId, input.productId)));
  return getMetaCatalogSourceUpdate(input);
}

export async function markMetaCatalogSourceUpdatesExported(input: { storeId: number; productIds: number[]; exportJobId: number }) {
  if (!input.productIds.length) return;
  const db = await requireDb();
  await db.update(metaCatalogSourceUpdates).set({ status: "exported", exportJobId: input.exportJobId, reviewedAt: new Date(), exportedAt: new Date() }).where(and(
    eq(metaCatalogSourceUpdates.storeId, input.storeId),
    inArray(metaCatalogSourceUpdates.productId, Array.from(new Set(input.productIds))),
  ));
}
