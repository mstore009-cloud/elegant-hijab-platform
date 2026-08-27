import { describe, expect, it } from "vitest";
import { canViewSensitiveFinancialData, getEffectivePermissionSet, hasPermission } from "./permissions";

describe("نواة الصلاحيات الحبيبية", () => {
  it("لا تمنح البيانات المالية الحساسة لموظف لا يحمل صلاحيتها", () => {
    expect(
      canViewSensitiveFinancialData({
        isPlatformAdmin: false,
        grantedPermissionCodes: ["products.create", "products.inventory.update"],
      }),
    ).toBe(false);
  });

  it("تمنح البيانات المالية الحساسة فقط عند وجود الصلاحية الصريحة", () => {
    expect(
      canViewSensitiveFinancialData({
        isPlatformAdmin: false,
        grantedPermissionCodes: ["finance.view_sensitive"],
      }),
    ).toBe(true);
  });

  it("يعامل المدير كصاحب صلاحيات كاملة دون الحاجة إلى منح صفوف مكررة", () => {
    const permissions = getEffectivePermissionSet({ isPlatformAdmin: true, grantedPermissionCodes: [] });
    expect(permissions.has("finance.view_sensitive")).toBe(true);
    expect(
      hasPermission({
        isPlatformAdmin: true,
        grantedPermissionCodes: [],
        permissionCode: "orders.delivery.submit",
      }),
    ).toBe(true);
  });

  it("لا يمنح إدارة الموظفين إلا بالتصريح التشغيلي الصريح", () => {
    expect(
      hasPermission({
        isPlatformAdmin: false,
        grantedPermissionCodes: ["products.edit"],
        permissionCode: "staff.manage",
      }),
    ).toBe(false);
    expect(
      hasPermission({
        isPlatformAdmin: false,
        grantedPermissionCodes: ["staff.manage"],
        permissionCode: "staff.manage",
      }),
    ).toBe(true);
  });
});
