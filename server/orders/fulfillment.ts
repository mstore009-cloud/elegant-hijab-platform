import { and, asc, desc, eq } from "drizzle-orm";
import { employeePermissionGrants, employeeProfiles, orderFulfillmentEvents, orderFulfillmentItemChecks, orderFulfillments, orderItems, orders, users } from "../../drizzle/schema";
import { recordAuditEvent } from "../audit/db";
import { getDb } from "../db";
import { transitionOrderStatus } from "./db";

export const fulfillmentStages = ["unstarted", "picking", "packing", "ready", "dispatched", "delivered", "blocked"] as const;
export type FulfillmentStage = (typeof fulfillmentStages)[number];

function initialStageForOrder(status: string): FulfillmentStage {
  if (status === "preparing") return "picking";
  if (status === "out_for_delivery") return "dispatched";
  if (status === "completed") return "delivered";
  return "unstarted";
}

async function requireFulfillableOrder(storeId: number, orderId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, storeId))).limit(1);
  if (!order) throw new Error("الطلب غير موجود.");
  if (!["confirmed", "preparing", "out_for_delivery", "completed"].includes(order.status)) {
    throw new Error("يبدأ التجهيز بعد تأكيد الطلب فقط.");
  }
  return { db, order };
}

async function auditFulfillment(input: { storeId: number; actorUserId: number; fulfillmentId: number; action: string; summary: string; metadata?: Record<string, unknown> }) {
  await recordAuditEvent({
    storeId: input.storeId,
    actorUserId: input.actorUserId,
    entityType: "order_fulfillment",
    entityId: input.fulfillmentId,
    action: input.action,
    summary: input.summary,
    metadata: input.metadata,
  });
}

export async function ensureOrderFulfillment(input: { storeId: number; orderId: number; actorUserId: number }) {
  const { db, order } = await requireFulfillableOrder(input.storeId, input.orderId);
  const [existing] = await db.select().from(orderFulfillments).where(eq(orderFulfillments.orderId, order.id)).limit(1);
  if (existing) return existing;

  const stage = initialStageForOrder(order.status);
  const created = await db.transaction(async tx => {
    const result = await tx.insert(orderFulfillments).values({ storeId: input.storeId, orderId: order.id, stage, createdByUserId: input.actorUserId });
    const fulfillmentId = Number(result[0].insertId);
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    if (items.length) await tx.insert(orderFulfillmentItemChecks).values(items.map(item => ({ fulfillmentId, orderItemId: item.id })));
    await tx.insert(orderFulfillmentEvents).values({ storeId: input.storeId, fulfillmentId, type: "created", toStage: stage, note: "فتح سجل التجهيز اليدوي", actorUserId: input.actorUserId });
    const [fulfillment] = await tx.select().from(orderFulfillments).where(eq(orderFulfillments.id, fulfillmentId)).limit(1);
    if (!fulfillment) throw new Error("تعذر إنشاء سجل التجهيز.");
    return fulfillment;
  });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: created.id, action: "fulfillment_created", summary: `فُتح سجل تجهيز للطلب ${order.orderNumber}.`, metadata: { orderId: order.id } });
  return created;
}

async function requireFulfillment(storeId: number, orderId: number, actorUserId: number) {
  const fulfillment = await ensureOrderFulfillment({ storeId, orderId, actorUserId });
  const { db, order } = await requireFulfillableOrder(storeId, orderId);
  return { db, order, fulfillment };
}

async function appendEvent(input: { storeId: number; fulfillmentId: number; type: "assigned" | "picking_started" | "item_picked" | "item_packed" | "ready" | "dispatched" | "delivered" | "exception_recorded" | "note_added"; actorUserId: number; orderItemId?: number | null; fromStage?: string | null; toStage?: string | null; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.insert(orderFulfillmentEvents).values({ ...input, orderItemId: input.orderItemId ?? null, fromStage: input.fromStage ?? null, toStage: input.toStage ?? null, note: input.note?.trim() || null });
}

export async function listFulfillmentQueue(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  const [orderList, fulfillmentList] = await Promise.all([
    db.select().from(orders).where(eq(orders.storeId, storeId)).orderBy(desc(orders.createdAt)),
    db.select().from(orderFulfillments).where(eq(orderFulfillments.storeId, storeId)),
  ]);
  return orderList
    .filter(order => ["confirmed", "preparing", "out_for_delivery", "completed"].includes(order.status))
    .map(order => ({ order, fulfillment: fulfillmentList.find(item => item.orderId === order.id) ?? null }));
}

export async function getFulfillmentDetail(input: { storeId: number; orderId: number }) {
  const { db, order } = await requireFulfillableOrder(input.storeId, input.orderId);
  const [fulfillment] = await db.select().from(orderFulfillments).where(eq(orderFulfillments.orderId, order.id)).limit(1);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.id));
  if (!fulfillment) return { order, fulfillment: null, items: items.map(item => ({ ...item, check: null })), events: [] };
  const [checks, events] = await Promise.all([
    db.select().from(orderFulfillmentItemChecks).where(eq(orderFulfillmentItemChecks.fulfillmentId, fulfillment.id)),
    db.select().from(orderFulfillmentEvents).where(eq(orderFulfillmentEvents.fulfillmentId, fulfillment.id)).orderBy(desc(orderFulfillmentEvents.createdAt), desc(orderFulfillmentEvents.id)),
  ]);
  return { order, fulfillment, items: items.map(item => ({ ...item, check: checks.find(check => check.orderItemId === item.id) ?? null })), events };
}

