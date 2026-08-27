import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { customerActivities, customerProfiles, employeeProfiles, inboxConversationEvents, inboxConversations, inboxMessages, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getPublicStore } from "../stores/db";
import { assignInboxConversation, changeInboxConversationStatus, createManualConversation, getInboxConversationDetail, linkInboxConversationCustomer, listInboxConversations, recordInboxMessage, setInboxConversationPriority, snoozeInboxConversation } from "./db";

type Cleanup = { conversationIds: number[]; customerIds: number[]; employeeIds: number[]; userIds: number[]; storeIds: number[] };
const cleanups: Cleanup[] = [];
function phone() { return `078${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`; }

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    for (const conversationId of cleanup.conversationIds) {
      await db.delete(inboxConversationEvents).where(eq(inboxConversationEvents.conversationId, conversationId));
      await db.delete(inboxMessages).where(eq(inboxMessages.conversationId, conversationId));
      await db.delete(inboxConversations).where(eq(inboxConversations.id, conversationId));
    }
    for (const customerId of cleanup.customerIds) {
      await db.delete(customerActivities).where(eq(customerActivities.customerId, customerId));
      await db.delete(customerProfiles).where(eq(customerProfiles.id, customerId));
    }
    for (const employeeId of cleanup.employeeIds) await db.delete(employeeProfiles).where(eq(employeeProfiles.id, employeeId));
    for (const userId of cleanup.userIds) await db.delete(users).where(eq(users.id, userId));
    for (const storeId of cleanup.storeIds) await db.delete(stores).where(eq(stores.id, storeId));
  }
});

describe("Inbox-A متعدد المتاجر", () => {
  it("يحفظ رسائل السجل والملاحظات الداخلية منفصلة ويربط سياق العميل دون إعادة كتابة اللقطة", async () => {
    const db = await getDb();
    const store = await getPublicStore();
    const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
    if (!db || !store || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار Inbox.");
    const customerResult = await db.insert(customerProfiles).values({ storeId: store.id, displayName: "عميلة Inbox", phoneNormalized: phone(), phoneDisplay: phone(), relationshipStage: "active", firstChannel: "manual", lastChannel: "manual" });
    const customerId = Number(customerResult[0].insertId);
    const created = await createManualConversation({ storeId: store.id, actorUserId: owner.id, customerId, subject: "استفسار عن الطلب" });
    cleanups.push({ conversationIds: [created.conversationId], customerIds: [customerId], employeeIds: [], userIds: [], storeIds: [] });

    await expect(recordInboxMessage({ storeId: store.id, conversationId: created.conversationId, direction: "inbound", body: "هل اللون متوفر؟", actorUserId: owner.id })).resolves.toMatchObject({ delivery: "recorded_only" });
    await recordInboxMessage({ storeId: store.id, conversationId: created.conversationId, direction: "internal_note", body: "تحققي من اللون قبل الرد.", actorUserId: owner.id });
    await recordInboxMessage({ storeId: store.id, conversationId: created.conversationId, direction: "outbound", body: "سُجل الرد يدويًا فقط.", actorUserId: owner.id });
    await setInboxConversationPriority({ storeId: store.id, conversationId: created.conversationId, priority: true, actorUserId: owner.id });
    await changeInboxConversationStatus({ storeId: store.id, conversationId: created.conversationId, status: "waiting_customer", actorUserId: owner.id });
    await snoozeInboxConversation({ storeId: store.id, conversationId: created.conversationId, until: new Date(Date.now() + 60_000), actorUserId: owner.id });
    await db.update(customerProfiles).set({ displayName: "اسم CRM محدّث" }).where(eq(customerProfiles.id, customerId));

    const detail = await getInboxConversationDetail(store.id, created.conversationId);
    expect(detail.conversation).toMatchObject({ customerId, contactNameSnapshot: "عميلة Inbox", priority: true, status: "snoozed" });
    expect(detail.messages.map(message => message.direction)).toEqual(["inbound", "internal_note", "outbound"]);
    expect(detail.events.map(event => event.type)).toEqual(expect.arrayContaining(["created", "message_recorded", "internal_note_added", "priority_changed", "status_changed", "snoozed"]));
    expect(detail.customer?.displayName).toBe("اسم CRM محدّث");
    const activities = await db.select().from(customerActivities).where(eq(customerActivities.customerId, customerId));
    const inboxActivities = activities.filter(activity => activity.type === "inbox_message");
    expect(inboxActivities).toHaveLength(5);
    expect(inboxActivities.map(activity => activity.title)).toEqual(expect.arrayContaining(["فُتحت محادثة يدوية في Inbox", "رسالة واردة مسجلة في Inbox", "ملاحظة داخلية من Inbox", "رسالة صادرة مسجلة في Inbox", "تغيّرت حالة المحادثة إلى: بانتظار العميل"]));
  });

  it("يمنع الوصول والتعيين وربط العملاء عبر متجر آخر", async () => {
    const db = await getDb();
    const primaryStore = await getPublicStore();
    const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
    if (!db || !primaryStore || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار Inbox.");
    const otherStoreResult = await db.insert(stores).values({ name: "متجر عزل Inbox", slug: `inbox-isolation-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const otherStoreId = Number(otherStoreResult[0].insertId);
    const customerResult = await db.insert(customerProfiles).values({ storeId: primaryStore.id, displayName: "عميلة المتجر الأول", phoneNormalized: phone(), phoneDisplay: phone(), relationshipStage: "new", firstChannel: "manual", lastChannel: "manual" });
    const customerId = Number(customerResult[0].insertId);
    const otherCustomerResult = await db.insert(customerProfiles).values({ storeId: otherStoreId, displayName: "عميلة المتجر الثاني", phoneNormalized: phone(), phoneDisplay: phone(), relationshipStage: "new", firstChannel: "manual", lastChannel: "manual" });
    const otherCustomerId = Number(otherCustomerResult[0].insertId);
    const userResult = await db.insert(users).values({ openId: `inbox-test-${randomUUID()}`, name: "موظف متجر آخر", role: "user" });
    const userId = Number(userResult[0].insertId);
    const employeeResult = await db.insert(employeeProfiles).values({ userId, storeId: otherStoreId, displayName: "موظف متجر آخر", isActive: true });
    const employeeId = Number(employeeResult[0].insertId);
    const created = await createManualConversation({ storeId: primaryStore.id, actorUserId: owner.id, customerId, subject: "عزل المتجر" });
    cleanups.push({ conversationIds: [created.conversationId], customerIds: [customerId, otherCustomerId], employeeIds: [employeeId], userIds: [userId], storeIds: [otherStoreId] });

    await expect(getInboxConversationDetail(otherStoreId, created.conversationId)).rejects.toThrow("المتجر التشغيلي الحالي");
    await expect(assignInboxConversation({ storeId: primaryStore.id, conversationId: created.conversationId, assigneeEmployeeId: employeeId, actorUserId: owner.id })).rejects.toThrow("غير تابع للمتجر الحالي");
    await expect(linkInboxConversationCustomer({ storeId: primaryStore.id, conversationId: created.conversationId, customerId: otherCustomerId, actorUserId: owner.id })).rejects.toThrow("المتجر التشغيلي الحالي");
    expect(await listInboxConversations(otherStoreId, owner.id, { search: "عزل المتجر" })).toEqual([]);
  });
});
