import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import { getEmployeePermissionCodesForUser } from "./db";
import { hasPermission, type PermissionCode } from "./permissions";

export async function assertPermission(user: User, permissionCode: PermissionCode) {
  const grantedPermissionCodes = await getEmployeePermissionCodesForUser(user.id);
  const allowed = hasPermission({
    isPlatformAdmin: user.role === "admin",
    grantedPermissionCodes,
    permissionCode,
  });
  if (!allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تنفيذ هذه العملية." });
  }
  return grantedPermissionCodes;
}
