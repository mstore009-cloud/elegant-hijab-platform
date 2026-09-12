import { and, desc, eq, inArray } from "drizzle-orm";
import { customerBotOrderDrafts, customerProfiles, deliveryGovernorateRates, inboxConversations, orderItems, orders, orderStatusEvents, productMedia, productVariants, products, storeSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import type { BotActionDecision, BotFacts } from "./db";
import { recordOrderCustomerActivity, resolveCustomerForOrder } from "../crm/db";
import { notifyPermissionHolders } from "../notifications/db";

function money(value: number) { return Math.max(0, value).toFixed(2); }

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

export async function createCustomerBotOrderDraft(input: { storeId: number; conversationId: number; botRunId: number; facts: BotFacts; action: BotActionDecision }) {
  const db = await requireDb();
  if (input.action.type !== "order_summary") return null;
  const [conversation] = await db.select().from(inboxConversations).where(and(eq(inboxConversations.id, input.conversationId), eq(inboxConversations.storeId, input.storeId))).limit(1);
  if (!conversation) throw new Error("المحادثة غير موجودة في المتجر الحالي.");
  const productCode = input.action.productCode?.trim();
  if (!productCode) throw new Error("لا يمكن تجهيز ملخص طلب دون تحديد كود المنتج.");
  const [product] = await db.select().from(products).where(and(eq(products.storeId, input.storeId), eq(products.productCode, productCode), eq(products.status, "active"))).limit(1);
  if (!product) throw new Error("المنتج المحدد لم يعد متاحًا للطلب.");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, product.id));
  const requestedColor = input.action.colorName?.trim() || null;
  const variant = requestedColor ? variants.find(item => item.colorName === requestedColor && item.inventoryQuantity > 0 && item.availability !== "out_of_stock") : variants.find(item => item.inventoryQuantity > 0 && item.availability !== "out_of_stock");
  if (!variant) throw new Error(requestedColor ? `لون «${requestedColor}» لم يعد متاحًا.` : "يجب تحديد لون متوفر قبل تجهيز ملخص الطلب.");
  const [customer] = conversation.customerId ? await db.select().from(customerProfiles).where(and(eq(customerProfiles.id, conversation.customerId), eq(customerProfiles.storeId, input.storeId))).limit(1) : [];
  const quantity = input.action.quantity ?? 1;
  const subtotal = Number(product.sellingPrice) * quantity;
  const governorate = customer?.governorate?.trim() || null;
  const [store] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, input.storeId)).limit(1);
  const [rate] = governorate ? await db.select().from(deliveryGovernorateRates).where(and(eq(deliveryGovernorateRates.storeId, input.storeId), eq(deliveryGovernorateRates.governorate, governorate), eq(deliveryGovernorateRates.enabled, true))).limit(1) : [];
  const freeDelivery = Boolean(store?.freeDeliveryEnabled) && store?.freeDeliveryThreshold !== null && store?.freeDeliveryThreshold !== undefined && subtotal >= Number(store.freeDeliveryThreshold);
  const deliveryFee = freeDelivery ? 0 : Number(rate?.fee ?? store?.defaultDeliveryFee ?? 0);
  const customerName = customer?.displayName?.trim() || conversation.contactNameSnapshot?.trim() || null;
  const customerPhone = customer?.phoneDisplay?.trim() || conversation.contactPhoneSnapshot?.trim() || null;
  const address = customer?.lastAddress?.trim() || null;
  const missingFields = [
    !customerName ? "الاسم" : null,
    !customerPhone ? "رقم الهاتف" : null,
    !governorate ? "المحافظة" : null,
    !address ? "العنوان" : null,
  ].filter((value): value is string => Boolean(value));
  const total = subtotal + deliveryFee;
  const items = [{ productCode: product.productCode, productName: product.name, variantId: variant.id, colorName: variant.colorName, quantity, unitPrice: money(Number(product.sellingPrice)) }];
  const summaryText = [
    `المنتج: ${product.name} (${product.productCode})`,
    `اللون: ${variant.colorName}`,
    `الكمية: ${quantity}`,
    `المجموع الفرعي: ${money(subtotal)} ${store?.currencyCode ?? "IQD"}`,
    governorate ? `التوصيل إلى ${governorate}: ${money(deliveryFee)} ${store?.currencyCode ?? "IQD"}` : "التوصيل: يحتاج تحديد المحافظة",
    `الإجمالي: ${money(total)} ${store?.currencyCode ?? "IQD"}`,
  ].join("\n");
  const result = await db.insert(customerBotOrderDrafts).values({
    storeId: input.storeId,
    conversationId: conversation.id,
    botRunId: input.botRunId,
    customerId: conversation.customerId ?? null,
    status: missingFields.length ? "collecting" : "awaiting_confirmation",
    itemsJson: JSON.stringify(items),
    customerName,
    customerPhone,
    governorate,
    address,
    subtotal: money(subtotal),
    deliveryFee: money(deliveryFee),
    total: money(total),
    currencyCode: store?.currencyCode ?? "IQD",
    summaryText,
    missingFieldsJson: JSON.stringify(missingFields),
  });
  const [draft] = await db.select().from(customerBotOrderDrafts).where(eq(customerBotOrderDrafts.id, Number(result[0].insertId))).limit(1);
  return draft ?? null;
}