export async function listFulfillmentAssignees(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  const staff = await db.select({ employeeId: employeeProfiles.id, userId: users.id, displayName: employeeProfiles.displayName, jobTitle: employeeProfiles.jobTitle, isActive: employeeProfiles.isActive, role: users.role }).from(employeeProfiles).innerJoin(users, eq(employeeProfiles.userId, users.id)).where(eq(employeeProfiles.storeId, storeId));
  const grants = await db.select().from(employeePermissionGrants);
  return staff.filter(member => member.isActive && (member.role === "admin" || grants.some(grant => grant.employeeId === member.employeeId && grant.permissionCode === "orders.fulfill")));
}

export async function assignFulfillment(input: { storeId: number; orderId: number; employeeId: number; actorUserId: number }) {
  const { db, order, fulfillment } = await requireFulfillment(input.storeId, input.orderId, input.actorUserId);
  if (["delivered"].includes(fulfillment.stage)) throw new Error("لا يمكن تغيير مسؤول طلب تم تسليمه.");
  const eligible = await listFulfillmentAssignees(input.storeId);
  const employee = eligible.find(member => member.employeeId === input.employeeId);
  if (!employee) throw new Error("الموظف غير نشط أو لا يملك صلاحية تجهيز الطلبات في هذا المتجر.");
  await db.update(orderFulfillments).set({ assignedEmployeeId: employee.employeeId }).where(eq(orderFulfillments.id, fulfillment.id));
  await appendEvent({ storeId: input.storeId, fulfillmentId: fulfillment.id, type: "assigned", actorUserId: input.actorUserId, note: `تعيين ${employee.displayName}` });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: fulfillment.id, action: "fulfillment_assigned", summary: `عُيّن ${employee.displayName} لتجهيز الطلب ${order.orderNumber}.`, metadata: { orderId: order.id, employeeId: employee.employeeId } });
  return getFulfillmentDetail({ storeId: input.storeId, orderId: input.orderId });
}

export async function startPicking(input: { storeId: number; orderId: number; actorUserId: number }) {
  const { db, order, fulfillment } = await requireFulfillment(input.storeId, input.orderId, input.actorUserId);
  if (!["unstarted", "blocked"].includes(fulfillment.stage)) throw new Error("هذا الطلب في مرحلة تجهيز متقدمة بالفعل.");
  if (order.status === "confirmed") await transitionOrderStatus({ storeId: input.storeId, orderId: order.id, nextStatus: "preparing", actorUserId: input.actorUserId, note: "بدء الالتقاط اليدوي" });
  else if (order.status !== "preparing") throw new Error("لا يمكن بدء الالتقاط في حالة الطلب الحالية.");
  await db.update(orderFulfillments).set({ stage: "picking", exceptionNote: null, startedAt: fulfillment.startedAt ?? new Date() }).where(eq(orderFulfillments.id, fulfillment.id));
  await appendEvent({ storeId: input.storeId, fulfillmentId: fulfillment.id, type: "picking_started", actorUserId: input.actorUserId, fromStage: fulfillment.stage, toStage: "picking" });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: fulfillment.id, action: "fulfillment_picking_started", summary: `بدأ الالتقاط اليدوي للطلب ${order.orderNumber}.`, metadata: { orderId: order.id } });
  return getFulfillmentDetail({ storeId: input.storeId, orderId: input.orderId });
}

