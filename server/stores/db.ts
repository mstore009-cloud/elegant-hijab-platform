import { and, eq } from "drizzle-orm";
import { employeeProfiles, stores, type Store, type User } from "../../drizzle/schema";
import { getDb } from "../db";

export const DEFAULT_STORE_SLUG = "elegant-hijab";
export const DEFAULT_STORE_NAME = "عالم الحجابات الأنيقة";

export type OperationalStoreContext = {
  store: Store;
  source: "employee_profile" | "admin_bootstrap";
};

async function findActiveStoreById(storeId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

async function getOrCreateDefaultStore(owner: User) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");

  const existing = await db.select().from(stores).where(eq(stores.slug, DEFAULT_STORE_SLUG)).limit(1);
  if (existing[0]) return existing[0];

  const created = await db.insert(stores).values({
    name: DEFAULT_STORE_NAME,
    slug: DEFAULT_STORE_SLUG,
    status: "active",
    primaryOwnerUserId: owner.id,
  });

  const storeId = Number(created[0].insertId);
  const rows = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!rows[0]) throw new Error("تعذر إنشاء المتجر التشغيلي.");
  return rows[0];
}

/** Public storefront routes resolve the single V1 store without granting staff context. */
export async function getPublicStore() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(stores)
    .where(and(eq(stores.slug, DEFAULT_STORE_SLUG), eq(stores.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the current operational store without granting staff access to a
 * different store. The initial platform admin bootstraps the single V1 store.
 */
export async function getOperationalStoreContext(user: User): Promise<OperationalStoreContext | null> {
  const db = await getDb();
  if (!db) return null;

  const profiles = await db
    .select({ storeId: employeeProfiles.storeId })
    .from(employeeProfiles)
    .where(eq(employeeProfiles.userId, user.id))
    .limit(1);

  if (profiles[0]) {
    const store = await findActiveStoreById(profiles[0].storeId);
    if (store) return { store, source: "employee_profile" };
    return null;
  }

  if (user.role !== "admin") return null;
  return { store: await getOrCreateDefaultStore(user), source: "admin_bootstrap" };
}
