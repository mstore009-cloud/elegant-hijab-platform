import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { deliveryGovernorateRates, orderContactEvents, orderItems, orders, orderStatusEvents, productMedia, productVariants, products, promotionCoupons, storeSettings } from "../../drizzle/schema";
import { getDb } from "../db";

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

export async function createStorefrontOrder(input: CreateStorefrontOrderInput) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
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
  const activeProducts = await db.select().from(products).where(and(inArray(products.productCode, productCodes), eq(products.status, "active")));
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
  const [settings] = await db.select().from(storeSettings).limit(1);
  const deliveryFee = Number(settings?.defaultDeliveryFee ?? 0);
  const orderNumber = createOrderNumber();
  return db.transaction(async tx => {
    const couponCode = input.couponCode?.trim().toUpperCase() || null;
    let couponDiscount = 0;
    if (couponCode) {
      const [coupon] = await tx.select().from(promotionCoupons).where(and(eq(promotionCoupons.code, couponCode), eq(promotionCoupons.enabled, true))).limit(1);
      const now = new Date();
      const unavailable = !coupon || (coupon.startsAt && coupon.startsAt > now) || (coupon.endsAt && coupon.endsAt < now) || (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) || subtotalNumber < Number(coupon.minimumSubtotal);
      if (unavailable) throw new Error("القسيمة لم تعد متاحة لهذا الطلب.");
      const rawDiscount = coupon.discountType === "percent" ? subtotalNumber * Number(coupon.discountValue) / 100 : Number(coupon.discountValue);
      couponDiscount = Math.min(subtotalNumber, rawDiscount);
      const usageUpdate = await tx.update(promotionCoupons).set({ usageCount: sql`${promotionCoupons.usageCount} + 1` }).where(and(eq(promotionCoupons.id, coupon.id), coupon.usageLimit === null ? sql`1 = 1` : sql`${promotionCoupons.usageCount} < ${coupon.usageLimit}`));
      if (Number(usageUpdate[0].affectedRows) !== 1) throw new Error("وصلت القسيمة إلى حد الاستخدام.");
    }
    const created = await tx.insert(orders).values({ orderNumber, status: "new", source: "storefront", customerChannel: "storefront", customerName: input.customerName.trim(), customerPhone: input.customerPhone.trim(), governorate: input.governorate.trim(), address: input.address.trim(), customerNote: input.customerNote?.trim() || null, paymentMethod: "cash_on_delivery", subtotal, deliveryFee: money(deliveryFee), manualDiscount: money(couponDiscount), total: money(Math.max(0, subtotalNumber - couponDiscount + deliveryFee)) });
    const orderId = Number(created[0].insertId);
    await tx.insert(orderItems).values(resolved.map(item => ({ orderId, productId: item.product.id, variantId: item.variant.id, productCodeSnapshot: item.product.productCode, productNameSnapshot: item.product.name, colorNameSnapshot: item.variant.colorName, imageStorageKeySnapshot: item.imageStorageKeySnapshot, unitPriceSnapshot: item.product.sellingPrice, quantity: item.quantity })));
    await tx.insert(orderStatusEvents).values({ orderId, fromStatus: null, toStatus: "new", actorUserId: null, source: "storefront", note: "طلب جديد من المتجر" });
    return { orderId, orderNumber, status: "new" as const };
  });
}

export async function getPublicDeliveryFee() {
  const db = await getDb(); if (!db) return { fee: "0.00", configured: false };
  const [settings] = await db.select().from(storeSettings).limit(1);
  return { fee: settings?.defaultDeliveryFee ?? "0.00", configured: Boolean(settings) };
}

export async function getPublicStoreSettings() {
  const db = await getDb(); if (!db) return { language: "ar", currencyCode: "IQD", deliveryFee: "0.00" };
  const [settings] = await db.select().from(storeSettings).limit(1);
  return { language: settings?.defaultLanguage ?? "ar", currencyCode: settings?.currencyCode ?? "IQD", deliveryFee: settings?.defaultDeliveryFee ?? "0.00" };
}