export async function setFulfillmentItemCheck(input: { storeId: number; orderId: number; orderItemId: number; field: "picked" | "packed"; checked: boolean; actorUserId: number }) {
  const { db, order, fulfillment } = await requireFulfillment(input.storeId, input.orderId, input.actorUserId);
  if (!["picking", "packing"].includes(fulfillment.stage)) throw new Error("تأشير العناصر متاح أثناء الالتقاط أو التغليف فقط.");
  const [item] = await db.select().from(orderItems).where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orderId, order.id))).limit(1);
  if (!item) throw new Error("عنصر الطلب لا ينتمي إلى هذا الطلب.");
  const [check] = await db.select().from(orderFulfillmentItemChecks).where(and(eq(orderFulfillmentItemChecks.fulfillmentId, fulfillment.id), eq(orderFulfillmentItemChecks.orderItemId, item.id))).limit(1);
  if (!check) throw new Error("تعذر قراءة تأكيد هذا العنصر.");
  if (input.field === "packed" && input.checked && !check.pickedAt) throw new Error("يجب تأكيد التقاط العنصر قبل تغليفه.");
  const now = new Date();
  const values = input.field === "picked" ? { pickedAt: input.checked ? now : null, pickedByUserId: input.checked ? input.actorUserId : null } : { packedAt: input.checked ? now : null, packedByUserId: input.checked ? input.actorUserId : null };
  await db.update(orderFulfillmentItemChecks).set(values).where(eq(orderFulfillmentItemChecks.id, check.id));
  const allChecks = await db.select().from(orderFulfillmentItemChecks).where(eq(orderFulfillmentItemChecks.fulfillmentId, fulfillment.id));
  const updatedChecks = allChecks.map(candidate => candidate.id === check.id ? { ...candidate, ...values } : candidate);
  const allPicked = updatedChecks.every(candidate => Boolean(candidate.pickedAt));
  const nextStage: FulfillmentStage = allPicked && fulfillment.stage === "picking" ? "packing" : fulfillment.stage;
  if (nextStage !== fulfillment.stage) await db.update(orderFulfillments).set({ stage: nextStage }).where(eq(orderFulfillments.id, fulfillment.id));
  await appendEvent({ storeId: input.storeId, fulfillmentId: fulfillment.id, type: input.field === "picked" ? "item_picked" : "item_packed", actorUserId: input.actorUserId, orderItemId: item.id, fromStage: fulfillment.stage, toStage: nextStage, note: `${input.checked ? "تأكيد" : "إلغاء تأكيد"} ${input.field === "picked" ? "التقاط" : "تغليف"} ${item.colorNameSnapshot}` });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: fulfillment.id, action: input.field === "picked" ? "fulfillment_item_picked" : "fulfillment_item_packed", summary: `${input.checked ? "أُكّد" : "أُلغي تأكيد"} ${input.field === "picked" ? "التقاط" : "تغليف"} عنصر ${item.colorNameSnapshot} للطلب ${order.orderNumber}.`, metadata: { orderId: order.id, orderItemId: item.id, checked: input.checked } });
  return getFulfillmentDetail({ storeId: input.storeId, orderId: input.orderId });
}

export async function markFulfillmentReady(input: { storeId: number; orderId: number; actorUserId: number; note?: string | null }) {
  const { db, order, fulfillment } = await requireFulfillment(input.storeId, input.orderId, input.actorUserId);
  if (fulfillment.stage !== "packing") throw new Error("يجب إكمال الالتقاط قبل اعتماد التغليف.");
  const checks = await db.select().from(orderFulfillmentItemChecks).where(eq(orderFulfillmentItemChecks.fulfillmentId, fulfillment.id));
  if (!checks.length || checks.some(check => !check.pickedAt || !check.packedAt)) throw new Error("يجب تأكيد التقاط وتغليف جميع عناصر الطلب أولاً.");
  await db.update(orderFulfillments).set({ stage: "ready", packedAt: new Date(), readyAt: new Date() }).where(eq(orderFulfillments.id, fulfillment.id));
  await appendEvent({ storeId: input.storeId, fulfillmentId: fulfillment.id, type: "ready", actorUserId: input.actorUserId, fromStage: "packing", toStage: "ready", note: input.note });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: fulfillment.id, action: "fulfillment_ready", summary: `أصبح الطلب ${order.orderNumber} جاهزاً للخروج اليدوي.`, metadata: { orderId: order.id } });
  return getFulfillmentDetail({ storeId: input.storeId, orderId: input.orderId });
}

