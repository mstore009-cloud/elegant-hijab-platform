import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { orderContactEvents, orderItems, orders, orderStatusEvents, productVariants, products, promotionCoupons, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { addOrderContactEvent, createStorefrontOrder, getOperationalOrder, getPublicDeliveryFee, transitionOrderStatus, updateOrderCommercialTerms } from "./db";

describe("دورة الطلب", () => {
  const cleanup: Array<{ orderId: number; productId: number; variantIds: number[]; couponId?: number }> = [];

  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    for (const item of cleanup.splice(0)) {
      await db.delete(orderContactEvents).where(eq(orderContactEvents.orderId, item.orderId));
      await db.delete(orderStatusEvents).where(eq(orderStatusEvents.orderId, item.orderId));
      await db.delete(orderItems).where(eq(orderItems.orderId, item.orderId));
      await db.delete(orders).where(eq(orders.id, item.orderId));
      if (item.couponId) await db.delete(promotionCoupons).where(eq(promotionCoupons.id, item.couponId));
      for (const variantId of item.variantIds) await db.delete(productVariants).where(eq(productVariants.id, variantId));
      await db.delete(products).where(eq(products.id, item.productId));
    }
  });

  it("ينشئ سلة بألوان متعددة بلا خصم، ويحفظ التسعير والتواصل ثم يخصم عند التأكيد ويعيد الكمية عند الإلغاء", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار الطلبات.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول للاختبار.");
    const productCode = `TST-ORDER-${randomUUID().slice(0, 10)}`;
    const productResult = await db.insert(products).values({ productCode, name: "منتج طلب تجريبي", status: "active", sellingPrice: "12000.00", createdByUserId: owner.id });
    const productId = Number(productResult[0].insertId);
    const variantResult = await db.insert(productVariants).values({ productId, colorName: "بيج", inventoryQuantity: 5, availability: "available" });
    const variantId = Number(variantResult[0].insertId);
    const secondVariantResult = await db.insert(productVariants).values({ productId, colorName: "أسود", inventoryQuantity: 4, availability: "available" });
    const secondVariantId = Number(secondVariantResult[0].insertId);
    const expectedDelivery = Number((await getPublicDeliveryFee(36000)).fee);
    const created = await createStorefrontOrder({ items: [{ productCode, colorName: "بيج", quantity: 2 }, { productCode, colorName: "أسود", quantity: 1 }], customerName: "عميلة اختبار", customerPhone: "07700000000", governorate: "بغداد", address: "عنوان اختبار كامل", customerNote: "" });
    cleanup.push({ orderId: created.orderId, productId, variantIds: [variantId, secondVariantId] });
    const [beforeConfirmation] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(beforeConfirmation?.inventoryQuantity).toBe(5);
    expect((await getOperationalOrder(created.orderId))?.items).toHaveLength(2);
    expect((await getOperationalOrder(created.orderId))?.items[0]).toMatchObject({ productCodeSnapshot: productCode, unitPriceSnapshot: "12000.00" });
    expect((await getOperationalOrder(created.orderId))?.order).toMatchObject({ subtotal: "36000.00", deliveryFee: expectedDelivery.toFixed(2), manualDiscount: "0.00", total: (36000 + expectedDelivery).toFixed(2), customerChannel: "storefront" });
    await updateOrderCommercialTerms({ orderId: created.orderId, deliveryFee: 3000, manualDiscount: 1000, customerChannel: "instagram", actorUserId: owner.id });
    await addOrderContactEvent({ orderId: created.orderId, channel: "instagram", outcome: "attempted", note: "رسالة أولى", actorUserId: owner.id });
    expect((await getOperationalOrder(created.orderId))?.order).toMatchObject({ customerChannel: "instagram", total: "38000.00" });
    expect((await getOperationalOrder(created.orderId))?.contacts[0]).toMatchObject({ channel: "instagram", outcome: "attempted" });
    await transitionOrderStatus({ orderId: created.orderId, nextStatus: "confirmed", actorUserId: owner.id });
    const [afterConfirmation] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(afterConfirmation?.inventoryQuantity).toBe(3);
    const [afterSecondConfirmation] = await db.select().from(productVariants).where(eq(productVariants.id, secondVariantId));
    expect(afterSecondConfirmation?.inventoryQuantity).toBe(3);
    const confirmed = await getOperationalOrder(created.orderId);
    expect(confirmed?.order.status).toBe("confirmed");
    expect(confirmed?.order.inventoryDeductedAt).not.toBeNull();
    await transitionOrderStatus({ orderId: created.orderId, nextStatus: "cancelled", actorUserId: owner.id });
    const [afterCancellation] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(afterCancellation?.inventoryQuantity).toBe(5);
    const [afterSecondCancellation] = await db.select().from(productVariants).where(eq(productVariants.id, secondVariantId));
    expect(afterSecondCancellation?.inventoryQuantity).toBe(4);
    expect((await getOperationalOrder(created.orderId))?.events.map(event => event.toStatus)).toEqual(["cancelled", "confirmed", "new"]);
  });

  it("يطبق القسيمة على المنتجات فقط ويحفظ الخصم ويرفض تجاوز حد استخدامها", async () => {
    const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار القسائم.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1); if (!owner) throw new Error("لا يوجد مستخدم مخول للاختبار.");
    const productCode = `TST-COUPON-${randomUUID().slice(0, 10)}`;
    const productResult = await db.insert(products).values({ productCode, name: "منتج قسيمة تجريبي", status: "active", sellingPrice: "10000.00", createdByUserId: owner.id });
    const productId = Number(productResult[0].insertId);
    const variantResult = await db.insert(productVariants).values({ productId, colorName: "بيج", inventoryQuantity: 3, availability: "available" });
    const variantId = Number(variantResult[0].insertId);
    const code = `SAVE${randomUUID().slice(0, 6).toUpperCase()}`;
    const couponResult = await db.insert(promotionCoupons).values({ code, discountType: "percent", discountValue: "25.00", minimumSubtotal: "5000.00", usageLimit: 1, enabled: true, createdByUserId: owner.id });
    const couponId = Number(couponResult[0].insertId);
    const expectedDelivery = Number((await getPublicDeliveryFee(20000)).fee);
    const created = await createStorefrontOrder({ items: [{ productCode, colorName: "بيج", quantity: 2 }], customerName: "عميلة قسيمة", customerPhone: "07700000001", governorate: "بغداد", address: "عنوان اختبار قسيمة", couponCode: code });
    cleanup.push({ orderId: created.orderId, productId, variantIds: [variantId], couponId });
    expect((await getOperationalOrder(created.orderId))?.order).toMatchObject({ subtotal: "20000.00", deliveryFee: expectedDelivery.toFixed(2), manualDiscount: "5000.00", total: (15000 + expectedDelivery).toFixed(2), customerChannel: "storefront" });
    await expect(createStorefrontOrder({ items: [{ productCode, colorName: "بيج", quantity: 1 }], customerName: "عميلة ثانية", customerPhone: "07700000002", governorate: "بغداد", address: "عنوان اختبار آخر", couponCode: code })).rejects.toThrow("القسيمة");
  });
});
