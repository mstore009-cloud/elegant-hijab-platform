import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getEmployeeAccessSummary, getEmployeePermissionCodesForUser, listStaffAccessSummaries, saveEmployeeAccess } from "../access/db";
import { canViewSensitiveFinancialData, permissionCatalog, permissionCodes } from "../access/permissions";
import { getOperationalStoreContext } from "../stores/db";
import { recordAuditEvent } from "../audit/db";

const permissionCodeSchema = z.enum(permissionCodes as [string, ...string[]]);

export const accessRouter = router({
  myProfile: protectedProcedure.query(async ({ ctx }) => {
    const grantedPermissionCodes = await getEmployeePermissionCodesForUser(ctx.user.id);
    const isPlatformAdmin = ctx.user.role === "admin";
    const store = await getOperationalStoreContext(ctx.user);
    return {
      user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
      profile: await getEmployeeAccessSummary(ctx.user.id),
      store,
      permissions: isPlatformAdmin ? permissionCodes : grantedPermissionCodes,
      canViewSensitiveFinancialData: canViewSensitiveFinancialData({ isPlatformAdmin, grantedPermissionCodes }),
    };
  }),
  catalog: adminProcedure.query(() => permissionCatalog),
  listStaff: adminProcedure.query(() => listStaffAccessSummaries()),
  saveStaffAccess: adminProcedure
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
      if (input.userId === ctx.user.id && !input.permissionCodes.includes("settings.manage")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إزالة صلاحية إدارة الإعدادات من المدير الحالي عبر هذه العملية." });
      }
      const store = await getOperationalStoreContext(ctx.user);
      if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمدير الحالي." });
      const saved = await saveEmployeeAccess({ ...input, grantedByUserId: ctx.user.id, storeId: store.store.id });
      await recordAuditEvent({
        storeId: store.store.id,
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
