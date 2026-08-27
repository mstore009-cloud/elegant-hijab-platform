import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { employeeProfiles, products, stores, users } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { getDb } from "../db";
import { appRouter } from "../routers";

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
let userId: number | undefined;
let primaryStoreId: number | undefined;
let otherStoreId: number | undefined;
let otherProductId: number | undefined;

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (otherProductId) await db.delete(products).where(eq(products.id, otherProductId));
  if (userId) await db.delete(employeeProfiles).where(eq(employeeProfiles.userId, userId));
  if (otherStoreId) await db.delete(stores).where(eq(stores.id, otherStoreId));
  if (primaryStoreId) await db.delete(stores).where(eq(stores.id, primaryStoreId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  userId = undefined;
  primaryStoreId = undefined;
  otherStoreId = undefined;
  otherProductId = undefined;
});

describe("عزل المنتجات حسب المتجر", () => {
  it("يمنع قراءة منتج متجر آخر أو ظهوره ضمن القائمة الإدارية", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار عزل المنتجات.");

    const createdUser = await db.insert(users).values({ openId: `product-scope-${suffix}`, name: "مدير اختبار عزل المنتجات", role: "admin" });
    userId = Number(createdUser[0].insertId);

    const firstStore = await db.insert(stores).values({ name: "متجر النطاق الأول", slug: `products-a-${suffix}`, status: "active", primaryOwnerUserId: userId });
    primaryStoreId = Number(firstStore[0].insertId);
    const secondStore = await db.insert(stores).values({ name: "متجر النطاق الثاني", slug: `products-b-${suffix}`, status: "active", primaryOwnerUserId: userId });
    otherStoreId = Number(secondStore[0].insertId);
    await db.insert(employeeProfiles).values({ userId, storeId: primaryStoreId, displayName: "مدير اختبار عزل المنتجات", isActive: true });

    const createdProduct = await db.insert(products).values({
      storeId: otherStoreId,
      productCode: `SCOPE-${suffix}`,
      name: "منتج متجر ثانٍ",
      category: "اختبار",
      status: "draft",
      sellingPrice: "1000.00",
      createdByUserId: userId,
    });
    otherProductId = Number(createdProduct[0].insertId);

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const [operationalStore] = await db.select().from(stores).where(eq(stores.id, primaryStoreId)).limit(1);
    const ctx: TrpcContext = {
      user: user!,
      operationalStore: operationalStore!,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    await expect(caller.products.byId({ productId: otherProductId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const listed = await caller.products.list();
    expect(listed.some(product => product.id === otherProductId)).toBe(false);
  }, 15_000);
});
