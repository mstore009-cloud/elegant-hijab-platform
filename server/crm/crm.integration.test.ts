import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { customerActivities, customerProfiles, customerTagAssignments, customerTags, customerTasks, employeeProfiles, orderItems, orders, orderStatusEvents, productVariants, products, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { createStorefrontOrder, getOperationalOrder, transitionOrderStatus } from "../orders/db";
import { getPublicStore } from "../stores/db";
import { assignCustomerTag, createCustomerTask, getCustomerDetail, listCustomers, normalizeCustomerPhone, updateCustomerProfile } from "./db";

type Cleanup = { customerIds: number[]; tagIds: number[]; taskIds: number[]; orderIds: number[]; productIds: number[]; variantIds: number[]; employeeIds: number[]; userIds: number[]; storeIds: number[] };
const cleanups: Cleanup[] = [];

function phone() { return `078${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`; }

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    for (const customerId of cleanup.customerIds) {
      await db.delete(customerActivities).where(eq(customerActivities.customerId, customerId));
      await db.delete(customerTagAssignments).where(eq(customerTagAssignments.customerId, customerId));
      await db.delete(customerTasks).where(eq(customerTasks.customerId, customerId));
    }
    for (const taskId of cleanup.taskIds) await db.delete(customerTasks).where(eq(customerTasks.id, taskId));
    for (const tagId of cleanup.tagIds) {
      await db.delete(customerTagAssignments).where(eq(customerTagAssignments.tagId, tagId));
      await db.delete(customerTags).where(eq(customerTags.id, tagId));
    }
    for (const orderId of cleanup.orderIds) {
      await db.delete(orderStatusEvents).where(eq(orderStatusEvents.orderId, orderId));
      await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
      await db.delete(orders).where(eq(orders.id, orderId));
    }
    for (const customerId of cleanup.customerIds) await db.delete(customerProfiles).where(eq(customerProfiles.id, customerId));
    for (const variantId of cleanup.variantIds) await db.delete(productVariants).where(eq(productVariants.id, variantId));
    for (const productId of cleanup.productIds) await db.delete(products).where(eq(products.id, productId));
    for (const employeeId of cleanup.employeeIds) await db.delete(employeeProfiles).where(eq(employeeProfiles.id, employeeId));
    for (const userId of cleanup.userIds) await db.delete(users).where(eq(users.id, userId));
    for (const storeId of cleanup.storeIds) await db.delete(stores).where(eq(stores.id, storeId));
  }
});