export async function listCustomerBotOrderDrafts(storeId: number) {
  const db = await requireDb();
  return db.select().from(customerBotOrderDrafts).where(and(eq(customerBotOrderDrafts.storeId, storeId), eq(customerBotOrderDrafts.status, "awaiting_confirmation"))).orderBy(desc(customerBotOrderDrafts.updatedAt)).limit(30);
}

export async function archiveCustomerBotOrderDraft(input: { storeId: number; draftId: number }) {
  const db = await requireDb();
  const [draft] = await db.select().from(customerBotOrderDrafts).where(and(eq(customerBotOrderDrafts.id, input.draftId), eq(customerBotOrderDrafts.storeId, input.storeId))).limit(1);
  if (!draft) throw new Error("مسودة طلب البوت غير موجودة في المتجر الحالي.");
  await db.update(customerBotOrderDrafts).set({ status: "archived" }).where(eq(customerBotOrderDrafts.id, draft.id));
  return { draftId: draft.id, status: "archived" as const };
}

function orderNumber() { return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

export async function createFinalOrderFromCustomerBotDraft(input: { storeId: number; draftId: number; actorUserId: number }) {
  const db = await requireDb();
  const [draft] = await db.select().from(customerBotOrderDrafts).where(and(eq(customerBotOrderDrafts.id, input.draftId), eq(customerBotOrderDrafts.storeId, input.storeId))).limit(1);
  if (!draft) throw new Error("مسودة طلب البوت غير موجودة في المتجر الحالي.");
  if (draft.status !== "awaiting_confirmation") throw new Error("لا يمكن إنشاء طلب نهائي قبل اكتمال بيانات المسودة وتأكيدها.");
  const missing = JSON.parse(draft.missingFieldsJson ?? "[]") as unknown[];
  if (missing.length || !draft.customerName || !draft.customerPhone || !draft.governorate || !draft.address) throw new Error("بيانات العميل أو العنوان غير مكتملة في المسودة.");
  const items = JSON.parse(draft.itemsJson) as Array<{ productCode: string; colorName: string; quantity: number }>;
  if (!items.length) throw new Error("مسودة الطلب لا تحتوي منتجات صالحة.");
  const created = await db.transaction(async tx => {
    const productCodes = Array.from(new Set(items.map(item => item.productCode)));
    const activeProducts = await tx.select().from(products).where(and(eq(products.storeId, input.storeId), eq(products.status, "active"), inArray(products.productCode, productCodes)));
    if (activeProducts.length !== productCodes.length) throw new Error("أحد منتجات المسودة لم يعد متاحًا.");
    const variants = await tx.select().from(productVariants).where(inArray(productVariants.productId, activeProducts.map(item => item.id)));
    const media = await tx.select().from(productMedia).where(inArray(productMedia.productId, activeProducts.map(item => item.id)));
    const resolved = items.map(item => {
      const product = activeProducts.find(candidate => candidate.productCode === item.productCode);
      const variant = variants.find(candidate => candidate.productId === product?.id && candidate.colorName === item.colorName && candidate.inventoryQuantity >= item.quantity && candidate.availability !== "out_of_stock");
      if (!product || !variant) throw new Error(`لون «${item.colorName}» لم يعد متاحًا بالكمية المطلوبة.`);
      const image = media.find(candidate => candidate.variantId === variant.id && candidate.mediaType === "image" && candidate.storageKey);
      return { product, variant, quantity: item.quantity, imageStorageKeySnapshot: image?.storageKey ?? null };
    });
    const subtotal = resolved.reduce((total, item) => total + Number(item.product.sellingPrice) * item.quantity, 0);
    const [store] = await tx.select().from(storeSettings).where(eq(storeSettings.storeId, input.storeId)).limit(1);
    const [rate] = await tx.select().from(deliveryGovernorateRates).where(and(eq(deliveryGovernorateRates.storeId, input.storeId), eq(deliveryGovernorateRates.governorate, draft.governorate!), eq(deliveryGovernorateRates.enabled, true))).limit(1);
    const freeDelivery = Boolean(store?.freeDeliveryEnabled) && store?.freeDeliveryThreshold !== null && store?.freeDeliveryThreshold !== undefined && subtotal >= Number(store.freeDeliveryThreshold);
    const deliveryFee = freeDelivery ? 0 : Number(rate?.fee ?? store?.defaultDeliveryFee ?? 0);
    const customer = await resolveCustomerForOrder(tx, { storeId: input.storeId, customerName: draft.customerName!, customerPhone: draft.customerPhone!, governorate: draft.governorate!, address: draft.address!, channel: "whatsapp", orderAt: new Date() });
    const [conversation] = await tx.select().from(inboxConversations).where(and(eq(inboxConversations.id, draft.conversationId), eq(inboxConversations.storeId, input.storeId))).limit(1);
    const channel = conversation?.channel === "instagram" || conversation?.channel === "messenger" || conversation?.channel === "whatsapp" ? conversation.channel : "whatsapp";
    const createdOrderNumber = orderNumber();
    const createdOrder = await tx.insert(orders).values({ storeId: input.storeId, customerId: customer.customerId, orderNumber: createdOrderNumber, status: "new", source: "whatsapp", customerChannel: channel, customerName: draft.customerName!, customerPhone: draft.customerPhone!, governorate: draft.governorate!, address: draft.address!, customerNote: `مُنشأ بعد مراجعة مسودة Bot-H3 #${draft.id}`, paymentMethod: "cash_on_delivery", subtotal: money(subtotal), deliveryFee: money(deliveryFee), manualDiscount: "0.00", total: money(subtotal + deliveryFee) });
    const orderId = Number(createdOrder[0].insertId);
    await tx.insert(orderItems).values(resolved.map(item => ({ orderId, productId: item.product.id, variantId: item.variant.id, productCodeSnapshot: item.product.productCode, productNameSnapshot: item.product.name, colorNameSnapshot: item.variant.colorName, imageStorageKeySnapshot: item.imageStorageKeySnapshot, unitPriceSnapshot: item.product.sellingPrice, quantity: item.quantity })));
    await tx.insert(orderStatusEvents).values({ orderId, fromStatus: null, toStatus: "new", actorUserId: input.actorUserId, source: "whatsapp", note: `من مسودة Bot-H3 #${draft.id}` });
    await recordOrderCustomerActivity(tx, { storeId: input.storeId, customerId: customer.customerId, orderId, orderNumber: createdOrderNumber, created: customer.created });
    await tx.update(customerBotOrderDrafts).set({ status: "archived" }).where(eq(customerBotOrderDrafts.id, draft.id));
    await tx.update(inboxConversations).set({ orderId, customerId: customer.customerId }).where(eq(inboxConversations.id, draft.conversationId));
    return { orderId, orderNumber: createdOrderNumber, customerId: customer.customerId };
  });
  try {
    await notifyPermissionHolders({ storeId: input.storeId, permissionCode: "orders.confirm", type: "order_created", priority: "action", title: `طلب جديد: ${created.orderNumber}`, body: `تم تحويل مسودة Bot-H3 #${draft.id} إلى طلب جديد بعد مراجعة موظف.`, entityType: "order", entityId: created.orderId, route: `/orders?order=${created.orderId}` });
  } catch (error) { console.warn("[BotOrderDraft] تعذر إرسال تنبيه الطلب:", error); }
  return created;
}
