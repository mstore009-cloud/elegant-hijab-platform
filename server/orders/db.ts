import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { deliveryGovernorateRates, orderContactEvents, orderItems, orders, orderStatusEvents, productMedia, productVariants, products, promotionCoupons, storeSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { getPublicStore } from "../stores/db";
import { recordOrderCustomerActivity, recordOrderStatusCustomerActivity, resolveCustomerForOrder } from "../crm/db";
import { notifyPermissionHolders } from "../notifications/db";

export const orderStatuses = ["new", "needs_contact", "confirmed", "preparing", "out_for_delivery", "completed", "cancelled"] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export const customerChannels = ["storefront", "whatsapp", "instagram", "messenger", "manual"] as const;
export type CustomerChannel = (typeof customerChannels)[number];
export const contactOutcomes = ["attempted", "no_answer", "customer_confirmed", "customer_requested_change", "cancelled"] as const;
export type ContactOutcome = (typeof contactOutcomes)[number];

type CartItemInput = { productCode: string; colorName: string; quantity: number };
type CreateStorefrontOrderInput = { items: CartItemInput[]; customerName: string; customerPhone: string; governorate: string; address: string; customerNote?: string | null; couponCode?: string | null };
function createOrderNumber() { return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
function money(value: number) { return value.toFixed(2); }
async function requirePublicStoreId() {
  const store = await getPublicStore();
  if (!store) throw new Error("المتجر العام غير مهيأ حاليًا.");
  return store.id;
}
export function deliveryTerms(settings: { defaultDeliveryFee: string; freeDeliveryEnabled: boolean; freeDeliveryThreshold: string | null } | undefined, subtotal: number) {
  const threshold = settings?.freeDeliveryThreshold === null || settings?.freeDeliveryThreshold === undefined ? null : Number(settings.freeDeliveryThreshold);
  const freeDelivery = Boolean(settings?.freeDeliveryEnabled) && threshold !== null && threshold > 0 && subtotal >= threshold;
  return { fee: freeDelivery ? 0 : Number(settings?.defaultDeliveryFee ?? 0), freeDelivery, threshold };
}

export async function createStorefrontOrder(input: CreateStorefrontOrderInput) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const storeId = await requirePublicStoreId();
  const grouped = new Map<string, CartItemInput>();
  for (const item of input.items) {
    const productCode = item.productCode.trim(); const colorName = item.colorName.trim(); const quantity = Math.max(1, Math.min(100, Math.floor(item.quantity)));
    if (!productCode || !colorName) throw new Error("اختيار المنتج واللون مطلوب.");
    const key = `${productCode}::${colorName}`; const existing = grouped.get(key);
    grouped.set(key, { productCode, colorName, quantity: Math.min(100, quantity + (existing?.quantity ?? 0)) });
  }
  const requested = Array.from(grouped.values());
  if (!requested.length) throw new Error("أضيفي منتجًا واحدًا على الأقل إلى السلة.");
  const productCodes = Array.from(new Set(requested.map(item => item.productCode)));
  const activeProducts = await db.select().from(products).where(and(eq(products.storeId, storeId), inArray(products.productCode, productCodes), eq(products.status, "active")));
  if (activeProducts.length !== productCodes.length) throw new Error("أحد المنتجات لم يعد متاحًا للطلب.");
  const variants = await db.select().from(productVariants).where(inArray(productVariants.productId, activeProducts.map(product => product.id)));
  const media = await db.select().from(productMedia).where(inArray(productMedia.productId, activeProducts.map(product => product.id)));
  const resolved = requested.map(item => {
    const product = activeProducts.find(candidate => candidate.productCode === item.productCode);
    const variant = variants.find(candidate => candidate.productId === product?.id && candidate.colorName === item.colorName);
    if (!product || !variant) throw new Error(`لون «${item.colorName}» لم يعد متاحًا.`);
    const image = media.find(candidate => candidate.variantId === variant.id && candidate.mediaType === "image" && candidate.storageKey);
    return { product, variant, quantity: item.quantity, imageStorageKeySnapshot: image?.storageKey ?? null };
  });
  const subtotalNumber = resolved.reduce((total, item) => total + Number(item.product.sellingPrice) * item.quantity, 0);
  const subtotal = money(subtotalNumber);
  const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, storeId)).limit(1);
  const deliveryFee = deliveryTerms(settings, subtotalNumber).fee;
  const orderNumber = createOrderNumber();
  const createdOrder = await db.transaction(async tx => {
    const customer = await resolveCustomerForOrder(tx, {
      storeId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      governorate: input.governorate,
      address: input.address,
      channel: "storefront",
      orderAt: new Date(),
    });
    const couponCode = input.couponCode?.trim().toUpperCase() || null;
    let couponDiscount = 0;
    if (couponCode) {
      const [coupon] = await tx.select().from(promotionCoupons).where(and(eq(promotionCoupons.storeId, storeId), eq(promotionCoupons.code, couponCode), eq(promotionCoupons.enabled, true))).limit(1);
      const now = new Date();
      const unavailable = !coupon || (coupon.startsAt && coupon.startsAt > now) || (coupon.endsAt && coupon.endsAt < now) || (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) || subtotalNumber < Number(coupon.minimumSubtotal);
      if (unavailable) throw new Error("القسيمة لم تعد متاحة لهذا الطلب.");
      const rawDiscount = coupon.discountType === "percent" ? subtotalNumber * Number(coupon.discountValue) / 100 : Number(coupon.discountValue);
      couponDiscount = Math.min(subtotalNumber, rawDiscount);
      const usageUpdate = await tx.update(promotionCoupons).set({ usageCount: sql`${promotionCoupons.usageCount} + 1` }).where(and(eq(promotionCoupons.id, coupon.id), coupon.usageLimit === null ? sql`1 = 1` : sql`${promotionCoupons.usageCount} < ${coupon.usageLimit}`));
      if (Number(usageUpdate[0].affectedRows) !== 1) throw new Error("وصلت القسيمة إلى حد الاستخدام.");
    }
    const created = await tx.insert(orders).values({ storeId, customerId: customer.customerId, orderNumber, status: "new", source: "storefront", customerChannel: "storefront", customerName: input.customerName.trim(), customerPhone: input.customerPhone.trim(), governorate: input.governorate.trim(), address: input.address.trim(), customerNote: input.customerNote?.trim() || null, paymentMethod: "cash_on_delivery", subtotal, deliveryFee: money(deliveryFee), manualDiscount: money(couponDiscount), total: money(Math.max(0, subtotalNumber - couponDiscount + deliveryFee)) });
    const orderId = Number(created[0].insertId);
    await tx.insert(orderItems).values(resolved.map(item => ({ orderId, productId: item.product.id, variantId: item.variant.id, productCodeSnapshot: item.product.productCode, productNameSnapshot: item.product.name, colorNameSnapshot: item.variant.colorName, imageStorageKeySnapshot: item.imageStorageKeySnapshot, unitPriceSnapshot: item.product.sellingPrice, quantity: item.quantity })));
    await tx.insert(orderStatusEvents).values({ orderId, fromStatus: null, toStatus: "new", actorUserId: null, source: "storefront", note: "طلب جديد من المتجر" });
    await recordOrderCustomerActivity(tx, { storeId, customerId: customer.customerId, orderId, orderNumber, created: customer.created });
    return { orderId, orderNumber, status: "new" as const };
  });
  try {
    await notifyPermissionHolders({ storeId, permissionCode: "orders.confirm", type: "order_created", priority: "action", title: `طلب جديد: ${createdOrder.orderNumber}`, body: "يوجد طلب جديد بحاجة إلى مراجعة وتأكيد.", entityType: "order", entityId: createdOrder.orderId, route: `/orders?order=${createdOrder.orderId}` });
  } catch (error) {
    console.warn("[Notifications] تعذر إنشاء تنبيه طلب جديد:", error);
  }
  return createdOrder;
}

