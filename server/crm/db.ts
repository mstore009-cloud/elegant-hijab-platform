import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  customerActivities,
  customerProfiles,
  customerTagAssignments,
  customerTags,
  customerTasks,
  employeeProfiles,
  inboxConversations,
  metaLeadCaptures,
  orders,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { notifyEmployee } from "../notifications/db";

export const customerRelationshipStages = ["new", "active", "repeat", "needs_followup", "inactive"] as const;
export const customerTaskStatuses = ["open", "completed", "cancelled"] as const;
export type CustomerRelationshipStage = (typeof customerRelationshipStages)[number];
export type CustomerTaskStatus = (typeof customerTaskStatuses)[number];
export type CustomerChannel = "storefront" | "whatsapp" | "instagram" | "messenger" | "manual";

const arabicIndicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeCustomerPhone(value: string) {
  return value
    .trim()
    .split("")
    .map(character => {
      const arabicIndex = arabicIndicDigits.indexOf(character);
      if (arabicIndex >= 0) return String(arabicIndex);
      const persianIndex = persianDigits.indexOf(character);
      if (persianIndex >= 0) return String(persianIndex);
      return character;
    })
    .join("")
    .replace(/[^0-9]/g, "");
}

function requirePhone(value: string) {
  const normalized = normalizeCustomerPhone(value);
  if (normalized.length < 7 || normalized.length > 40) throw new Error("رقم هاتف العميل غير صالح.");
  return normalized;
}

async function getScopedCustomer(db: any, storeId: number, customerId: number) {
  const [customer] = await db.select().from(customerProfiles).where(and(eq(customerProfiles.id, customerId), eq(customerProfiles.storeId, storeId))).limit(1);
  if (!customer) throw new Error("ملف العميل غير موجود في المتجر التشغيلي الحالي.");
  return customer;
}

export async function appendCustomerActivity(db: any, input: {
  storeId: number;
  customerId: number;
  type: "profile_created" | "profile_updated" | "order_created" | "order_status_changed" | "note" | "tag_added" | "tag_removed" | "task_created" | "task_completed" | "inbox_message";
  title: string;
  body?: string | null;
  actorUserId?: number | null;
  orderId?: number | null;
  taskId?: number | null;
}) {
  await db.insert(customerActivities).values({
    storeId: input.storeId,
    customerId: input.customerId,
    type: input.type,
    title: input.title,
    body: input.body?.trim() || null,
    actorUserId: input.actorUserId ?? null,
    orderId: input.orderId ?? null,
    taskId: input.taskId ?? null,
  });
}

export async function resolveCustomerForOrder(db: any, input: {
  storeId: number;
  customerName: string;
  customerPhone: string;
  governorate: string;
  address: string;
  channel: CustomerChannel;
  orderAt: Date;
}) {
  const phoneDisplay = input.customerPhone.trim();
  const phoneNormalized = requirePhone(phoneDisplay);
  const displayName = input.customerName.trim() || "عميل";
  const [existing] = await db.select().from(customerProfiles).where(and(eq(customerProfiles.storeId, input.storeId), eq(customerProfiles.phoneNormalized, phoneNormalized))).limit(1);

  if (existing) {
    const stage: CustomerRelationshipStage = existing.firstOrderAt ? "repeat" : "active";
    await db.update(customerProfiles).set({
      displayName,
      phoneDisplay,
      governorate: input.governorate.trim() || null,
      lastAddress: input.address.trim() || null,
      relationshipStage: stage,
      lastChannel: input.channel,
      lastOrderAt: input.orderAt,
    }).where(eq(customerProfiles.id, existing.id));
    return { customerId: existing.id, created: false };
  }

  const result = await db.insert(customerProfiles).values({
    storeId: input.storeId,
    displayName,
    phoneNormalized,
    phoneDisplay,
    governorate: input.governorate.trim() || null,
    lastAddress: input.address.trim() || null,
    relationshipStage: "active",
    firstChannel: input.channel,
    lastChannel: input.channel,
    firstOrderAt: input.orderAt,
    lastOrderAt: input.orderAt,
  });
  return { customerId: Number(result[0].insertId), created: true };
}