export async function validatePublicCoupon(code: string, subtotal: number) {
  const db = await getDb(); if (!db || !code.trim()) return { valid: false, discount: "0.00", message: "أدخل كود القسيمة." };
  const [coupon] = await db.select().from(promotionCoupons).where(and(eq(promotionCoupons.code, code.trim().toUpperCase()), eq(promotionCoupons.enabled, true))).limit(1);
  const now = new Date();
  if (!coupon || (coupon.startsAt && coupon.startsAt > now) || (coupon.endsAt && coupon.endsAt < now) || (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) || subtotal < Number(coupon.minimumSubtotal)) return { valid: false, discount: "0.00", message: "القسيمة غير متاحة لهذا الطلب." };
  const raw = coupon.discountType === "percent" ? subtotal * Number(coupon.discountValue) / 100 : Number(coupon.discountValue);
  return { valid: true, discount: money(Math.min(subtotal, raw)), message: "تم تطبيق القسيمة." };
}

export async function getStoreSettingsForStaff() {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [settings] = await db.select().from(storeSettings).limit(1);
  return settings ?? { id: 0, defaultLanguage: "ar", currencyCode: "IQD", defaultDeliveryFee: "0.00", updatedByUserId: null, updatedAt: null };
}

export async function saveStoreSettings(input: { defaultLanguage: string; currencyCode: string; defaultDeliveryFee: number; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [existing] = await db.select({ id: storeSettings.id }).from(storeSettings).limit(1);
  const values = { defaultLanguage: input.defaultLanguage.trim().toLowerCase(), currencyCode: input.currencyCode.trim().toUpperCase(), defaultDeliveryFee: money(Math.max(0, Number(input.defaultDeliveryFee) || 0)), updatedByUserId: input.actorUserId };
  if (existing) await db.update(storeSettings).set(values).where(eq(storeSettings.id, existing.id));
  else await db.insert(storeSettings).values(values);
  return getStoreSettingsForStaff();
}

export async function listPromotionCoupons() {
  const db = await getDb(); if (!db) return [];
  return db.select().from(promotionCoupons).orderBy(desc(promotionCoupons.createdAt));
}

export async function savePromotionCoupon(input: { id?: number; code: string; discountType: "fixed" | "percent"; discountValue: number; minimumSubtotal: number; startsAt?: Date | null; endsAt?: Date | null; usageLimit?: number | null; enabled: boolean; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("كود القسيمة مطلوب.");
  if (input.discountType === "percent" && input.discountValue > 100) throw new Error("لا يمكن أن تتجاوز نسبة الخصم 100٪.");
  if (input.startsAt && input.endsAt && input.endsAt < input.startsAt) throw new Error("تاريخ النهاية يجب أن يأتي بعد تاريخ البداية.");
  const values = { code, discountType: input.discountType, discountValue: money(Math.max(0, input.discountValue)), minimumSubtotal: money(Math.max(0, input.minimumSubtotal)), startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, usageLimit: input.usageLimit ?? null, enabled: input.enabled };
  if (input.id) {
    const [existing] = await db.select({ id: promotionCoupons.id }).from(promotionCoupons).where(eq(promotionCoupons.id, input.id)).limit(1);
    if (!existing) throw new Error("القسيمة غير موجودة.");
    await db.update(promotionCoupons).set(values).where(eq(promotionCoupons.id, input.id));
  } else await db.insert(promotionCoupons).values({ ...values, createdByUserId: input.actorUserId });
  return listPromotionCoupons();
}

export async function listDeliveryRates() {
  const db = await getDb(); if (!db) return [];
  return db.select().from(deliveryGovernorateRates).orderBy(deliveryGovernorateRates.governorate);
}

export async function saveDeliveryRate(input: { governorate: string; fee: number; enabled: boolean; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const governorate = input.governorate.trim(); const fee = Math.max(0, Number(input.fee) || 0);
  const [existing] = await db.select({ id: deliveryGovernorateRates.id }).from(deliveryGovernorateRates).where(eq(deliveryGovernorateRates.governorate, governorate)).limit(1);
  if (existing) await db.update(deliveryGovernorateRates).set({ fee: money(fee), enabled: input.enabled, updatedByUserId: input.actorUserId }).where(eq(deliveryGovernorateRates.id, existing.id));
  else await db.insert(deliveryGovernorateRates).values({ governorate, fee: money(fee), enabled: input.enabled, updatedByUserId: input.actorUserId });
  return getPublicDeliveryFee();
}

export async function listOperationalOrders() {
  const db = await getDb(); if (!db) return [];
  const [orderList, items] = await Promise.all([db.select().from(orders).orderBy(desc(orders.createdAt)), db.select().from(orderItems)]);
  return orderList.map(order => ({ ...order, items: items.filter(item => item.orderId === order.id) }));
}

export async function getOperationalOrder(orderId: number) {
  const db = await getDb(); if (!db) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1); if (!order) return null;
  const [items, events, contacts] = await Promise.all([db.select().from(orderItems).where(eq(orderItems.orderId, orderId)), db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, orderId)).orderBy(desc(orderStatusEvents.createdAt), desc(orderStatusEvents.id)), db.select().from(orderContactEvents).where(eq(orderContactEvents.orderId, orderId)).orderBy(desc(orderContactEvents.createdAt), desc(orderContactEvents.id))]);
  return { order, items, events, contacts };
}

