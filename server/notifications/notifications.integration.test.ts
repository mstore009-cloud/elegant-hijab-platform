import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { customerActivities, customerProfiles, employeeProfiles, inboxConversationEvents, inboxConversations, notificationPreferences, stores, users, workNotifications } from "../../drizzle/schema";
import { getDb } from "../db";
import { createManualConversation, assignInboxConversation } from "../inbox/db";
import { archiveMyNotification, createWorkNotification, listMyWorkNotifications, markMyNotificationRead, saveMyNotificationPreferences } from "./db";

type Cleanup = { notificationIds: number[]; preferenceUserIds: number[]; conversationIds: number[]; customerIds: number[]; employeeIds: number[]; userIds: number[]; storeIds: number[] };
const cleanups: Cleanup[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    for (const notificationId of cleanup.notificationIds) await db.delete(workNotifications).where(eq(workNotifications.id, notificationId));
    for (const userId of cleanup.preferenceUserIds) await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    for (const conversationId of cleanup.conversationIds) {
      await db.delete(inboxConversationEvents).where(eq(inboxConversationEvents.conversationId, conversationId));
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

describe("Notifications-A داخل المتجر", () => {
  it("يعزل مركز المستخدم، ويطبق القراءة والأرشفة، ويحترم تفضيل إيقاف نوع التنبيه", async () => {
    const db = await getDb();
    const [store] = db ? await db.select({ id: stores.id }).from(stores).limit(1) : [];
    if (!db || !store) throw new Error("لا يوجد متجر لاختبار التنبيهات.");
    const userResult = await db.insert(users).values({ openId: `notifications-${randomUUID()}`, name: "موظفة التنبيهات", role: "user" });
    const userId = Number(userResult[0].insertId);
    const otherUserResult = await db.insert(users).values({ openId: `notifications-other-${randomUUID()}`, name: "موظفة أخرى", role: "user" });
    const otherUserId = Number(otherUserResult[0].insertId);
    cleanups.push({ notificationIds: [], preferenceUserIds: [userId], conversationIds: [], customerIds: [], employeeIds: [], userIds: [userId, otherUserId], storeIds: [] });

    const created = await createWorkNotification({ storeId: store.id, recipientUserId: userId, type: "order_created", priority: "action", title: "طلب جديد", entityType: "order", entityId: 12345, route: "/orders?order=12345" });
    if (!created.notificationId) throw new Error("لم يُنشأ تنبيه الاختبار.");
    cleanups[0].notificationIds.push(created.notificationId);

    expect(await listMyWorkNotifications({ storeId: store.id, userId, filter: "unread" })).toHaveLength(1);
    expect(await listMyWorkNotifications({ storeId: store.id, userId: otherUserId, filter: "all" })).toEqual([]);
    await markMyNotificationRead({ storeId: store.id, userId, notificationId: created.notificationId });
    expect(await listMyWorkNotifications({ storeId: store.id, userId, filter: "read" })).toHaveLength(1);
    await archiveMyNotification({ storeId: store.id, userId, notificationId: created.notificationId });
    expect(await listMyWorkNotifications({ storeId: store.id, userId, filter: "all" })).toEqual([]);
    expect(await listMyWorkNotifications({ storeId: store.id, userId, filter: "archived" })).toHaveLength(1);

    await saveMyNotificationPreferences({ storeId: store.id, userId, inboxAssignments: false, botHandoffs: true, crmTasks: true, reviewRequests: true, orderUpdates: true });
    const suppressed = await createWorkNotification({ storeId: store.id, recipientUserId: userId, type: "inbox_assigned", title: "تعيين محادثة", entityType: "inbox_conversation", entityId: 1, route: "/inbox?conversation=1" });
    expect(suppressed).toMatchObject({ created: false, skipped: "disabled" });

    const review = await createWorkNotification({ storeId: store.id, recipientUserId: userId, type: "content_review_requested", priority: "action", title: "مجلد Catalog يحتاج إلى مراجعة", entityType: "catalog_group", entityId: 99, route: "/products?catalogReview=groups", dedupeKey: `catalog-group-review-test-${userId}` });
    if (!review.notificationId) throw new Error("لم يُنشأ تنبيه مراجعة Catalog.");
    cleanups[0].notificationIds.push(review.notificationId);
    const duplicateReview = await createWorkNotification({ storeId: store.id, recipientUserId: userId, type: "content_review_requested", priority: "action", title: "مجلد Catalog يحتاج إلى مراجعة", entityType: "catalog_group", entityId: 99, route: "/products?catalogReview=groups", dedupeKey: `catalog-group-review-test-${userId}` });
    expect(duplicateReview).toMatchObject({ created: false, skipped: "duplicate", notificationId: review.notificationId });
  });

  it("ينشئ تنبيهاً خاصاً بالموظف عند إسناد محادثة من متجره فقط", async () => {
    const db = await getDb();
    const [store, owner] = db ? await Promise.all([db.select({ id: stores.id }).from(stores).limit(1), db.select({ id: users.id }).from(users).limit(1)]) : [[], []];
    if (!db || !store?.[0] || !owner?.[0]) throw new Error("لا توجد بيانات تشغيلية لاختبار تنبيه Inbox.");
    const storeId = store[0].id;
    const userResult = await db.insert(users).values({ openId: `notification-assignee-${randomUUID()}`, name: "موظفة Inbox", role: "user" });
    const userId = Number(userResult[0].insertId);
    const employeeResult = await db.insert(employeeProfiles).values({ userId, storeId, displayName: "موظفة Inbox", isActive: true });
    const employeeId = Number(employeeResult[0].insertId);
    const customerResult = await db.insert(customerProfiles).values({ storeId, displayName: "عميلة التنبيه", phoneNormalized: `078${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`, phoneDisplay: "07800000000", relationshipStage: "active", firstChannel: "manual", lastChannel: "manual" });
    const customerId = Number(customerResult[0].insertId);
    const conversation = await createManualConversation({ storeId, actorUserId: owner[0].id, customerId, subject: "تعيين للتنبيه" });
    const cleanup = { notificationIds: [] as number[], preferenceUserIds: [] as number[], conversationIds: [conversation.conversationId], customerIds: [customerId], employeeIds: [employeeId], userIds: [userId], storeIds: [] };
    cleanups.push(cleanup);

    await assignInboxConversation({ storeId, conversationId: conversation.conversationId, assigneeEmployeeId: employeeId, actorUserId: owner[0].id });
    const alerts = await listMyWorkNotifications({ storeId, userId, filter: "unread" });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "inbox_assigned", entityType: "inbox_conversation", entityId: conversation.conversationId, priority: "action" });
    cleanup.notificationIds.push(alerts[0].id);
  });
});
