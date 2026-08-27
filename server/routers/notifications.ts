import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { archiveMyNotification, getMyNotificationPreferences, getMyNotificationSummary, listMyWorkNotifications, markMyNotificationRead, saveMyNotificationPreferences } from "../notifications/db";
import { protectedProcedure, router } from "../_core/trpc";

async function requireNotificationStore(ctx: any, permission: "notifications.view" | "notifications.manage") {
  await assertPermission(ctx.user, permission);
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
  return ctx.operationalStore.id as number;
}

export const notificationsRouter = router({
  listMine: protectedProcedure.input(z.object({ filter: z.enum(["all", "unread", "read", "archived"]).optional(), limit: z.number().int().min(1).max(200).optional() }).optional()).query(async ({ ctx, input }) => {
    const storeId = await requireNotificationStore(ctx, "notifications.view");
    return listMyWorkNotifications({ storeId, userId: ctx.user.id, filter: input?.filter, limit: input?.limit });
  }),
  summary: protectedProcedure.query(async ({ ctx }) => {
    const storeId = await requireNotificationStore(ctx, "notifications.view");
    return getMyNotificationSummary({ storeId, userId: ctx.user.id });
  }),
  markRead: protectedProcedure.input(z.object({ notificationId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const storeId = await requireNotificationStore(ctx, "notifications.manage");
    return markMyNotificationRead({ storeId, userId: ctx.user.id, notificationId: input.notificationId });
  }),
  archive: protectedProcedure.input(z.object({ notificationId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const storeId = await requireNotificationStore(ctx, "notifications.manage");
    return archiveMyNotification({ storeId, userId: ctx.user.id, notificationId: input.notificationId });
  }),
  preferences: protectedProcedure.query(async ({ ctx }) => {
    const storeId = await requireNotificationStore(ctx, "notifications.view");
    return getMyNotificationPreferences({ storeId, userId: ctx.user.id });
  }),
  savePreferences: protectedProcedure.input(z.object({ inboxAssignments: z.boolean(), botHandoffs: z.boolean(), crmTasks: z.boolean(), reviewRequests: z.boolean(), orderUpdates: z.boolean() })).mutation(async ({ ctx, input }) => {
    const storeId = await requireNotificationStore(ctx, "notifications.manage");
    return saveMyNotificationPreferences({ storeId, userId: ctx.user.id, ...input });
  }),
});
