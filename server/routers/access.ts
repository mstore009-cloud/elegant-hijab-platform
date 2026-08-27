import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEmployeeAccessSummary, getEmployeePermissionCodesForUser, listAssignableStaffUsers, listStaffAccessSummaries, saveEmployeeAccess } from "../access/db";
import { canViewSensitiveFinancialData, permissionCatalog, permissionCodes } from "../access/permissions";
import { recordAuditEvent } from "../audit/db";
import { listRecentAuditEvents } from "../audit/db";
import { assertPermission } from "../access/authorization";

const permissionCodeSchema = z.enum(permissionCodes as [string, ...string[]]);

export const accessRouter = router({
  myProfile: protectedProcedure.query(async ({ ctx }) => {
    const grantedPermissionCodes = await getEmployeePermissionCodesForUser(ctx.user.id, ctx.operationalStore?.id);
    const isPlatformAdmin = ctx.user.role === "admin";
    return {
      user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
      profile: await getEmployeeAccessSummary(ctx.user.id, ctx.operationalStore?.id),
      store: ctx.operationalStore ? { source: "request_context" as const, store: ctx.operationalStore } : null,
      permissions: isPlatformAdmin ? permissionCodes : grantedPermissionCodes,
      canViewSensitiveFinancialData: canViewSensitiveFinancialData({ isPlatformAdmin, grantedPermissionCodes }),
    };
  }),
  catalog: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "staff.manage");
    return permissionCatalog;
  }),
  listStaff: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "staff.manage");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
    return listStaffAccessSummaries(ctx.operationalStore.id);
  }),
  listAssignableUsers: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "staff.manage");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
    return listAssignableStaffUsers();
  }),
  recentAudit: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "staff.manage");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
    return listRecentAuditEvents(ctx.operationalStore.id, 20);
  }),
  saveStaffAccess: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        displayName: z.string().trim().min(2).max(160),
        jobTitle: z.string().trim().max(160).optional(),
        isActive: z.boolean(),
        permissionCodes: z.array(permissionCodeSchema).max(permissionCodes.length),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPermission(ctx.user, "staff.manage");
      if (input.userId === ctx.user.id && !input.permissionCodes.includes("staff.manage")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إزالة صلاحية إدارة الموظفين من حسابك عبر هذه العملية." });
      }
      if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
      const saved = await saveEmployeeAccess({ ...input, grantedByUserId: ctx.user.id, storeId: ctx.operationalStore.id });
      await recordAuditEvent({
        storeId: ctx.operationalStore.id,
        actorUserId: ctx.user.id,
        entityType: "employee_access",
        entityId: saved.employeeId,
        action: "permissions.updated",
        summary: `تم تحديث صلاحيات الموظف ${input.displayName}.`,
        metadata: { userId: input.userId, permissionCodes: input.permissionCodes, isActive: input.isActive },
      });
      return saved;
    }),
});
