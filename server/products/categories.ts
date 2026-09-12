import { and, asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { productCategories, productOperations, products } from "../../drizzle/schema";
import { getDb } from "../db";

export type OneDriveCategoryInput = {
  folderId: string;
  name: string;
  path: string;
  depth: number;
};

type CategoryRow = typeof productCategories.$inferSelect;

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function categoryLabel(category: Pick<CategoryRow, "name" | "displayName">) {
  return normalizedName(category.displayName || category.name);
}

function buildPath(categoryId: number, byId: Map<number, CategoryRow>, visited = new Set<number>()): string {
  const category = byId.get(categoryId);
  if (!category || visited.has(categoryId)) return "";
  visited.add(categoryId);
  const parentPath = category.parentId ? buildPath(category.parentId, byId, visited) : "";
  const own = categoryLabel(category);
  return parentPath ? `${parentPath} / ${own}` : own;
}

function categoryDepth(categoryId: number, byId: Map<number, CategoryRow>, visited = new Set<number>()): number {
  const category = byId.get(categoryId);
  if (!category || !category.parentId || visited.has(categoryId)) return 0;
  visited.add(categoryId);
  return categoryDepth(category.parentId, byId, visited) + 1;
}

function primaryCategoryId(categoryId: number, byId: Map<number, CategoryRow>, visited = new Set<number>()): number {
  const category = byId.get(categoryId);
  if (!category || !category.parentId || visited.has(categoryId)) return categoryId;
  visited.add(categoryId);
  return primaryCategoryId(category.parentId, byId, visited);
}

export async function listProductCategories(storeId: number) {
  const db = await getDb();
  if (!db) return [] as CategoryRow[];
  return db.select().from(productCategories).where(eq(productCategories.storeId, storeId)).orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
}

/** Product-facing tree with locally renamed labels and stable hierarchy metadata. */
export async function listProductCategoryTree(storeId: number) {
  const categories = await listProductCategories(storeId);
  const byId = new Map(categories.map(category => [category.id, category]));
  return categories.map(category => ({
    ...category,
    label: categoryLabel(category),
    displayPath: buildPath(category.id, byId),
    depth: categoryDepth(category.id, byId),
    primaryCategoryId: primaryCategoryId(category.id, byId),
  }));
}

async function getCategoryInStore(storeId: number, categoryId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [category] = await db.select().from(productCategories).where(and(eq(productCategories.id, categoryId), eq(productCategories.storeId, storeId))).limit(1);
  if (!category) throw new Error("التصنيف غير موجود في متجرك.");
  return category;
}

export async function createManualProductCategory(input: { storeId: number; name: string; parentId?: number | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const name = normalizedName(input.name);
  if (!name) throw new Error("اسم القسم مطلوب.");
  if (input.parentId) await getCategoryInStore(input.storeId, input.parentId);
  const siblings = (await listProductCategories(input.storeId)).filter(category => (category.parentId ?? null) === (input.parentId ?? null));
  if (siblings.some(category => categoryLabel(category) === name)) throw new Error("يوجد قسم أو تصنيف بالاسم نفسه في هذا المستوى.");
  const result = await db.insert(productCategories).values({
    storeId: input.storeId,
    parentId: input.parentId ?? null,
    name,
    source: "manual",
    sourcePath: `manual/${randomUUID()}`,
    sortOrder: siblings.length,
  });
  const categoryId = Number(result[0].insertId);
  return (await listProductCategoryTree(input.storeId)).find(category => category.id === categoryId)!;
}

export async function renameProductCategory(input: { storeId: number; categoryId: number; name: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const category = await getCategoryInStore(input.storeId, input.categoryId);
  const name = normalizedName(input.name);
  if (!name) throw new Error("اسم القسم مطلوب.");
  const siblings = (await listProductCategories(input.storeId)).filter(item => item.id !== category.id && (item.parentId ?? null) === (category.parentId ?? null));
  if (siblings.some(item => categoryLabel(item) === name)) throw new Error("يوجد قسم أو تصنيف بالاسم نفسه في هذا المستوى.");
  if (category.source === "onedrive") {
    await db.update(productCategories).set({ displayName: name }).where(eq(productCategories.id, category.id));
  } else {
    await db.update(productCategories).set({ name, displayName: null }).where(eq(productCategories.id, category.id));
  }
  return (await listProductCategoryTree(input.storeId)).find(item => item.id === category.id)!;
}

export async function reorderProductCategories(input: { storeId: number; categoryIds: number[] }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const categories = await db.select().from(productCategories).where(and(eq(productCategories.storeId, input.storeId), inArray(productCategories.id, input.categoryIds)));
  if (categories.length !== input.categoryIds.length) throw new Error("بعض الأقسام غير موجودة في متجرك.");
  const parentId = categories[0]?.parentId ?? null;
  if (categories.some(category => (category.parentId ?? null) !== parentId)) throw new Error("يجب ترتيب أقسام المستوى نفسه معًا.");
  await db.transaction(async tx => {
    for (let sortOrder = 0; sortOrder < input.categoryIds.length; sortOrder += 1) {
      const categoryId = input.categoryIds[sortOrder]!;
      await tx.update(productCategories).set({ sortOrder }).where(and(eq(productCategories.id, categoryId), eq(productCategories.storeId, input.storeId)));
    }
  });
  return listProductCategoryTree(input.storeId);
}

export async function assignProductCategory(input: { storeId: number; productId: number; categoryId: number | null; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [product] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId))).limit(1);
  if (!product) throw new Error("المنتج غير موجود في متجرك.");
  const category = input.categoryId ? await getCategoryInStore(input.storeId, input.categoryId) : null;
  const tree = await listProductCategoryTree(input.storeId);
  const categoryPath = category ? tree.find(item => item.id === category.id)?.displayPath ?? categoryLabel(category) : null;
  await db.transaction(async tx => {
    await tx.update(products).set({ categoryId: category?.id ?? null, category: categoryPath, categoryAssignmentSource: "manual" }).where(eq(products.id, product.id));
    await tx.insert(productOperations).values({
      productId: product.id,
      actorUserId: input.actorUserId,
      source: "products_ui",
      action: "product_category_assigned",
      changes: JSON.stringify({ categoryId: category?.id ?? null, categoryPath, assignmentSource: "manual" }),
    });
  });
  return { productId: product.id, categoryId: category?.id ?? null, categoryPath };
}

/** Creates source nodes from an imported product path when the tree has not yet been saved from the OneDrive preview. */
export async function ensureOneDriveCategoryPath(storeId: number, sourceCategoryPath: string) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const names = sourceCategoryPath.split("/").map(normalizedName).filter(Boolean);
  if (!names.length) return null;
  let parentId: number | null = null;
  let currentPath = "Catalog";
  for (const name of names) {
    currentPath = `${currentPath}/${name}`;
    const [existing] = await db.select().from(productCategories).where(and(eq(productCategories.storeId, storeId), eq(productCategories.sourcePath, currentPath))).limit(1);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const siblings = (await listProductCategories(storeId)).filter(category => (category.parentId ?? null) === parentId);
    await db.insert(productCategories).values({ storeId, parentId, name, source: "onedrive", sourcePath: currentPath, sortOrder: siblings.length, lastSeenAt: new Date() });
    const [created] = await db.select({ id: productCategories.id }).from(productCategories).where(and(eq(productCategories.storeId, storeId), eq(productCategories.sourcePath, currentPath))).limit(1);
    if (!created) throw new Error("تعذر حفظ تصنيف OneDrive.");
    parentId = created.id;
  }
  return parentId;
}