describe("CRM متعدد المتاجر", () => {
  it("يوحّد أرقام الهاتف العربية واللاتينية إلى مفتاح واحد", () => {
    expect(normalizeCustomerPhone("+964 (٧٧٠) 000-0000")).toBe("9647700000000");
    expect(normalizeCustomerPhone("+964 (۷۷۰) 000-0000")).toBe("9647700000000");
  });

  it("ينشئ ويربط ملف العميل عند الطلب ويحافظ على لقطات الطلب بعد تعديل العميل ويسجل أحداثه", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار CRM.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    const store = await getPublicStore();
    if (!owner || !store) throw new Error("لا توجد بيانات تشغيلية لاختبار CRM.");
    const productResult = await db.insert(products).values({ storeId: store.id, productCode: `CRM-${randomUUID().slice(0, 10)}`, name: "حجاب اختبار CRM", status: "active", sellingPrice: "12000.00", createdByUserId: owner.id });
    const productId = Number(productResult[0].insertId);
    const variantResult = await db.insert(productVariants).values({ productId, colorName: "بيج", inventoryQuantity: 2, availability: "available" });
    const variantId = Number(variantResult[0].insertId);
    const productCode = (await db.select({ productCode: products.productCode }).from(products).where(eq(products.id, productId)).limit(1))[0]!.productCode;
    const customerPhone = phone();
    const created = await createStorefrontOrder({ items: [{ productCode, colorName: "بيج", quantity: 1 }], customerName: "عميلة لقطة تاريخية", customerPhone, governorate: "بغداد", address: "عنوان لقطة تاريخية" });
    const repeated = await createStorefrontOrder({ items: [{ productCode, colorName: "بيج", quantity: 1 }], customerName: "عميلة لقطة تاريخية", customerPhone: customerPhone.replace(/[0-9]/g, digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!), governorate: "بغداد", address: "عنوان لقطة تاريخية" });
    const order = (await getOperationalOrder(created.orderId, store.id))!.order;
    const customerId = order.customerId!;
    cleanups.push({ customerIds: [customerId], tagIds: [], taskIds: [], orderIds: [created.orderId, repeated.orderId], productIds: [productId], variantIds: [variantId], employeeIds: [], userIds: [], storeIds: [] });

    expect(customerId).toBeTypeOf("number");
    expect((await getOperationalOrder(repeated.orderId, store.id))!.order.customerId).toBe(customerId);
    expect((await db.select().from(customerProfiles).where(eq(customerProfiles.id, customerId))).length).toBe(1);
    const initialDetail = await getCustomerDetail(store.id, customerId);
    expect(initialDetail?.activities.map(activity => activity.type)).toEqual(expect.arrayContaining(["profile_created", "order_created"]));

    await updateCustomerProfile({ storeId: store.id, customerId, displayName: "اسم حالي مختلف", phoneDisplay: order.customerPhone, governorate: "النجف", lastAddress: "عنوان حالي مختلف", relationshipStage: "needs_followup", actorUserId: owner.id });
    const unchangedOrder = (await getOperationalOrder(created.orderId, store.id))!.order;
    expect(unchangedOrder).toMatchObject({ customerName: "عميلة لقطة تاريخية", governorate: "بغداد", address: "عنوان لقطة تاريخية" });

    await transitionOrderStatus({ storeId: store.id, orderId: created.orderId, nextStatus: "confirmed", actorUserId: owner.id });
    const finalDetail = await getCustomerDetail(store.id, customerId);
    expect(finalDetail?.activities.map(activity => activity.type)).toEqual(expect.arrayContaining(["profile_updated", "order_status_changed"]));
  });

  it("يمنع قراءة العميل أو وسمه أو تكليف مهمة له عبر متجر آخر", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار CRM.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    const primaryStore = await getPublicStore();
    if (!owner || !primaryStore) throw new Error("لا توجد بيانات تشغيلية لاختبار CRM.");
    const otherStoreResult = await db.insert(stores).values({ name: "متجر عزل CRM", slug: `crm-isolation-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const otherStoreId = Number(otherStoreResult[0].insertId);
    const customerResult = await db.insert(customerProfiles).values({ storeId: primaryStore.id, displayName: "عميلة عزل", phoneNormalized: phone(), phoneDisplay: phone(), relationshipStage: "new", firstChannel: "manual", lastChannel: "manual" });
    const customerId = Number(customerResult[0].insertId);
    const tagResult = await db.insert(customerTags).values({ storeId: otherStoreId, name: "وسم متجر آخر", createdByUserId: owner.id });
    const tagId = Number(tagResult[0].insertId);
    const userResult = await db.insert(users).values({ openId: `crm-test-${randomUUID()}`, name: "موظف متجر آخر", role: "user" });
    const userId = Number(userResult[0].insertId);
    const employeeResult = await db.insert(employeeProfiles).values({ userId, storeId: otherStoreId, displayName: "موظف متجر آخر", isActive: true });
    const employeeId = Number(employeeResult[0].insertId);
    cleanups.push({ customerIds: [customerId], tagIds: [tagId], taskIds: [], orderIds: [], productIds: [], variantIds: [], employeeIds: [employeeId], userIds: [userId], storeIds: [otherStoreId] });

    await expect(getCustomerDetail(otherStoreId, customerId)).rejects.toThrow("المتجر التشغيلي الحالي");
    await expect(assignCustomerTag({ storeId: primaryStore.id, customerId, tagId, actorUserId: owner.id })).rejects.toThrow("المتجر التشغيلي الحالي");
    await expect(createCustomerTask({ storeId: primaryStore.id, customerId, title: "متابعة غير مسموحة", assigneeEmployeeId: employeeId, actorUserId: owner.id })).rejects.toThrow("غير تابع للمتجر الحالي");
    expect(await listCustomers(otherStoreId, { search: "عميلة عزل" })).toEqual([]);
  });
});