export async function ingestMetaLeadCapture(db: any, input: {
  storeId: number;
  metaAssetId?: number | null;
  externalLeadId: string;
  formId?: string | null;
  adId?: string | null;
  name?: string | null;
  phone?: string | null;
  consentStatus?: "unknown" | "granted" | "denied";
  receivedAt?: Date;
}) {
  const existing = await db.select().from(metaLeadCaptures).where(and(eq(metaLeadCaptures.storeId, input.storeId), eq(metaLeadCaptures.externalLeadId, input.externalLeadId))).limit(1);
  if (existing[0]) return { captureId: existing[0].id, customerId: existing[0].customerId, duplicate: true, status: existing[0].status };
  const phoneNormalized = input.phone ? normalizeCustomerPhone(input.phone) : "";
  const validPhone = phoneNormalized.length >= 7 && phoneNormalized.length <= 40;
  const consentStatus = input.consentStatus ?? "unknown";
  if (consentStatus === "denied") {
    const inserted = await db.insert(metaLeadCaptures).values({ storeId: input.storeId, metaAssetId: input.metaAssetId ?? null, externalLeadId: input.externalLeadId, formId: input.formId?.slice(0, 255) || null, adId: input.adId?.slice(0, 255) || null, fieldDataJson: null, consentStatus, status: "ignored", customerId: null, receivedAt: input.receivedAt ?? new Date() });
    return { captureId: Number(inserted[0].insertId), customerId: null, duplicate: false, status: "ignored" as const };
  }
  if (!validPhone) {
    const inserted = await db.insert(metaLeadCaptures).values({ storeId: input.storeId, metaAssetId: input.metaAssetId ?? null, externalLeadId: input.externalLeadId, formId: input.formId?.slice(0, 255) || null, adId: input.adId?.slice(0, 255) || null, fieldDataJson: JSON.stringify({ name: input.name?.slice(0, 160) || null }).slice(0, 4_000), consentStatus, status: "pending", customerId: null, receivedAt: input.receivedAt ?? new Date() });
    return { captureId: Number(inserted[0].insertId), customerId: null, duplicate: false, status: "pending" as const };
  }
  const displayName = input.name?.trim().slice(0, 160) || "عميل من Lead Ads";
  const [existingCustomer] = await db.select().from(customerProfiles).where(and(eq(customerProfiles.storeId, input.storeId), eq(customerProfiles.phoneNormalized, phoneNormalized))).limit(1);
  let customerId: number;
  if (existingCustomer) {
    customerId = existingCustomer.id;
    await db.update(customerProfiles).set({ displayName, phoneDisplay: input.phone!.trim().slice(0, 40), lastChannel: "manual", updatedAt: new Date() }).where(and(eq(customerProfiles.id, customerId), eq(customerProfiles.storeId, input.storeId)));
    await appendCustomerActivity(db, { storeId: input.storeId, customerId, type: "profile_updated", title: "تحديث ملف العميل من Lead Ads", body: `النموذج: ${input.formId || "غير محدد"}` });
  } else {
    const created = await db.insert(customerProfiles).values({ storeId: input.storeId, displayName, phoneNormalized, phoneDisplay: input.phone!.trim().slice(0, 40), relationshipStage: "new", firstChannel: "manual", lastChannel: "manual" });
    customerId = Number(created[0].insertId);
    await appendCustomerActivity(db, { storeId: input.storeId, customerId, type: "profile_created", title: "أُنشئ ملف العميل من Lead Ads", body: `النموذج: ${input.formId || "غير محدد"}` });
  }
  const inserted = await db.insert(metaLeadCaptures).values({ storeId: input.storeId, metaAssetId: input.metaAssetId ?? null, externalLeadId: input.externalLeadId, formId: input.formId?.slice(0, 255) || null, adId: input.adId?.slice(0, 255) || null, fieldDataJson: JSON.stringify({ name: displayName }).slice(0, 4_000), consentStatus, status: "imported", customerId, receivedAt: input.receivedAt ?? new Date(), importedAt: new Date() });
  return { captureId: Number(inserted[0].insertId), customerId, duplicate: false, status: "imported" as const };
}