export async function getPublicDeliveryFee(subtotal = 0) {
  const db = await getDb(); if (!db) return { fee: "0.00", configured: false, freeDelivery: false, threshold: null };
  const store = await getPublicStore(); if (!store) return { fee: "0.00", configured: false, freeDelivery: false, threshold: null };
  const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, store.id)).limit(1);
  const terms = deliveryTerms(settings, subtotal);
  return { fee: money(terms.fee), configured: Boolean(settings), freeDelivery: terms.freeDelivery, threshold: terms.threshold === null ? null : money(terms.threshold) };
}

export async function getPublicStoreSettings() {
  const db = await getDb(); if (!db) return { language: "ar", currencyCode: "IQD", deliveryFee: "0.00", freeDeliveryEnabled: false, freeDeliveryThreshold: null };
  const store = await getPublicStore(); if (!store) return { language: "ar", currencyCode: "IQD", deliveryFee: "0.00", freeDeliveryEnabled: false, freeDeliveryThreshold: null };
  const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, store.id)).limit(1);
  return { language: settings?.defaultLanguage ?? "ar", currencyCode: settings?.currencyCode ?? "IQD", deliveryFee: settings?.defaultDeliveryFee ?? "0.00", freeDeliveryEnabled: settings?.freeDeliveryEnabled ?? false, freeDeliveryThreshold: settings?.freeDeliveryThreshold ?? null };
}

