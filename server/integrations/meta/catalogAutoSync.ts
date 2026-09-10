import { and, asc, desc, eq, inArray, lte, or } from "drizzle-orm";
import { catalogSyncSettings, metaAssets, metaCatalogAutoSyncQueue, products } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { createHeartbeatJob } from "../../_core/heartbeat";
import { ENV } from "../../_core/env";
import { runMetaCatalogExport } from "./catalogExportDb";
import { getOrCreateCatalogSyncSettings } from "../../products/catalogSyncSettings";

const MAX_AUTO_SYNC_PRODUCTS = 250;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5 * 60_000;
const IN_PROGRESS_DELAY_MS = 2 * 60_000;

function nextAttemptAt(delayMs: number) {
  return new Date(Date.now() + delayMs);
}

export async function enqueueMetaCatalogAutoSync(input: {
  storeId: number;
  productIds: number[];
  requestedByUserId?: number | null;
  sessionToken?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const productIds = Array.from(new Set(input.productIds.filter(Number.isInteger)));
  for (const productId of productIds) {
    await db.insert(metaCatalogAutoSyncQueue).values({
      storeId: input.storeId,
      productId,
      status: "pending",
      requestedByUserId: input.requestedByUserId ?? null,
      requestedAt: new Date(),
      nextAttemptAt: null,
      completedAt: null,
      lastError: null,
    }).onDuplicateKeyUpdate({ set: {
      status: "pending",
      requestedByUserId: input.requestedByUserId ?? null,
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      nextAttemptAt: null,
      lastError: null,
    } });
  }
  if (productIds.length && ENV.isProduction && input.sessionToken) {
    await ensureMetaCatalogAutoSyncSchedule({ storeId: input.storeId, ownerUserId: input.requestedByUserId ?? undefined, sessionToken: input.sessionToken });
  }
  return { queued: productIds.length };
}

export async function enqueueAllActiveProductsForMetaCatalog(input: {
  storeId: number;
  requestedByUserId?: number | null;
  sessionToken?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const rows = await db.select({ id: products.id }).from(products).where(and(eq(products.storeId, input.storeId), eq(products.status, "active")));
  return enqueueMetaCatalogAutoSync({ ...input, productIds: rows.map(row => row.id) });
}

export async function ensureMetaCatalogAutoSyncSchedule(input: { storeId: number; ownerUserId?: number; sessionToken: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const setting = await getOrCreateCatalogSyncSettings({ ownerUserId: input.ownerUserId ?? 0, storeId: input.storeId });
  if (setting.metaAutoSyncTaskUid && setting.metaAutoSyncEnabled) return { taskUid: setting.metaAutoSyncTaskUid, created: false as const };
  const created = await createHeartbeatJob({
    name: `meta-catalog-auto-sync-${input.storeId}`,
    cron: "0 * * * * *",
    path: "/api/scheduled/meta-catalog-auto-sync",
    description: "مزامنة منتجات Meta المعدّلة تلقائيًا كل دقيقة.",
  }, input.sessionToken);
  await db.update(catalogSyncSettings).set({ metaAutoSyncTaskUid: created.taskUid, metaAutoSyncEnabled: true }).where(eq(catalogSyncSettings.id, setting.id));
  return { taskUid: created.taskUid, nextExecutionAt: created.nextExecutionAt ?? null, created: true as const };
}

async function claimPendingRows(storeId: number, limit: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const now = new Date();
  const candidates = await db.select({ queueId: metaCatalogAutoSyncQueue.id, productId: metaCatalogAutoSyncQueue.productId, attemptCount: metaCatalogAutoSyncQueue.attemptCount })
    .from(metaCatalogAutoSyncQueue)
    .innerJoin(products, eq(products.id, metaCatalogAutoSyncQueue.productId))
    .where(and(
      eq(metaCatalogAutoSyncQueue.storeId, storeId),
      eq(products.status, "active"),
      or(eq(metaCatalogAutoSyncQueue.status, "pending"), and(eq(metaCatalogAutoSyncQueue.status, "failed"), lte(metaCatalogAutoSyncQueue.nextAttemptAt, now))),
    ))
    .orderBy(asc(metaCatalogAutoSyncQueue.requestedAt))
    .limit(limit);
  const claimed: typeof candidates = [];
  for (const candidate of candidates) {
    const result = await db.update(metaCatalogAutoSyncQueue).set({ status: "processing", startedAt: now, attemptCount: candidate.attemptCount + 1, lastError: null }).where(and(eq(metaCatalogAutoSyncQueue.id, candidate.queueId), or(eq(metaCatalogAutoSyncQueue.status, "pending"), eq(metaCatalogAutoSyncQueue.status, "failed"))));
    if (Number((result as any)[0]?.affectedRows ?? 0) === 1) claimed.push(candidate);
  }
  return claimed;
}

async function markQueueFailure(queueId: number, attemptCount: number, message: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(metaCatalogAutoSyncQueue).set({
    status: "failed",
    completedAt: new Date(),
    nextAttemptAt: attemptCount < MAX_ATTEMPTS ? nextAttemptAt(RETRY_DELAY_MS) : null,
    lastError: message.slice(0, 500),
  }).where(eq(metaCatalogAutoSyncQueue.id, queueId));
}

export async function processMetaCatalogAutoSync(input: { storeId: number; maxProducts?: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [setting] = await db.select({ ownerUserId: catalogSyncSettings.ownerUserId }).from(catalogSyncSettings).where(eq(catalogSyncSettings.storeId, input.storeId)).limit(1);
  const [asset] = await db.select({ id: metaAssets.id }).from(metaAssets).where(and(eq(metaAssets.storeId, input.storeId), eq(metaAssets.assetType, "catalog"), eq(metaAssets.isSelected, true))).orderBy(desc(metaAssets.lastDiscoveredAt)).limit(1);
  const claimed = await claimPendingRows(input.storeId, Math.min(input.maxProducts ?? MAX_AUTO_SYNC_PRODUCTS, MAX_AUTO_SYNC_PRODUCTS));
  if (!claimed.length) return { queued: 0, completed: 0, failed: 0, deferred: 0 };
  if (!asset || !setting) {
    for (const row of claimed) await markQueueFailure(row.queueId, row.attemptCount + 1, "لم يتم تحديد أصل Meta Catalog أو إعداد المزامنة للمتجر.");
    return { queued: claimed.length, completed: 0, failed: claimed.length, deferred: 0 };
  }
  const productIds = claimed.map(row => row.productId);
  try {
    const result = await runMetaCatalogExport({ storeId: input.storeId, catalogAssetId: asset.id, productIds, createdByUserId: setting.ownerUserId });
    if (["pending", "submitted", "processing"].includes(result.job.status)) {
      await db.update(metaCatalogAutoSyncQueue).set({ status: "pending", startedAt: null, nextAttemptAt: nextAttemptAt(IN_PROGRESS_DELAY_MS), lastError: "تنتظر Meta اكتمال الدفعة السابقة." }).where(inArray(metaCatalogAutoSyncQueue.id, claimed.map(row => row.queueId)));
      return { queued: claimed.length, completed: 0, failed: 0, deferred: claimed.length };
    }
    if (result.job.status !== "completed") {
      const message = result.job.lastError ?? "اكتملت المزامنة جزئيًا وتحتاج إلى إعادة المحاولة.";
      for (const row of claimed) await markQueueFailure(row.queueId, row.attemptCount + 1, message);
      return { queued: claimed.length, completed: 0, failed: claimed.length, deferred: 0 };
    }
    const syncedAt = new Date();
    await db.update(metaCatalogAutoSyncQueue).set({ status: "completed", completedAt: syncedAt, nextAttemptAt: null, lastError: null }).where(inArray(metaCatalogAutoSyncQueue.id, claimed.map(row => row.queueId)));
    await db.update(products).set({ lastMetaCatalogSyncAt: syncedAt }).where(inArray(products.id, productIds));
    return { queued: claimed.length, completed: claimed.length, failed: 0, deferred: 0, exportJobId: result.job.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشلت مزامنة Meta التلقائية.";
    for (const row of claimed) await markQueueFailure(row.queueId, row.attemptCount + 1, message);
    return { queued: claimed.length, completed: 0, failed: claimed.length, deferred: 0, error: message };
  }
}

export async function getMetaCatalogAutoSyncStatus(input: { storeId: number; productIds?: number[] }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const filters = [eq(metaCatalogAutoSyncQueue.storeId, input.storeId), ...(input.productIds?.length ? [inArray(metaCatalogAutoSyncQueue.productId, input.productIds)] : [])];
  return db.select().from(metaCatalogAutoSyncQueue).where(and(...filters)).orderBy(desc(metaCatalogAutoSyncQueue.updatedAt)).limit(250);
}
