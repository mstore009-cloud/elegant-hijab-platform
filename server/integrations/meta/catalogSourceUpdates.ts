import { and, desc, eq, inArray } from "drizzle-orm";
import { metaCatalogSourceUpdates, productOperations, products } from "../../../drizzle/schema";
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

const sourceFieldByLabel: Record<string, "name" | "description" | "sellingPrice" | "previousPrice" | "material" | "sizeLabels"> = {
  "الاسم": "name",
  "الوصف": "description",
  "السعر": "sellingPrice",
  "السعر السابق": "previousPrice",
  "الخامة": "material",
  "القياسات": "sizeLabels",
};

function sourceValueForField(field: string, value: string | null) {
  if (field !== "sizeLabels") return value;
  if (!value) return JSON.stringify([]);
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(Array.isArray(parsed) ? parsed : [value]);
  } catch {
    return JSON.stringify([value]);
  }
}

export async function resolveMetaCatalogSourceUpdate(input: {
  storeId: number;
  productId: number;
  actorUserId: number;
  decisions: Array<{ kind: CatalogSourceChange["kind"]; label: string; decision: "source" | "platform" }>;
}) {
  const db = await requireDb();
  const [update] = await db.select().from(metaCatalogSourceUpdates).where(and(eq(metaCatalogSourceUpdates.storeId, input.storeId), eq(metaCatalogSourceUpdates.productId, input.productId))).limit(1);
  if (!update) throw new Error("لا يوجد تعارض مفتوح لهذا المنتج.");
  const changes = parseChanges(update.changesJson);
  const decisions = new Map(input.decisions.map(decision => [`${decision.kind}:${decision.label}`, decision.decision]));
  const acceptedSourceFields: string[] = [];
  const platformFields: string[] = [];
  const patch: Partial<typeof products.$inferInsert> = {};
  for (const change of changes) {
    if (change.kind !== "metadata_changed") continue;
    const field = sourceFieldByLabel[change.label];
    const decision = decisions.get(`${change.kind}:${change.label}`) ?? "platform";
    if (!field || decision === "platform") {
      platformFields.push(change.label);
      continue;
    }
    (patch as Record<string, unknown>)[field] = sourceValueForField(field, change.after ?? null);
    acceptedSourceFields.push(change.label);
  }
  await db.transaction(async tx => {
    if (Object.keys(patch).length) await tx.update(products).set(patch).where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId)));
    await tx.update(metaCatalogSourceUpdates).set({ status: "dismissed", reviewedAt: new Date() }).where(and(eq(metaCatalogSourceUpdates.id, update.id), eq(metaCatalogSourceUpdates.storeId, input.storeId)));
    await tx.insert(productOperations).values({
      productId: input.productId,
      actorUserId: input.actorUserId,
      source: "products_ui",
      action: "onedrive_conflict_resolved",
      changes: JSON.stringify({ sourceFieldsAccepted: acceptedSourceFields, platformFieldsKept: platformFields, mediaChangesReviewed: changes.filter(change => change.kind !== "metadata_changed").map(change => change.label) }),
    });
  });
  return { productId: input.productId, acceptedSourceFields, platformFieldsKept: platformFields };
}

export async function markMetaCatalogSourceUpdatesExported(input: { storeId: number; productIds: number[]; exportJobId: number }) {
  if (!input.productIds.length) return;
  const db = await requireDb();
  await db.update(metaCatalogSourceUpdates).set({ status: "exported", exportJobId: input.exportJobId, reviewedAt: new Date(), exportedAt: new Date() }).where(and(
    eq(metaCatalogSourceUpdates.storeId, input.storeId),
    inArray(metaCatalogSourceUpdates.productId, Array.from(new Set(input.productIds))),
  ));
}
