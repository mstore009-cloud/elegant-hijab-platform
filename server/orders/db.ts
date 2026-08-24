import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { orderItems, orders, orderStatusEvents, productVariants, products } from "../../drizzle/schema";
import { getDb } from "../db";

export const orderStatuses = ["new", "needs_contact", "confirmed", "preparing", "out_for_delivery", "completed", "cancelled"] as const;
export type OrderStatus = (typeof orderStatuses)[number];

type CreateStorefrontOrderInput = {
  productCode: string;
  colorName: string;
  quantity: number;
  customerName: string;
  customerPhone: string;
  governorate: string;
  address: string;
  customerNote?: string | null;
};

function createOrderNumber() {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function createStorefrontOrder(input: CreateStorefrontOrderInput) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [product] = await db.select().from(products).where(and(eq(products.productCode, input.productCode), eq(products.status, "active"))).limit(1);
  if (!product) throw new Error("المنتج غير متاح للطلب حاليًا.");
  const [variant] = await db.select().from(productVariants).where(and(eq(productVariants.productId, product.id), eq(productVariants.colorName, input.colorName))).limit(1);
  if (!variant) throw new Error("لون المنتج المطلوب غير متاح حاليًا.");
  const quantity = Math.max(1, Math.min(100, Math.floor(input.quantity)));
  const orderNumber = createOrderNumber();
  const subtotal = (Number(product.sellingPrice) * quantity).toFixed(2);
  return db.transaction(async tx => {
    const created = await tx.insert(orders).values({
      orderNumber,
      status: "new",
      source: "storefront",
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone.trim(),
      governorate: input.governorate.trim(),
      address: input.address.trim(),
      customerNote: input.customerNote?.trim() || null,
      paymentMethod: "cash_on_delivery",
      subtotal,
    });
    const orderId = Number(created[0].insertId);
    await tx.insert(orderItems).values({
      orderId,
      productId: product.id,
      variantId: variant.id,
      productCodeSnapshot: product.productCode,
      productNameSnapshot: product.name,
      colorNameSnapshot: variant.colorName,
      unitPriceSnapshot: product.sellingPrice,
      quantity,
    });
    await tx.insert(orderStatusEvents).values({ orderId, fromStatus: null, toStatus: "new", actorUserId: null, source: "storefront", note: "طلب جديد من المتجر" });
    return { orderId, orderNumber, status: "new" as const };
  });
}

export async function listOperationalOrders() {
  const db = await getDb();
  if (!db) return [];
  const orderList = await db.select().from(orders).orderBy(desc(orders.createdAt));
  const items = await db.select().from(orderItems);
  return orderList.map(order => ({ ...order, items: items.filter(item => item.orderId === order.id) }));
}

export async function getOperationalOrder(orderId: number) {
  const db = await getDb();
  if (!db) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  const [items, events] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, orderId)).orderBy(desc(orderStatusEvents.createdAt), desc(orderStatusEvents.id)),
  ]);
  return { order, items, events };
}

const allowedNextStatuses: Record<OrderStatus, OrderStatus[]> = {
  new: ["needs_contact", "confirmed", "cancelled"],
  needs_contact: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export async function transitionOrderStatus(input: { orderId: number; nextStatus: OrderStatus; actorUserId: number; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
    if (!order) throw new Error("الطلب غير موجود.");
    if (!allowedNextStatuses[order.status].includes(input.nextStatus)) throw new Error("انتقال حالة الطلب غير مسموح.");
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    if (input.nextStatus === "confirmed" && !order.inventoryDeductedAt) {
      for (const item of items) {
        const deducted = await tx.update(productVariants)
          .set({ inventoryQuantity: sql`${productVariants.inventoryQuantity} - ${item.quantity}` })
          .where(and(eq(productVariants.id, item.variantId), sql`${productVariants.inventoryQuantity} >= ${item.quantity}`));
        if (Number(deducted[0].affectedRows) !== 1) throw new Error(`لا تتوفر كمية كافية للون «${item.colorNameSnapshot}».`);
      }
    }
    if (input.nextStatus === "cancelled" && order.inventoryDeductedAt) {
      for (const item of items) await tx.update(productVariants).set({ inventoryQuantity: sql`${productVariants.inventoryQuantity} + ${item.quantity}` }).where(eq(productVariants.id, item.variantId));
    }
    const inventoryDeductedAt = input.nextStatus === "confirmed" ? new Date() : input.nextStatus === "cancelled" && order.inventoryDeductedAt ? null : order.inventoryDeductedAt;
    await tx.update(orders).set({ status: input.nextStatus, inventoryDeductedAt, confirmedByUserId: input.nextStatus === "confirmed" ? input.actorUserId : order.confirmedByUserId }).where(eq(orders.id, order.id));
    await tx.insert(orderStatusEvents).values({ orderId: order.id, fromStatus: order.status, toStatus: input.nextStatus, actorUserId: input.actorUserId, source: "orders_ui", note: input.note?.trim() || null });
    return { status: input.nextStatus };
  });
}