export async function dispatchFulfillment(input: { storeId: number; orderId: number; actorUserId: number; note?: string | null }) {
  const { db, order, fulfillment } = await requireFulfillment(input.storeId, input.orderId, input.actorUserId);
  if (fulfillment.stage !== "ready") throw new Error("يجب أن يكون الطلب جاهزاً قبل تسجيل خروجه للتوصيل.");
  if (order.status === "preparing") await transitionOrderStatus({ storeId: input.storeId, orderId: order.id, nextStatus: "out_for_delivery", actorUserId: input.actorUserId, note: input.note || "تسليم يدوي للتوصيل" });
  else if (order.status !== "out_for_delivery") throw new Error("لا يمكن تسجيل خروج الطلب في حالته الحالية.");
  await db.update(orderFulfillments).set({ stage: "dispatched", dispatchedAt: new Date() }).where(eq(orderFulfillments.id, fulfillment.id));
  await appendEvent({ storeId: input.storeId, fulfillmentId: fulfillment.id, type: "dispatched", actorUserId: input.actorUserId, fromStage: "ready", toStage: "dispatched", note: input.note });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: fulfillment.id, action: "fulfillment_dispatched", summary: `سُجل خروج الطلب ${order.orderNumber} للتوصيل اليدوي.`, metadata: { orderId: order.id } });
  return getFulfillmentDetail({ storeId: input.storeId, orderId: input.orderId });
}

export async function deliverFulfillment(input: { storeId: number; orderId: number; actorUserId: number; note?: string | null }) {
  const { db, order, fulfillment } = await requireFulfillment(input.storeId, input.orderId, input.actorUserId);
  if (fulfillment.stage !== "dispatched") throw new Error("يجب تسجيل خروج الطلب أولاً.");
  if (order.status === "out_for_delivery") await transitionOrderStatus({ storeId: input.storeId, orderId: order.id, nextStatus: "completed", actorUserId: input.actorUserId, note: input.note || "تأكيد تسليم يدوي" });
  else if (order.status !== "completed") throw new Error("لا يمكن تأكيد التسليم في حالة الطلب الحالية.");
  await db.update(orderFulfillments).set({ stage: "delivered", deliveredAt: new Date() }).where(eq(orderFulfillments.id, fulfillment.id));
  await appendEvent({ storeId: input.storeId, fulfillmentId: fulfillment.id, type: "delivered", actorUserId: input.actorUserId, fromStage: "dispatched", toStage: "delivered", note: input.note });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: fulfillment.id, action: "fulfillment_delivered", summary: `سُجل تسليم الطلب ${order.orderNumber} يدوياً.`, metadata: { orderId: order.id } });
  return getFulfillmentDetail({ storeId: input.storeId, orderId: input.orderId });
}

export async function recordFulfillmentException(input: { storeId: number; orderId: number; actorUserId: number; note: string }) {
  const { db, order, fulfillment } = await requireFulfillment(input.storeId, input.orderId, input.actorUserId);
  if (fulfillment.stage === "delivered") throw new Error("لا يمكن تسجيل تعذر بعد التسليم.");
  const note = input.note.trim();
  if (!note) throw new Error("سبب التعذر مطلوب.");
  await db.update(orderFulfillments).set({ stage: "blocked", exceptionNote: note }).where(eq(orderFulfillments.id, fulfillment.id));
  await appendEvent({ storeId: input.storeId, fulfillmentId: fulfillment.id, type: "exception_recorded", actorUserId: input.actorUserId, fromStage: fulfillment.stage, toStage: "blocked", note });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: fulfillment.id, action: "fulfillment_exception", summary: `سُجل تعذر في تجهيز الطلب ${order.orderNumber}.`, metadata: { orderId: order.id } });
  return getFulfillmentDetail({ storeId: input.storeId, orderId: input.orderId });
}

export async function addFulfillmentNote(input: { storeId: number; orderId: number; actorUserId: number; note: string }) {
  const { order, fulfillment } = await requireFulfillment(input.storeId, input.orderId, input.actorUserId);
  const note = input.note.trim();
  if (!note) throw new Error("الملاحظة مطلوبة.");
  await appendEvent({ storeId: input.storeId, fulfillmentId: fulfillment.id, type: "note_added", actorUserId: input.actorUserId, fromStage: fulfillment.stage, toStage: fulfillment.stage, note });
  await auditFulfillment({ storeId: input.storeId, actorUserId: input.actorUserId, fulfillmentId: fulfillment.id, action: "fulfillment_note_added", summary: `أُضيفت ملاحظة تجهيز للطلب ${order.orderNumber}.`, metadata: { orderId: order.id } });
  return getFulfillmentDetail({ storeId: input.storeId, orderId: input.orderId });
}
