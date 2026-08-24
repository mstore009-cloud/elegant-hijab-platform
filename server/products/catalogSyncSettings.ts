import { eq } from "drizzle-orm";
import { catalogSyncSettings } from "../../drizzle/schema";
import { getDb } from "../db";

export async function getOrCreateCatalogSyncSettings(ownerUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [existing] = await db.select().from(catalogSyncSettings).where(eq(catalogSyncSettings.ownerUserId, ownerUserId)).limit(1);
  if (existing) return existing;
  const result = await db.insert(catalogSyncSettings).values({ ownerUserId });
  const [created] = await db.select().from(catalogSyncSettings).where(eq(catalogSyncSettings.id, Number(result[0].insertId))).limit(1);
  if (!created) throw new Error("تعذر إنشاء إعدادات فحص Catalog.");
  return created;
}

export async function getCatalogSyncSettingsByTaskUid(taskUid: string) {
  const db = await getDb();
  if (!db) return null;
  const [setting] = await db.select().from(catalogSyncSettings).where(eq(catalogSyncSettings.scheduleCronTaskUid, taskUid)).limit(1);
  return setting ?? null;
}

export async function markCatalogSyncStarted(settingId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(catalogSyncSettings).set({ lastStartedAt: new Date(), lastError: null }).where(eq(catalogSyncSettings.id, settingId));
}

export async function markCatalogSyncCompleted(input: { settingId: number; summary: unknown }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(catalogSyncSettings).set({ lastCompletedAt: new Date(), lastSummary: JSON.stringify(input.summary), lastError: null }).where(eq(catalogSyncSettings.id, input.settingId));
}

export async function markCatalogSyncFailed(input: { settingId: number; error: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(catalogSyncSettings).set({ lastError: input.error.slice(0, 2000) }).where(eq(catalogSyncSettings.id, input.settingId));
}

export async function persistCatalogSyncTask(input: { settingId: number; taskUid: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(catalogSyncSettings).set({ scheduleCronTaskUid: input.taskUid, isEnabled: true }).where(eq(catalogSyncSettings.id, input.settingId));
}
