import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { orderItems, orders, orderStatusEvents, productVariants, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { createStorefrontOrder, getOperationalOrder, transitionOrderStatus } from "./db";

describe("دورة الطلب", () => {
  const cleanup: Array<{ orderId: number; productId: number; variantId: number }> = [];

  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    for (const item of cleanup.splice(0)) {
      await db.delete(orderStatusEvents).where(eq(orderStatusEvents.orderId, item.orderId));
      await db.delete(orderItems).where(eq(orderItems.orderId, item.orderId));
      await db.delete(orders).where(eq(orders.id, item.orderId));
      await db.delete(productVariants).where(eq(productVariants.id, item.variantId));
      await db.delete(products).where(eq(products.id, item.productId));
    }
  });

  it("ينشئ الطلب جديدًا بلا خصم ثم يخصم عند التأكيد ويعيد الكمية عند الإلغاء", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار الطلبات.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول للاختبار.");
    const productCode = `TST-ORDER-${randomUUID().slice(0, 10)}`;
    const productResult = await db.insert(products).values({ productCode, name: "منتج طلب تجريبي", status: "active", sellingPrice: "12000.00", createdByUserId: owner.id });
    const productId = Number(productResult[0].insertId);
    const variantResult = await db.insert(productVariants).values({ productId, colorName: "بيج", inventoryQuantity: 5, availability: "available" });
    const variantId = Number(variantResult[0].insertId);
    const created = await createStorefrontOrder({ productCode, colorName: "بيج", quantity: 2, customerName: "عميلة اختبار", customerPhone: "07700000000", governorate: "بغداد", address: "عنوان اختبار كامل", customerNote: "" });
    cleanup.push({ orderId: created.orderId, productId, variantId });
    const [beforeConfirmation] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(beforeConfirmation?.inventoryQuantity).toBe(5);
    expect((await getOperationalOrder(created.orderId))?.items[0]).toMatchObject({ productCodeSnapshot: productCode, colorNameSnapshot: "بيج", unitPriceSnapshot: "12000.00", quantity: 2 });
    await transitionOrderStatus({ orderId: created.orderId, nextStatus: "confirmed", actorUserId: owner.id });
    const [afterConfirmation] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(afterConfirmation?.inventoryQuantity).toBe(3);
    const confirmed = await getOperationalOrder(created.orderId);
    expect(confirmed?.order.status).toBe("confirmed");
    expect(confirmed?.order.inventoryDeductedAt).not.toBeNull();
    await transitionOrderStatus({ orderId: created.orderId, nextStatus: "cancelled", actorUserId: owner.id });
    const [afterCancellation] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(afterCancellation?.inventoryQuantity).toBe(5);
    expect((await getOperationalOrder(created.orderId))?.events.map(event => event.toStatus)).toEqual(["cancelled", "confirmed", "new"]);
  });
});