export async function validatePublicCoupon(code: string, subtotal: number) {
  const db = await getDb(); if (!db || !code.trim()) return { valid: false, discount: "0.00", message: "أدخل كود القسيمة." };
  const store = await getPublicStore(); if (!store) return { valid: false, discount: "0.00", message: "القسيمة غير متاحة لهذا الطلب." };
  const [coupon] = await db.select().from(promotionCoupons).where(and(eq(promotionCoupons.storeId, store.id), eq(promotionCoupons.code, code.trim().toUpperCase()), eq(promotionCoupons.enabled, true))).limit(1);
  const now = new Date();
  if (!coupon || (coupon.startsAt && coupon.startsAt > now) || (coupon.endsAt && coupon.endsAt < now) || (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) || subtotal < Number(coupon.minimumSubtotal)) return { valid: false, discount: "0.00", message: "القسيمة غير متاحة لهذا الطلب." };
  const raw = coupon.discountType === "percent" ? subtotal * Number(coupon.discountValue) / 100 : Number(coupon.discountValue);
  const discount = money(Math.min(subtotal, raw));
  return { valid: true, discount, message: `تم تطبيق القسيمة بنجاح. وفّرتِ ${discount} د.ع.` };
}

export async function getStoreSettingsForStaff(storeId: number) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, storeId)).limit(1);
  return settings ?? { id: 0, storeId, defaultLanguage: "ar", currencyCode: "IQD", defaultDeliveryFee: "0.00", freeDeliveryEnabled: false, freeDeliveryThreshold: null, updatedByUserId: null, updatedAt: null };
}

