import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { products, stores, users } from "../../drizzle/schema";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { getDb } from "../db";

let storeId: number | undefined;
let productId: number | undefined;

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (productId) await db.delete(products).where(eq(products.id, productId));
  if (storeId) await db.delete(stores).where(eq(stores.id, storeId));
  productId = undefined;
  storeId = undefined;
});

describe("products.publicList integration", () => {
  it("يعيد عناصر عامة جاهزة للبطاقة من دون افتراض حالة منتج حي بعينه", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const products = await caller.products.publicList();

    expect(Array.isArray(products)).toBe(true);
    expect(products.every(product => "defaultColorName" in product)).toBe(true);
  }, 15_000);

  it("لا يعرض منتج متجر ثانٍ ولو كان نشطاً", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار عزل القائمة العامة.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مالك لاختبار عزل القائمة العامة.");
    const suffix = randomUUID().slice(0, 12);
    const insertedStore = await db.insert(stores).values({ name: "متجر اختبار الواجهة الثانية", slug: `public-scope-${suffix}`, status: "active", primaryOwnerUserId: owner.id });
    storeId = Number(insertedStore[0].insertId);
    const productCode = `PUBLIC-SCOPE-${suffix}`;
    const insertedProduct = await db.insert(products).values({
      storeId,
      productCode,
      name: "منتج متجر ثانٍ ظاهر",
      category: "اختبار",
      status: "active",
      sellingPrice: "1000.00",
      createdByUserId: owner.id,
    });
    productId = Number(insertedProduct[0].insertId);

    const ctx: TrpcContext = { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
    const result = await appRouter.createCaller(ctx).products.publicList();
    expect(result.some(product => product.productCode === productCode)).toBe(false);
  }, 15_000);
});
