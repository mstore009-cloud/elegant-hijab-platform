import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { orderContactEvents, orderFulfillmentEvents, orderFulfillmentItemChecks, orderFulfillments, orderItems, orders, orderStatusEvents, productVariants, products, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getPublicStore } from "../stores/db";
import { createStorefrontOrder, transitionOrderStatus } from "./db";
import { deliverFulfillment, dispatchFulfillment, getFulfillmentDetail, markFulfillmentReady, recordFulfillmentException, setFulfillmentItemCheck, startPicking } from "./fulfillment";

describe("تجهيز الطلبات اليدوي", () => {
  const cleanup: Array<{ orderId: number; productId: number; variantId: number; otherStoreId: number }> = [];

  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    for (const item of cleanup.splice(0)) {
      const [fulfillment] = await db.select({ id: orderFulfillments.id }).from(orderFulfillments).where(eq(orderFulfillments.orderId, item.orderId)).limit(1);
      if (fulfillment) {
        await db.delete(orderFulfillmentEvents).where(eq(orderFulfillmentEvents.fulfillmentId, fulfillment.id));
        await db.delete(orderFulfillmentItemChecks).where(eq(orderFulfillmentItemChecks.fulfillmentId, fulfillment.id));
        await db.delete(orderFulfillments).where(eq(orderFulfillments.id, fulfillment.id));
      }
      await db.delete(orderContactEvents).where(eq(orderContactEvents.orderId, item.orderId));
      await db.delete(orderStatusEvents).where(eq(orderStatusEvents.orderId, item.orderId));
      await db.delete(orderItems).where(eq(orderItems.orderId, item.orderId));
      await db.delete(orders).where(eq(orders.id, item.orderId));
      await db.delete(productVariants).where(eq(productVariants.id, item.variantId));
      await db.delete(products).where(eq(products.id, item.productId));
      await db.delete(stores).where(eq(stores.id, item.otherStoreId));
    }
  });

  it("يفرض الالتقاط والتغليف قبل الجاهزية ثم يحدّث حالة الطلب عند التسليم دون إعادة حساب السعر أو المخزون", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار التجهيز.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    const store = await getPublicStore();
    if (!owner || !store) throw new Error("لا تتوفر بيانات تشغيل للاختبار.");

    const productCode = `TST-FULFILL-${randomUUID().slice(0, 10)}`;
    const createdProduct = await db.insert(products).values({ storeId: store.id, productCode, name: "منتج تجهيز اختبار", status: "active", sellingPrice: "12000.00", createdByUserId: owner.id });
    const productId = Number(createdProduct[0].insertId);
    const createdVariant = await db.insert(productVariants).values({ productId, colorName: "زيتي", inventoryQuantity: 3, availability: "available" });
    const variantId = Number(createdVariant[0].insertId);
    const createdOrder = await createStorefrontOrder({ items: [{ productCode, colorName: "زيتي", quantity: 1 }], customerName: "عميلة تجهيز", customerPhone: `077${Date.now().toString().slice(-8)}`, governorate: "بغداد", address: "عنوان تجهيز اختباري" });
    const createdStore = await db.insert(stores).values({ name: "متجر عزل التجهيز", slug: `fulfill-${randomUUID().slice(0, 10)}`, status: "active", primaryOwnerUserId: owner.id });
    const otherStoreId = Number(createdStore[0].insertId);
    cleanup.push({ orderId: createdOrder.orderId, productId, variantId, otherStoreId });

    await transitionOrderStatus({ storeId: store.id, orderId: createdOrder.orderId, nextStatus: "confirmed", actorUserId: owner.id });
    const before = await getFulfillmentDetail({ storeId: store.id, orderId: createdOrder.orderId });
    expect(before.fulfillment).toBeNull();
    await expect(getFulfillmentDetail({ storeId: otherStoreId, orderId: createdOrder.orderId })).rejects.toThrow("الطلب غير موجود");

    const picking = await startPicking({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id });
    expect(picking.fulfillment?.stage).toBe("picking");
    const line = picking.items[0];
    if (!line) throw new Error("عنصر التجهيز غير موجود.");
    await expect(markFulfillmentReady({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id })).rejects.toThrow("إكمال الالتقاط");
    const afterPick = await setFulfillmentItemCheck({ storeId: store.id, orderId: createdOrder.orderId, orderItemId: line.id, field: "picked", checked: true, actorUserId: owner.id });
    expect(afterPick.fulfillment?.stage).toBe("packing");
    await setFulfillmentItemCheck({ storeId: store.id, orderId: createdOrder.orderId, orderItemId: line.id, field: "packed", checked: true, actorUserId: owner.id });
    const ready = await markFulfillmentReady({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id, note: "مغلف وجاهز" });
    expect(ready.fulfillment?.stage).toBe("ready");
    const dispatched = await dispatchFulfillment({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id });
    expect(dispatched.fulfillment?.stage).toBe("dispatched");
    const delivered = await deliverFulfillment({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id });
    expect(delivered.fulfillment?.stage).toBe("delivered");
    expect(delivered.order.status).toBe("completed");
    expect(delivered.order.total).toBeDefined();
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(variant?.inventoryQuantity).toBe(2);
  });

  it("يحفظ التعذر بسبب إلزامي ويسمح باستئناف الالتقاط دون إلغاء الطلب", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار التعذر.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    const store = await getPublicStore();
    if (!owner || !store) throw new Error("لا تتوفر بيانات تشغيل للاختبار.");

    const productCode = `TST-BLOCK-${randomUUID().slice(0, 10)}`;
    const createdProduct = await db.insert(products).values({ storeId: store.id, productCode, name: "منتج تعذر اختبار", status: "active", sellingPrice: "9000.00", createdByUserId: owner.id });
    const productId = Number(createdProduct[0].insertId);
    const createdVariant = await db.insert(productVariants).values({ productId, colorName: "أسود", inventoryQuantity: 2, availability: "available" });
    const variantId = Number(createdVariant[0].insertId);
    const createdOrder = await createStorefrontOrder({ items: [{ productCode, colorName: "أسود", quantity: 1 }], customerName: "عميلة تعذر", customerPhone: `078${Date.now().toString().slice(-8)}`, governorate: "بغداد", address: "عنوان تعذر اختباري" });
    const createdStore = await db.insert(stores).values({ name: "متجر عزل التعذر", slug: `block-${randomUUID().slice(0, 10)}`, status: "active", primaryOwnerUserId: owner.id });
    const otherStoreId = Number(createdStore[0].insertId);
    cleanup.push({ orderId: createdOrder.orderId, productId, variantId, otherStoreId });

    await transitionOrderStatus({ storeId: store.id, orderId: createdOrder.orderId, nextStatus: "confirmed", actorUserId: owner.id });
    await startPicking({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id });
    await expect(recordFulfillmentException({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id, note: " " })).rejects.toThrow("مطلوب");
    const blocked = await recordFulfillmentException({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id, note: "تعذر الوصول إلى الرف" });
    expect(blocked.fulfillment?.stage).toBe("blocked");
    const resumed = await startPicking({ storeId: store.id, orderId: createdOrder.orderId, actorUserId: owner.id });
    expect(resumed.fulfillment?.stage).toBe("picking");
    expect(resumed.order.status).toBe("preparing");
  });
});