export async function saveStoreSettings(input: { storeId: number; defaultLanguage: string; currencyCode: string; defaultDeliveryFee: number; freeDeliveryEnabled: boolean; freeDeliveryThreshold?: number | null; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [existing] = await db.select({ id: storeSettings.id }).from(storeSettings).where(eq(storeSettings.storeId, input.storeId)).limit(1);
  const values = { defaultLanguage: input.defaultLanguage.trim().toLowerCase(), currencyCode: input.currencyCode.trim().toUpperCase(), defaultDeliveryFee: money(Math.max(0, Number(input.defaultDeliveryFee) || 0)), freeDeliveryEnabled: input.freeDeliveryEnabled, freeDeliveryThreshold: input.freeDeliveryThreshold === null || input.freeDeliveryThreshold === undefined ? null : money(Math.max(0, Number(input.freeDeliveryThreshold) || 0)), updatedByUserId: input.actorUserId };
  if (existing) await db.update(storeSettings).set(values).where(eq(storeSettings.id, existing.id));
  else await db.insert(storeSettings).values({ ...values, storeId: input.storeId });
  return getStoreSettingsForStaff(input.storeId);
}

export async function listPromotionCoupons(storeId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(promotionCoupons).where(eq(promotionCoupons.storeId, storeId)).orderBy(desc(promotionCoupons.createdAt));
}

export async function savePromotionCoupon(input: { storeId: number; id?: number; code: string; discountType: "fixed" | "percent"; discountValue: number; minimumSubtotal: number; startsAt?: Date | null; endsAt?: Date | null; usageLimit?: number | null; enabled: boolean; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("كود القسيمة مطلوب.");
  if (input.discountType === "percent" && input.discountValue > 100) throw new Error("لا يمكن أن تتجاوز نسبة الخصم 100٪.");
  if (input.startsAt && input.endsAt && input.endsAt < input.startsAt) throw new Error("تاريخ النهاية يجب أن يأتي بعد تاريخ البداية.");
  const values = { code, discountType: input.discountType, discountValue: money(Math.max(0, input.discountValue)), minimumSubtotal: money(Math.max(0, input.minimumSubtotal)), startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, usageLimit: input.usageLimit ?? null, enabled: input.enabled };
  if (input.id) {
    const [existing] = await db.select({ id: promotionCoupons.id }).from(promotionCoupons).where(and(eq(promotionCoupons.id, input.id), eq(promotionCoupons.storeId, input.storeId))).limit(1);
    if (!existing) throw new Error("القسيمة غير موجودة.");
    await db.update(promotionCoupons).set(values).where(eq(promotionCoupons.id, input.id));
  } else await db.insert(promotionCoupons).values({ ...values, storeId: input.storeId, createdByUserId: input.actorUserId });
  return listPromotionCoupons(input.storeId);
}

export async function listDeliveryRates(storeId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(deliveryGovernorateRates).where(eq(deliveryGovernorateRates.storeId, storeId)).orderBy(deliveryGovernorateRates.governorate);
}

export async function saveDeliveryRate(input: { storeId: number; governorate: string; fee: number; enabled: boolean; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const governorate = input.governorate.trim(); const fee = Math.max(0, Number(input.fee) || 0);
  const [existing] = await db.select({ id: deliveryGovernorateRates.id }).from(deliveryGovernorateRates).where(and(eq(deliveryGovernorateRates.storeId, input.storeId), eq(deliveryGovernorateRates.governorate, governorate))).limit(1);
  if (existing) await db.update(deliveryGovernorateRates).set({ fee: money(fee), enabled: input.enabled, updatedByUserId: input.actorUserId }).where(eq(deliveryGovernorateRates.id, existing.id));
  else await db.insert(deliveryGovernorateRates).values({ storeId: input.storeId, governorate, fee: money(fee), enabled: input.enabled, updatedByUserId: input.actorUserId });
  return getPublicDeliveryFee();
}

export async function listOperationalOrders(storeId: number) {
  const db = await getDb(); if (!db) return [];
  const [orderList, items] = await Promise.all([db.select().from(orders).where(eq(orders.storeId, storeId)).orderBy(desc(orders.createdAt)), db.select().from(orderItems)]);
  return orderList.map(order => ({ ...order, items: items.filter(item => item.orderId === order.id) }));
}

export async function getOperationalOrder(orderId: number, storeId: number) {
  const db = await getDb(); if (!db) return null;
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, storeId))).limit(1); if (!order) return null;
  const [items, events, contacts] = await Promise.all([db.select().from(orderItems).where(eq(orderItems.orderId, orderId)), db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, orderId)).orderBy(desc(orderStatusEvents.createdAt), desc(orderStatusEvents.id)), db.select().from(orderContactEvents).where(eq(orderContactEvents.orderId, orderId)).orderBy(desc(orderContactEvents.createdAt), desc(orderContactEvents.id))]);
  return { order, items, events, contacts };
}

