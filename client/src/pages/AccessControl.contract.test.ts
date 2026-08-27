import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("عقد واجهة الصلاحيات", () => {
  it("يعرض إدارة الموظفين وسجل التدقيق بحسب تفويض staff.manage لا بحسب دور admin العالمي فقط", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/AccessControl.tsx"), "utf8");
    expect(source).toContain('permissions.includes("staff.manage")');
    expect(source).toContain("trpc.access.recentAudit.useQuery");
    expect(source).toContain("آخر تغييرات الصلاحيات");
    expect(source).toContain("يعرض هذا القسم صلاحياتك الشخصية وحالة وصولك فقط");
    expect(source).not.toContain('profile.data?.user.role === "admin" && <section');
  });
});