/** Updates source assignment only while the merchant has not deliberately assigned a different platform category. */
export async function assignOneDriveCategoryToProduct(input: { storeId: number; productId: number; sourceCategoryPath: string }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [product] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId))).limit(1);
  if (!product) throw new Error("المنتج غير موجود في متجرك.");
  if (product.categoryAssignmentSource === "manual") return { applied: false as const, reason: "manual_assignment" as const };
  const categoryId = await ensureOneDriveCategoryPath(input.storeId, input.sourceCategoryPath);
  const tree = await listProductCategoryTree(input.storeId);
  const categoryPath = categoryId ? tree.find(category => category.id === categoryId)?.displayPath ?? input.sourceCategoryPath : input.sourceCategoryPath;
  await db.update(products).set({ categoryId, category: categoryPath, categoryAssignmentSource: "onedrive" }).where(eq(products.id, product.id));
  return { applied: true as const, categoryId, categoryPath };
}

/** Writes only category references; it never creates or modifies products. */
export async function syncOneDriveCategoryTree(storeId: number, categories: OneDriveCategoryInput[]) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  if (!categories.length) return { created: 0, updated: 0, categories: [] as Awaited<ReturnType<typeof listProductCategories>> };

  const sourceFolderIds = categories.map(category => category.folderId);
  const existing = await db.select().from(productCategories).where(and(eq(productCategories.storeId, storeId), inArray(productCategories.sourceFolderId, sourceFolderIds)));
  const idsByFolder = new Map(existing.filter(category => category.sourceFolderId).map(category => [category.sourceFolderId!, category.id]));
  const allExisting = await listProductCategories(storeId);
  const idsByPath = new Map(allExisting.map(category => [category.sourcePath, category.id]));
  let created = 0;
  let updated = 0;

  for (const entry of [...categories].sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path, "ar"))) {
    const parentPath = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : null;
    const parentId = parentPath ? idsByPath.get(parentPath) ?? null : null;
    const currentId = idsByFolder.get(entry.folderId) ?? idsByPath.get(entry.path);
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
