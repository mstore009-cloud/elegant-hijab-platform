import { eq, inArray } from "drizzle-orm";
import { productCategories, stores, users } from "../../drizzle/schema";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "../db";
import { listProductCategories, syncOneDriveCategoryTree } from "./categories";

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
let userId: number | undefined;
let storeIds: number[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (storeIds.length) {
    await db.delete(productCategories).where(inArray(productCategories.storeId, storeIds));
    await db.delete(stores).where(inArray(stores.id, storeIds));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
  userId = undefined;
  storeIds = [];
});

describe("استيراد تصنيفات OneDrive", () => {
  it("يحفظ الشجرة لكل متجر ويحدّثها بلا إنشاء منتجات أو مشاركة مع متجر آخر", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار التصنيفات.");
    const user = await db.insert(users).values({ openId: `category-sync-${suffix}`, name: "مدير اختبار التصنيفات", role: "admin" });
    userId = Number(user[0].insertId);
    const first = await db.insert(stores).values({ name: "متجر تصنيفات أول", slug: `category-first-${suffix}`, status: "active", primaryOwnerUserId: userId });
    const second = await db.insert(stores).values({ name: "متجر تصنيفات ثان", slug: `category-second-${suffix}`, status: "active", primaryOwnerUserId: userId });
    const firstStoreId = Number(first[0].insertId);
    const secondStoreId = Number(second[0].insertId);
    storeIds = [firstStoreId, secondStoreId];

    const firstResult = await syncOneDriveCategoryTree(firstStoreId, [
      { folderId: "folder-hijab", name: "حجابات جاهزة", path: "Catalog/حجابات جاهزة", depth: 1 },
      { folderId: "folder-ties", name: "ربطات", path: "Catalog/ربطات", depth: 1 },
      { folderId: "folder-cotton", name: "ربطات قطن", path: "Catalog/ربطات/ربطات قطن", depth: 2 },
    ]);
    await syncOneDriveCategoryTree(secondStoreId, [{ folderId: "folder-hijab", name: "حجابات جاهزة", path: "Catalog/حجابات جاهزة", depth: 1 }]);
    const updated = await syncOneDriveCategoryTree(firstStoreId, [
      { folderId: "folder-hijab", name: "حجابات جاهزة", path: "Catalog/حجابات جاهزة", depth: 1 },
      { folderId: "folder-ties", name: "ربطات", path: "Catalog/ربطات", depth: 1 },
      { folderId: "folder-cotton", name: "ربطات قطن تركي", path: "Catalog/ربطات/ربطات قطن", depth: 2 },
    ]);

    const [firstCategories, secondCategories] = await Promise.all([listProductCategories(firstStoreId), listProductCategories(secondStoreId)]);
    expect(firstResult).toMatchObject({ created: 3, updated: 0 });
    expect(updated).toMatchObject({ created: 0, updated: 3 });
    expect(firstCategories.map(category => category.name)).toContain("ربطات قطن تركي");
    expect(firstCategories).toHaveLength(3);
    expect(secondCategories).toHaveLength(1);
    expect(secondCategories[0]).toMatchObject({ storeId: secondStoreId, sourceFolderId: "folder-hijab" });
  }, 15_000);
});