export async function recordOrderCustomerActivity(db: any, input: { storeId: number; customerId: number | null; orderId: number; orderNumber: string; created: boolean }) {
  if (!input.customerId) return;
  if (input.created) {
    await appendCustomerActivity(db, { storeId: input.storeId, customerId: input.customerId, type: "profile_created", title: "أُنشئ ملف العميل من طلب جديد", orderId: input.orderId });
  }
  await appendCustomerActivity(db, { storeId: input.storeId, customerId: input.customerId, type: "order_created", title: `أُنشئ الطلب ${input.orderNumber}`, orderId: input.orderId });
}

const orderStatusLabels: Record<string, string> = {
  new: "طلب جديد", needs_contact: "بحاجة إلى تواصل", confirmed: "تم تأكيد الطلب", preparing: "جارٍ تجهيز الطلب", out_for_delivery: "خرج للتوصيل", completed: "اكتمل الطلب", cancelled: "أُلغي الطلب",
};

export async function recordOrderStatusCustomerActivity(db: any, input: { storeId: number; customerId: number | null; orderId: number; nextStatus: string; actorUserId: number; note?: string | null }) {
  if (!input.customerId) return;
  await appendCustomerActivity(db, {
    storeId: input.storeId,
    customerId: input.customerId,
    type: "order_status_changed",
    title: `تغيّرت حالة الطلب إلى: ${orderStatusLabels[input.nextStatus] ?? input.nextStatus}`,
    body: input.note,
    actorUserId: input.actorUserId,
    orderId: input.orderId,
  });
}

export async function listCustomers(storeId: number, input: { search?: string; stage?: CustomerRelationshipStage; tagId?: number; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const filters = [eq(customerProfiles.storeId, storeId)];
  if (input.stage) filters.push(eq(customerProfiles.relationshipStage, input.stage));
  const search = input.search?.trim();
  if (search) filters.push(or(like(customerProfiles.displayName, `%${search}%`), like(customerProfiles.phoneDisplay, `%${search}%`))!);
  if (input.tagId) {
    const taggedRows = await db.select({ customerId: customerTagAssignments.customerId }).from(customerTagAssignments).innerJoin(customerTags, eq(customerTags.id, customerTagAssignments.tagId)).where(and(eq(customerTagAssignments.tagId, input.tagId), eq(customerTags.storeId, storeId)));
    if (!taggedRows.length) return [];
    filters.push(inArray(customerProfiles.id, taggedRows.map(row => row.customerId)));
  }
  const customers = await db.select().from(customerProfiles).where(and(...filters)).orderBy(desc(customerProfiles.lastOrderAt), desc(customerProfiles.createdAt)).limit(Math.min(Math.max(input.limit ?? 100, 1), 200));
  if (!customers.length) return [];
  const customerIds = customers.map(customer => customer.id);
  const [tags, stats, openTasks] = await Promise.all([
    db.select({ customerId: customerTagAssignments.customerId, id: customerTags.id, name: customerTags.name, color: customerTags.color }).from(customerTagAssignments).innerJoin(customerTags, eq(customerTags.id, customerTagAssignments.tagId)).where(and(inArray(customerTagAssignments.customerId, customerIds), eq(customerTags.storeId, storeId))),
    db.select({ customerId: orders.customerId, orderCount: sql<number>`count(*)`, totalSpent: sql<string>`coalesce(sum(${orders.total}), 0)` }).from(orders).where(and(eq(orders.storeId, storeId), inArray(orders.customerId, customerIds))).groupBy(orders.customerId),
    db.select({ customerId: customerTasks.customerId, taskCount: sql<number>`count(*)` }).from(customerTasks).where(and(eq(customerTasks.storeId, storeId), eq(customerTasks.status, "open"), inArray(customerTasks.customerId, customerIds))).groupBy(customerTasks.customerId),
  ]);
  return customers.map(customer => ({
    ...customer,
    tags: tags.filter(tag => tag.customerId === customer.id).map(({ customerId: _customerId, ...tag }) => tag),
    orderCount: Number(stats.find(stat => stat.customerId === customer.id)?.orderCount ?? 0),
    totalSpent: stats.find(stat => stat.customerId === customer.id)?.totalSpent ?? "0.00",
    openTaskCount: Number(openTasks.find(task => task.customerId === customer.id)?.taskCount ?? 0),
  }));
}

export async function getCustomerDetail(storeId: number, customerId: number) {
  const db = await getDb();
  if (!db) return null;
  const customer = await getScopedCustomer(db, storeId, customerId);
  const [ordersList, activities, tasks, tags, conversations] = await Promise.all([
    db.select().from(orders).where(and(eq(orders.storeId, storeId), eq(orders.customerId, customerId))).orderBy(desc(orders.createdAt)),
    db.select().from(customerActivities).where(and(eq(customerActivities.storeId, storeId), eq(customerActivities.customerId, customerId))).orderBy(desc(customerActivities.occurredAt), desc(customerActivities.id)),
    db.select().from(customerTasks).where(and(eq(customerTasks.storeId, storeId), eq(customerTasks.customerId, customerId))).orderBy(desc(customerTasks.createdAt)),
    db.select({ id: customerTags.id, name: customerTags.name, color: customerTags.color }).from(customerTagAssignments).innerJoin(customerTags, eq(customerTags.id, customerTagAssignments.tagId)).where(and(eq(customerTagAssignments.customerId, customerId), eq(customerTags.storeId, storeId))),
    db.select({ id: inboxConversations.id, channel: inboxConversations.channel, subject: inboxConversations.subject, status: inboxConversations.status, priority: inboxConversations.priority, lastMessageAt: inboxConversations.lastMessageAt, createdAt: inboxConversations.createdAt }).from(inboxConversations).where(and(eq(inboxConversations.storeId, storeId), eq(inboxConversations.customerId, customerId))).orderBy(desc(inboxConversations.lastMessageAt), desc(inboxConversations.createdAt)).limit(25),
  ]);
  return { customer, orders: ordersList, activities, tasks, tags, conversations };
}

export async function listCustomerTags(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerTags).where(eq(customerTags.storeId, storeId)).orderBy(customerTags.name);
}