export async function updateOrderCommercialTerms(input: { orderId: number; deliveryFee: number; manualDiscount: number; customerChannel: CustomerChannel; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [order] = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1); if (!order) throw new Error("الطلب غير موجود.");
  const deliveryFee = Math.max(0, Number(input.deliveryFee) || 0); const manualDiscount = Math.max(0, Number(input.manualDiscount) || 0);
  const total = Math.max(0, Number(order.subtotal) + deliveryFee - manualDiscount);
  await db.update(orders).set({ deliveryFee: money(deliveryFee), manualDiscount: money(manualDiscount), customerChannel: input.customerChannel, total: money(total) }).where(eq(orders.id, order.id));
  return { total: money(total) };
}

export async function addOrderContactEvent(input: { orderId: number; channel: CustomerChannel; outcome: ContactOutcome; note?: string | null; actorUserId: number }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId)).limit(1); if (!order) throw new Error("الطلب غير موجود.");
  const result = await db.insert(orderContactEvents).values({ orderId: input.orderId, channel: input.channel, outcome: input.outcome, note: input.note?.trim() || null, actorUserId: input.actorUserId });
  return { contactEventId: Number(result[0].insertId) };
}

const allowedNextStatuses: Record<OrderStatus, OrderStatus[]> = { new: ["needs_contact", "confirmed", "cancelled"], needs_contact: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["out_for_delivery", "cancelled"], out_for_delivery: ["completed", "cancelled"], completed: [], cancelled: [] };
export async function transitionOrderStatus(input: { orderId: number; nextStatus: OrderStatus; actorUserId: number; note?: string | null }) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1); if (!order) throw new Error("الطلب غير موجود.");
    if (!allowedNextStatuses[order.status].includes(input.nextStatus)) throw new Error("انتقال حالة الطلب غير مسموح.");
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    if (input.nextStatus === "confirmed" && !order.inventoryDeductedAt) for (const item of items) { const deducted = await tx.update(productVariants).set({ inventoryQuantity: sql`${productVariants.inventoryQuantity} - ${item.quantity}` }).where(and(eq(productVariants.id, item.variantId), sql`${productVariants.inventoryQuantity} >= ${item.quantity}`)); if (Number(deducted[0].affectedRows) !== 1) throw new Error(`لا تتوفر كمية كافية للون «${item.colorNameSnapshot}».`); }
    if (input.nextStatus === "cancelled" && order.inventoryDeductedAt) for (const item of items) await tx.update(productVariants).set({ inventoryQuantity: sql`${productVariants.inventoryQuantity} + ${item.quantity}` }).where(eq(productVariants.id, item.variantId));
    const inventoryDeductedAt = input.nextStatus === "confirmed" ? new Date() : input.nextStatus === "cancelled" && order.inventoryDeductedAt ? null : order.inventoryDeductedAt;
    await tx.update(orders).set({ status: input.nextStatus, inventoryDeductedAt, confirmedByUserId: input.nextStatus === "confirmed" ? input.actorUserId : order.confirmedByUserId }).where(eq(orders.id, order.id));
    await tx.insert(orderStatusEvents).values({ orderId: order.id, fromStatus: order.status, toStatus: input.nextStatus, actorUserId: input.actorUserId, source: "orders_ui", note: input.note?.trim() || null });
    return { status: input.nextStatus };
  });
}
