import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { employeePermissionGrants, employeeProfiles, notificationPreferences, workNotifications } from "../../drizzle/schema";
import { getDb } from "../db";
import type { PermissionCode } from "../access/permissions";

export const workNotificationTypes = ["inbox_assigned", "bot_handoff", "crm_task_assigned", "content_review_requested", "marketing_approval_requested", "loyalty_reward_review_requested", "order_created"] as const;
export type WorkNotificationType = (typeof workNotificationTypes)[number];
export type NotificationPriority = "info" | "action" | "urgent";
export type NotificationListFilter = "all" | "unread" | "read" | "archived";

const preferenceForType: Record<WorkNotificationType, keyof typeof notificationPreferences.$inferSelect> = {
  inbox_assigned: "inboxAssignments",
  bot_handoff: "botHandoffs",
  crm_task_assigned: "crmTasks",
  content_review_requested: "reviewRequests",
  marketing_approval_requested: "reviewRequests",
  loyalty_reward_review_requested: "reviewRequests",
  order_created: "orderUpdates",
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

async function isEnabledForRecipient(db: any, storeId: number, userId: number, type: WorkNotificationType) {
  const [preferences] = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.storeId, storeId), eq(notificationPreferences.userId, userId))).limit(1);
  if (!preferences) return true;
  return preferences[preferenceForType[type]] !== false;
}

export async function createWorkNotification(input: {
  storeId: number;
  recipientUserId: number;
  type: WorkNotificationType;
  priority?: NotificationPriority;
  title: string;
  body?: string | null;
  entityType: string;
  entityId: number;
  route: string;
  dedupeKey?: string | null;
}) {
  const db = await requireDb();
  const enabled = await isEnabledForRecipient(db, input.storeId, input.recipientUserId, input.type);
  if (!enabled) return { notificationId: null, created: false, skipped: "disabled" as const };
  const dedupeKey = input.dedupeKey?.trim().slice(0, 160) || null;
  if (dedupeKey) {
    const [existing] = await db.select({ id: workNotifications.id }).from(workNotifications).where(and(eq(workNotifications.storeId, input.storeId), eq(workNotifications.recipientUserId, input.recipientUserId), eq(workNotifications.dedupeKey, dedupeKey))).limit(1);
    if (existing) return { notificationId: existing.id, created: false, skipped: "duplicate" as const };
  }
  const result = await db.insert(workNotifications).values({
    ...input,
    priority: input.priority ?? "info",
    title: input.title.trim().slice(0, 220),
    body: input.body?.trim().slice(0, 1000) || null,
    entityType: input.entityType.trim().slice(0, 80),
    route: input.route.trim().slice(0, 500),
    dedupeKey,
  });
  return { notificationId: Number(result[0].insertId), created: true, skipped: null };
}

export async function notifyEmployee(input: Omit<Parameters<typeof createWorkNotification>[0], "recipientUserId"> & { employeeId: number }) {
  const db = await requireDb();
  const [employee] = await db.select({ userId: employeeProfiles.userId }).from(employeeProfiles).where(and(eq(employeeProfiles.id, input.employeeId), eq(employeeProfiles.storeId, input.storeId), eq(employeeProfiles.isActive, true))).limit(1);
  if (!employee) return { notificationId: null, created: false, skipped: "inactive_or_outside_store" as const };
  const { employeeId: _employeeId, ...notification } = input;
  return createWorkNotification({ ...notification, recipientUserId: employee.userId });
}

export async function notifyPermissionHolders(input: Omit<Parameters<typeof createWorkNotification>[0], "recipientUserId"> & { permissionCode: PermissionCode }) {
  const db = await requireDb();
  const holders = await db.select({ userId: employeeProfiles.userId }).from(employeeProfiles).innerJoin(employeePermissionGrants, eq(employeePermissionGrants.employeeId, employeeProfiles.id)).where(and(eq(employeeProfiles.storeId, input.storeId), eq(employeeProfiles.isActive, true), eq(employeePermissionGrants.permissionCode, input.permissionCode)));
  const userIds = Array.from(new Set(holders.map(holder => holder.userId)));
  const { permissionCode: _permissionCode, ...notification } = input;
  const results = await Promise.all(userIds.map(recipientUserId => createWorkNotification({ ...notification, recipientUserId })));
  return { recipientCount: userIds.length, results };
}

