import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { employeePermissionGrants, employeeProfiles, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { listAssignableStaffUsers, listStaffAccessSummaries, saveEmployeeAccess } from "./db";

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const createdUserIds: number[] = [];
const createdStoreIds: number[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (createdUserIds.length) {
    const profiles = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(inArray(employeeProfiles.userId, createdUserIds));
    if (profiles.length) await db.delete(employeePermissionGrants).where(inArray(employeePermissionGrants.employeeId, profiles.map(profile => profile.id)));
    await db.delete(employeeProfiles).where(inArray(employeeProfiles.userId, createdUserIds));
  }
  if (createdStoreIds.length) await db.delete(stores).where(inArray(stores.id, createdStoreIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.splice(0);
  createdStoreIds.splice(0);
});

describe("عزل إدارة موظفي المتجر", () => {
  it("يعرض أعضاء المتجر فقط ويرفض تعديل موظف تابع لمتجر آخر", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة للاختبار.");

    const [managerResult] = await db.insert(users).values({ openId: `staff-manager-${suffix}`, name: "مدير اختبار" });
    const [otherResult] = await db.insert(users).values({ openId: `staff-other-${suffix}`, name: "موظف متجر آخر" });
    const [unassignedResult] = await db.insert(users).values({ openId: `staff-new-${suffix}`, name: "موظف جديد" });
    const managerId = Number(managerResult.insertId);
    const otherId = Number(otherResult.insertId);
    const unassignedId = Number(unassignedResult.insertId);
    createdUserIds.push(managerId, otherId, unassignedId);

    const [storeAResult] = await db.insert(stores).values({ name: "متجر أ", slug: `staff-a-${suffix}`, status: "active", primaryOwnerUserId: managerId });
    const [storeBResult] = await db.insert(stores).values({ name: "متجر ب", slug: `staff-b-${suffix}`, status: "active", primaryOwnerUserId: otherId });
    const storeAId = Number(storeAResult.insertId);
    const storeBId = Number(storeBResult.insertId);
    createdStoreIds.push(storeAId, storeBId);

    await db.insert(employeeProfiles).values([
      { userId: managerId, storeId: storeAId, displayName: "مدير اختبار", isActive: true },
      { userId: otherId, storeId: storeBId, displayName: "موظف متجر آخر", isActive: true },
    ]);

    const staffInStoreA = await listStaffAccessSummaries(storeAId);
    expect(staffInStoreA.map(staff => staff.userId)).toEqual([managerId]);

    const assignable = await listAssignableStaffUsers();
    expect(assignable.map(user => user.userId)).toContain(unassignedId);
    expect(assignable.map(user => user.userId)).not.toContain(otherId);

    await expect(saveEmployeeAccess({
      userId: otherId,
      displayName: "محاولة غير مصرح بها",
      isActive: true,
      permissionCodes: ["staff.manage"],
      grantedByUserId: managerId,
      storeId: storeAId,
    })).rejects.toThrow("متجر تشغيلي آخر");

    const [otherProfile] = await db.select({ storeId: employeeProfiles.storeId }).from(employeeProfiles).where(eq(employeeProfiles.userId, otherId));
    expect(otherProfile.storeId).toBe(storeBId);
  });
});
