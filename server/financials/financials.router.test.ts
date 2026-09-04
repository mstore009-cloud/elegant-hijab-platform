import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { employeePermissionGrants, employeeProfiles, products, stores, users } from "../../drizzle/schema";
import { appRouter } from "../routers";
import { getDb } from "../db";
import type { TrpcContext } from "../_core/context";

const cleanup: Array<{ userId: number; storeId: number }> = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const item of cleanup.splice(0)) {
    await db.delete(stores).where(eq(stores.id, item.storeId));
    await db.delete(users).where(eq(users.id, item.userId));
  }
});

describe("financials router permissions", () => {
  it("يحجب قائمة التكلفة والهامش عن مستخدم المتجر غير المخول", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار صلاحيات المالية.");
    const userInsert = await db.insert(users).values({ openId: `finance-router-${randomUUID()}`, name: "موظف بلا مالية", role: "user" });
    const userId = Number(userInsert[0].insertId);
    const storeInsert = await db.insert(stores).values({ name: "متجر اختبار صلاحية المالية", slug: `finance-router-${randomUUID().slice(0, 8)}`, status: "active", primaryOwnerUserId: userId });
    const storeId = Number(storeInsert[0].insertId);
    cleanup.push({ userId, storeId });

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    const ctx: TrpcContext = { user: user!, operationalStore: store!, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };

    await expect(appRouter.createCaller(ctx).financials.listProducts()).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 15_000);

  it("يحجب الحقول المالية من list وbyId لموظف يملك قراءة المنتجات فقط", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار redaction المالية.");
    const suffix = randomUUID();
    const userInsert = await db.insert(users).values({ openId: `finance-redaction-${suffix}`, name: "موظف منتجات فقط", role: "user" });
    const userId = Number(userInsert[0].insertId);
    const storeInsert = await db.insert(stores).values({ name: "متجر اختبار redaction", slug: `finance-redaction-${suffix.slice(0, 8)}`, status: "active", primaryOwnerUserId: userId });
    const storeId = Number(storeInsert[0].insertId);
    const profileInsert = await db.insert(employeeProfiles).values({ userId, storeId, displayName: "موظف منتجات فقط", isActive: true });
    const employeeId = Number(profileInsert[0].insertId);
    await db.insert(employeePermissionGrants).values({ employeeId, permissionCode: "products.inventory.update", grantedByUserId: userId });
    const productInsert = await db.insert(products).values({ storeId, productCode: `RED-${suffix.slice(0, 8)}`, name: "منتج مالي محمي", category: "اختبار", status: "draft", sellingPrice: "25000.00", costPrice: "12000.00", targetMarginPercent: "52.00", createdByUserId: userId });
    const productId = Number(productInsert[0].insertId);
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
      const ctx: TrpcContext = { user: user!, operationalStore: store!, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
      const caller = appRouter.createCaller(ctx);
      const listed = await caller.products.list();
      const listedProduct = listed.find(item => item.id === productId);
      expect(listedProduct).toBeDefined();
      expect(listedProduct).not.toHaveProperty("costPrice");
      expect(listedProduct).not.toHaveProperty("targetMarginPercent");
      const detail = await caller.products.byId({ productId });
      expect(detail.product).not.toHaveProperty("costPrice");
      expect(detail.product).not.toHaveProperty("targetMarginPercent");
    } finally {
      await db.delete(products).where(eq(products.id, productId));
      await db.delete(employeePermissionGrants).where(eq(employeePermissionGrants.employeeId, employeeId));
      await db.delete(employeeProfiles).where(eq(employeeProfiles.id, employeeId));
      await db.delete(stores).where(eq(stores.id, storeId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }, 15_000);
});