export async function listMyWorkNotifications(input: { storeId: number; userId: number; filter?: NotificationListFilter; limit?: number }) {
  const db = await requireDb();
  const filters: any[] = [eq(workNotifications.storeId, input.storeId), eq(workNotifications.recipientUserId, input.userId)];
  if (input.filter !== "archived") filters.push(isNull(workNotifications.archivedAt));
  if (input.filter === "unread") filters.push(isNull(workNotifications.readAt));
  if (input.filter === "read") filters.push(isNull(workNotifications.archivedAt), isNotNull(workNotifications.readAt));
  const rows = await db.select().from(workNotifications).where(and(...filters)).orderBy(desc(workNotifications.createdAt), desc(workNotifications.id)).limit(Math.min(Math.max(input.limit ?? 60, 1), 200));
  return rows;
}

export async function getMyNotificationSummary(input: { storeId: number; userId: number }) {
  const db = await requireDb();
  const unread = await db.select({ id: workNotifications.id }).from(workNotifications).where(and(eq(workNotifications.storeId, input.storeId), eq(workNotifications.recipientUserId, input.userId), isNull(workNotifications.archivedAt), isNull(workNotifications.readAt)));
  return { unreadCount: unread.length };
}

export async function markMyNotificationRead(input: { storeId: number; userId: number; notificationId: number }) {
  const db = await requireDb();
  const [notification] = await db.select({ id: workNotifications.id, readAt: workNotifications.readAt }).from(workNotifications).where(and(eq(workNotifications.id, input.notificationId), eq(workNotifications.storeId, input.storeId), eq(workNotifications.recipientUserId, input.userId))).limit(1);
  if (!notification) throw new Error("التنبيه غير موجود ضمن مركز التنبيهات الخاص بك.");
  if (!notification.readAt) await db.update(workNotifications).set({ readAt: new Date() }).where(eq(workNotifications.id, notification.id));
  return { notificationId: notification.id };
}

export async function archiveMyNotification(input: { storeId: number; userId: number; notificationId: number }) {
  const db = await requireDb();
  const [notification] = await db.select({ id: workNotifications.id }).from(workNotifications).where(and(eq(workNotifications.id, input.notificationId), eq(workNotifications.storeId, input.storeId), eq(workNotifications.recipientUserId, input.userId))).limit(1);
  if (!notification) throw new Error("التنبيه غير موجود ضمن مركز التنبيهات الخاص بك.");
  await db.update(workNotifications).set({ readAt: new Date(), archivedAt: new Date() }).where(eq(workNotifications.id, notification.id));
  return { notificationId: notification.id };
}

export async function getMyNotificationPreferences(input: { storeId: number; userId: number }) {
  const db = await requireDb();
  const [preferences] = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.storeId, input.storeId), eq(notificationPreferences.userId, input.userId))).limit(1);
  return preferences ?? { storeId: input.storeId, userId: input.userId, inboxAssignments: true, botHandoffs: true, crmTasks: true, reviewRequests: true, orderUpdates: true };
}

export async function saveMyNotificationPreferences(input: { storeId: number; userId: number; inboxAssignments: boolean; botHandoffs: boolean; crmTasks: boolean; reviewRequests: boolean; orderUpdates: boolean }) {
  const db = await requireDb();
  const values = { storeId: input.storeId, userId: input.userId, inboxAssignments: input.inboxAssignments, botHandoffs: input.botHandoffs, crmTasks: input.crmTasks, reviewRequests: input.reviewRequests, orderUpdates: input.orderUpdates };
  await db.insert(notificationPreferences).values(values).onDuplicateKeyUpdate({ set: values });
  return getMyNotificationPreferences(input);
}