export async function createCustomerTag(input: { storeId: number; name: string; color: string; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const name = input.name.trim();
  if (!name) throw new Error("اسم الوسم مطلوب.");
  const result = await db.insert(customerTags).values({ storeId: input.storeId, name, color: input.color.trim() || "slate", createdByUserId: input.actorUserId });
  return { id: Number(result[0].insertId), name };
}

export async function assignCustomerTag(input: { storeId: number; customerId: number; tagId: number; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await getScopedCustomer(db, input.storeId, input.customerId);
  const [tag] = await db.select().from(customerTags).where(and(eq(customerTags.id, input.tagId), eq(customerTags.storeId, input.storeId))).limit(1);
  if (!tag) throw new Error("الوسم غير موجود في المتجر التشغيلي الحالي.");
  await db.insert(customerTagAssignments).values({ customerId: input.customerId, tagId: input.tagId, assignedByUserId: input.actorUserId }).onDuplicateKeyUpdate({ set: { assignedByUserId: input.actorUserId } });
  await appendCustomerActivity(db, { storeId: input.storeId, customerId: input.customerId, type: "tag_added", title: `أُضيف الوسم: ${tag.name}`, actorUserId: input.actorUserId });
  return tag;
}

export async function removeCustomerTag(input: { storeId: number; customerId: number; tagId: number; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await getScopedCustomer(db, input.storeId, input.customerId);
  const [tag] = await db.select().from(customerTags).where(and(eq(customerTags.id, input.tagId), eq(customerTags.storeId, input.storeId))).limit(1);
  if (!tag) throw new Error("الوسم غير موجود في المتجر التشغيلي الحالي.");
  await db.delete(customerTagAssignments).where(and(eq(customerTagAssignments.customerId, input.customerId), eq(customerTagAssignments.tagId, input.tagId)));
  await appendCustomerActivity(db, { storeId: input.storeId, customerId: input.customerId, type: "tag_removed", title: `أُزيل الوسم: ${tag.name}`, actorUserId: input.actorUserId });
}

export async function updateCustomerProfile(input: { storeId: number; customerId: number; displayName: string; phoneDisplay: string; governorate?: string | null; lastAddress?: string | null; relationshipStage: CustomerRelationshipStage; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const customer = await getScopedCustomer(db, input.storeId, input.customerId);
  const phoneNormalized = requirePhone(input.phoneDisplay);
  const [duplicate] = await db.select({ id: customerProfiles.id }).from(customerProfiles).where(and(eq(customerProfiles.storeId, input.storeId), eq(customerProfiles.phoneNormalized, phoneNormalized))).limit(1);
  if (duplicate && duplicate.id !== customer.id) throw new Error("يوجد ملف عميل آخر بهذا الرقم داخل المتجر. لا يُدمج العملاء تلقائيًا.");
  await db.update(customerProfiles).set({ displayName: input.displayName.trim(), phoneDisplay: input.phoneDisplay.trim(), phoneNormalized, governorate: input.governorate?.trim() || null, lastAddress: input.lastAddress?.trim() || null, relationshipStage: input.relationshipStage }).where(eq(customerProfiles.id, customer.id));
  await appendCustomerActivity(db, { storeId: input.storeId, customerId: customer.id, type: "profile_updated", title: "تم تحديث ملف العميل", actorUserId: input.actorUserId });
}

export async function addCustomerNote(input: { storeId: number; customerId: number; body: string; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await getScopedCustomer(db, input.storeId, input.customerId);
  await appendCustomerActivity(db, { storeId: input.storeId, customerId: input.customerId, type: "note", title: "ملاحظة داخلية", body: input.body, actorUserId: input.actorUserId });
}

export async function listAssignableCustomerTaskEmployees(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: employeeProfiles.id, displayName: employeeProfiles.displayName, jobTitle: employeeProfiles.jobTitle }).from(employeeProfiles).where(and(eq(employeeProfiles.storeId, storeId), eq(employeeProfiles.isActive, true))).orderBy(employeeProfiles.displayName);
}

export async function createCustomerTask(input: { storeId: number; customerId: number; title: string; note?: string | null; dueAt?: Date | null; assigneeEmployeeId?: number | null; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await getScopedCustomer(db, input.storeId, input.customerId);
  if (input.assigneeEmployeeId) {
    const [assignee] = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(and(eq(employeeProfiles.id, input.assigneeEmployeeId), eq(employeeProfiles.storeId, input.storeId), eq(employeeProfiles.isActive, true))).limit(1);
    if (!assignee) throw new Error("الموظف المكلف غير تابع للمتجر الحالي أو غير نشط.");
  }
  const result = await db.insert(customerTasks).values({ storeId: input.storeId, customerId: input.customerId, title: input.title.trim(), note: input.note?.trim() || null, dueAt: input.dueAt ?? null, assigneeEmployeeId: input.assigneeEmployeeId ?? null, createdByUserId: input.actorUserId });
  const taskId = Number(result[0].insertId);
  await appendCustomerActivity(db, { storeId: input.storeId, customerId: input.customerId, type: "task_created", title: `مهمة متابعة: ${input.title.trim()}`, body: input.note, actorUserId: input.actorUserId, taskId });
  if (input.assigneeEmployeeId) {
    try {
      await notifyEmployee({ storeId: input.storeId, employeeId: input.assigneeEmployeeId, type: "crm_task_assigned", priority: "action", title: `أُسندت إليك مهمة عميل: ${input.title.trim()}`, body: input.note?.trim() || "راجعي ملف العميل لإكمال المتابعة.", entityType: "customer_task", entityId: taskId, route: `/crm?customer=${input.customerId}` });
    } catch (error) {
      console.warn("[Notifications] تعذر إنشاء تنبيه مهمة CRM:", error);
    }
  }
  return { taskId };
}

export async function changeCustomerTaskStatus(input: { storeId: number; customerId: number; taskId: number; status: CustomerTaskStatus; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [task] = await db.select().from(customerTasks).where(and(eq(customerTasks.id, input.taskId), eq(customerTasks.customerId, input.customerId), eq(customerTasks.storeId, input.storeId))).limit(1);
  if (!task) throw new Error("المهمة غير موجودة في ملف العميل الحالي.");
  await db.update(customerTasks).set({ status: input.status, completedAt: input.status === "completed" ? new Date() : null }).where(eq(customerTasks.id, task.id));
  if (input.status === "completed") await appendCustomerActivity(db, { storeId: input.storeId, customerId: input.customerId, type: "task_completed", title: `أُنجزت مهمة: ${task.title}`, actorUserId: input.actorUserId, taskId: task.id });
}
