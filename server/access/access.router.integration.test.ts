import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { auditEvents, employeePermissionGrants, employeeProfiles, stores, users } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { getDb } from "../db";
import { appRouter } from "../routers";

const cleanup: { userIds: number[]; storeIds: number[] } = { userIds: [], storeIds: [] };

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (cleanup.userIds.length) {
    const profiles = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(inArray(employeeProfiles.userId, cleanup.userIds));
    if (profiles.length) await db.delete(employeePermissionGrants).where(inArray(employeePermissionGrants.employeeId, profiles.map(profile => profile.id)));
    await db.delete(employeeProfiles).where(inArray(employeeProfiles.userId, cleanup.userIds));
  }
  if (cleanup.storeIds.length) await db.delete(auditEvents).where(inArray(auditEvents.storeId, cleanup.storeIds));
  if (cleanup.storeIds.length) await db.delete(stores).where(inArray(stores.id, cleanup.storeIds));
  if (cleanup.userIds.length) await db.delete(users).where(inArray(users.id, cleanup.userIds));
  cleanup.userIds = [];
  cleanup.storeIds = [];
});

function context(user: any, store: any): TrpcContext {
  return { user, operationalStore: store, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("access router createCaller", () => {
  it("يقرأ الكتالوج وقائمة الموظفين ويحفظ منح موظف عبر tRPC", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار access router.");
    const suffix = randomUUID();
    const managerInsert = await db.insert(users).values({ openId: `access-router-manager-${suffix}`, name: "مدير صلاحيات router", role: "admin" });
    const targetInsert = await db.insert(users).values({ openId: `access-router-target-${suffix}`, name: "موظف صلاحيات router", role: "user" });
    const managerId = Number(managerInsert[0].insertId);
    const targetId = Number(targetInsert[0].insertId);
    cleanup.userIds.push(managerId, targetId);
    const storeInsert = await db.insert(stores).values({ name: "متجر access router", slug: `access-router-${suffix.slice(0, 8)}`, status: "active", primaryOwnerUserId: managerId });
    const storeId = Number(storeInsert[0].insertId);
    cleanup.storeIds.push(storeId);
    await db.insert(employeeProfiles).values({ userId: managerId, storeId, displayName: "مدير صلاحيات router", isActive: true });
    const [manager] = await db.select().from(users).where(eq(users.id, managerId)).limit(1);
    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    const caller = appRouter.createCaller(context(manager, store));
    expect((await caller.access.catalog()).length).toBeGreaterThan(0);
    expect((await caller.access.listStaff()).some(item => item.userId === managerId)).toBe(true);
    const saved = await caller.access.saveStaffAccess({ userId: targetId, displayName: "موظف مخول", jobTitle: "منتجات", isActive: true, permissionCodes: ["products.inventory.update"] });
    expect(saved.employeeId).toBeGreaterThan(0);
    const [savedProfile] = await db.select({ storeId: employeeProfiles.storeId, displayName: employeeProfiles.displayName, isActive: employeeProfiles.isActive }).from(employeeProfiles).where(eq(employeeProfiles.id, saved.employeeId)).limit(1);
    expect(savedProfile).toMatchObject({ storeId, displayName: "موظف مخول", isActive: true });
    const grants = await db.select({ permissionCode: employeePermissionGrants.permissionCode }).from(employeePermissionGrants).innerJoin(employeeProfiles, eq(employeePermissionGrants.employeeId, employeeProfiles.id)).where(eq(employeeProfiles.userId, targetId));
    expect(grants.map(grant => grant.permissionCode)).toEqual(["products.inventory.update"]);
  }, 15_000);

  it("يمنع المستخدم الذي لا يملك staff.manage من قراءة الكتالوج أو حفظ منح جديدة", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار منع access router.");
    const suffix = randomUUID();
    const userInsert = await db.insert(users).values({ openId: `access-router-user-${suffix}`, name: "مستخدم بلا إدارة", role: "user" });
    const userId = Number(userInsert[0].insertId);
    cleanup.userIds.push(userId);
    const storeInsert = await db.insert(stores).values({ name: "متجر منع access router", slug: `access-deny-${suffix.slice(0, 8)}`, status: "active", primaryOwnerUserId: userId });
    const storeId = Number(storeInsert[0].insertId);
    cleanup.storeIds.push(storeId);
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    const caller = appRouter.createCaller(context(user, store));
    await expect(caller.access.catalog()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.access.saveStaffAccess({ userId, displayName: "محاولة", isActive: true, permissionCodes: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 15_000);
});