export async function updateOrderCommercialTerms(input: { storeId: number; orderId: number; deliveryFee: number; manualDiscount: number; customerChannel: CustomerChannel; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [order] = await db.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.storeId, input.storeId))).limit(1); if (!order) throw new Error("الطلب غير موجود.");
  const deliveryFee = Math.max(0, Number(input.deliveryFee) || 0); const manualDiscount = Math.max(0, Number(input.manualDiscount) || 0);
  const total = Math.max(0, Number(order.subtotal) + deliveryFee - manualDiscount);
  await db.update(orders).set({ deliveryFee: money(deliveryFee), manualDiscount: money(manualDiscount), customerChannel: input.customerChannel, total: money(total) }).where(eq(orders.id, order.id));
  return { total: money(total) };
}

export async function addOrderContactEvent(input: { storeId: number; orderId: number; channel: CustomerChannel; outcome: ContactOutcome; note?: string | null; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [order] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, input.orderId), eq(orders.storeId, input.storeId))).limit(1); if (!order) throw new Error("الطلب غير موجود.");
  const result = await db.insert(orderContactEvents).values({ orderId: input.orderId, channel: input.channel, outcome: input.outcome, note: input.note?.trim() || null, actorUserId: input.actorUserId });
  return { contactEventId: Number(result[0].insertId) };
}

const allowedNextStatuses: Record<OrderStatus, OrderStatus[]> = { new: ["needs_contact", "confirmed", "cancelled"], needs_contact: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["out_for_delivery", "cancelled"], out_for_delivery: ["completed", "cancelled"], completed: [], cancelled: [] };
export async function transitionOrderStatus(input: { storeId: number; orderId: number; nextStatus: OrderStatus; actorUserId: number; note?: string | null }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.storeId, input.storeId))).limit(1); if (!order) throw new Error("الطلب غير موجود.");
    if (!allowedNextStatuses[order.status].includes(input.nextStatus)) throw new Error("انتقال حالة الطلب غير مسموح.");
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    if (input.nextStatus === "confirmed" && !order.inventoryDeductedAt) for (const item of items) { const deducted = await tx.update(productVariants).set({ inventoryQuantity: sql`${productVariants.inventoryQuantity} - ${item.quantity}` }).where(and(eq(productVariants.id, item.variantId), sql`${productVariants.inventoryQuantity} >= ${item.quantity}`)); if (Number(deducted[0].affectedRows) !== 1) throw new Error(`لا تتوفر كمية كافية للون «${item.colorNameSnapshot}».`); }
    if (input.nextStatus === "cancelled" && order.inventoryDeductedAt) for (const item of items) await tx.update(productVariants).set({ inventoryQuantity: sql`${productVariants.inventoryQuantity} + ${item.quantity}` }).where(eq(productVariants.id, item.variantId));
    const inventoryDeductedAt = input.nextStatus === "confirmed" ? new Date() : input.nextStatus === "cancelled" && order.inventoryDeductedAt ? null : order.inventoryDeductedAt;
    await tx.update(orders).set({ status: input.nextStatus, inventoryDeductedAt, confirmedByUserId: input.nextStatus === "confirmed" ? input.actorUserId : order.confirmedByUserId }).where(eq(orders.id, order.id));
    await tx.insert(orderStatusEvents).values({ orderId: order.id, fromStatus: order.status, toStatus: input.nextStatus, actorUserId: input.actorUserId, source: "orders_ui", note: input.note?.trim() || null });
    await recordOrderStatusCustomerActivity(tx, { storeId: input.storeId, customerId: order.customerId, orderId: order.id, nextStatus: input.nextStatus, actorUserId: input.actorUserId, note: input.note });
    return { status: input.nextStatus };
  });
}
