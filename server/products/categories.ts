import { and, asc, eq, inArray } from "drizzle-orm";
import { productCategories } from "../../drizzle/schema";
import { getDb } from "../db";

export type OneDriveCategoryInput = {
  folderId: string;
  name: string;
  path: string;
  depth: number;
};

export async function listProductCategories(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productCategories).where(eq(productCategories.storeId, storeId)).orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
}

/** Writes only category references; it never creates or modifies products. */
export async function syncOneDriveCategoryTree(storeId: number, categories: OneDriveCategoryInput[]) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  if (!categories.length) return { created: 0, updated: 0, categories: [] as Awaited<ReturnType<typeof listProductCategories>> };

  const sourceFolderIds = categories.map(category => category.folderId);
  const existing = await db.select().from(productCategories).where(and(eq(productCategories.storeId, storeId), inArray(productCategories.sourceFolderId, sourceFolderIds)));
  const idsByFolder = new Map(existing.filter(category => category.sourceFolderId).map(category => [category.sourceFolderId!, category.id]));
  const idsByPath = new Map(existing.map(category => [category.sourcePath, category.id]));
  let created = 0;
  let updated = 0;

  for (const entry of [...categories].sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path, "ar"))) {
    const parentPath = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : null;
    const parentId = parentPath ? idsByPath.get(parentPath) ?? null : null;
    const currentId = idsByFolder.get(entry.folderId);
    const values = { name: entry.name, parentId, source: "onedrive" as const, sourceFolderId: entry.folderId, sourcePath: entry.path, sortOrder: entry.depth, lastSeenAt: new Date() };
    if (currentId) {
      await db.update(productCategories).set(values).where(and(eq(productCategories.id, currentId), eq(productCategories.storeId, storeId)));
      updated += 1;
      idsByPath.set(entry.path, currentId);
      continue;
    }
    const inserted = await db.insert(productCategories).values({ storeId, ...values });
    const id = Number(inserted[0].insertId);
    idsByFolder.set(entry.folderId, id);
    idsByPath.set(entry.path, id);
    created += 1;
  }
  return { created, updated, categories: await listProductCategories(storeId) };
}
