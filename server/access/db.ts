import { and, eq, isNull } from "drizzle-orm";
import { employeePermissionGrants, employeeProfiles, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";

export async function getEmployeePermissionCodesForUser(userId: number, storeId?: number) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ permissionCode: employeePermissionGrants.permissionCode })
    .from(employeeProfiles)
    .innerJoin(employeePermissionGrants, eq(employeePermissionGrants.employeeId, employeeProfiles.id))
    .where(storeId ? and(eq(employeeProfiles.userId, userId), eq(employeeProfiles.storeId, storeId)) : eq(employeeProfiles.userId, userId));

  return rows.map(row => row.permissionCode);
}

export async function getEmployeeAccessSummary(userId: number, storeId?: number) {
  const db = await getDb();
  if (!db) return null;

  const profiles = await db
    .select({
      id: employeeProfiles.id,
      storeId: employeeProfiles.storeId,
      displayName: employeeProfiles.displayName,
      jobTitle: employeeProfiles.jobTitle,
      isActive: employeeProfiles.isActive,
    })
    .from(employeeProfiles)
    .where(storeId ? and(eq(employeeProfiles.userId, userId), eq(employeeProfiles.storeId, storeId)) : eq(employeeProfiles.userId, userId))
    .limit(1);

  return profiles[0] ?? null;
}

export async function listStaffAccessSummaries(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  const staff = await db
    .select({
      employeeId: employeeProfiles.id,
      storeId: employeeProfiles.storeId,
      storeName: stores.name,
      userId: users.id,
      name: users.name,
      displayName: employeeProfiles.displayName,
      jobTitle: employeeProfiles.jobTitle,
      isActive: employeeProfiles.isActive,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .innerJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
    .innerJoin(stores, eq(employeeProfiles.storeId, stores.id))
    .where(eq(employeeProfiles.storeId, storeId));

  const grantRows = await db.select().from(employeePermissionGrants);
  return staff.map(member => ({
    ...member,
    permissions: grantRows
      .filter(grant => grant.employeeId === member.employeeId)
      .map(grant => grant.permissionCode),
  }));
}

export async function listAssignableStaffUsers() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
    .where(isNull(employeeProfiles.id));
}

export async function saveEmployeeAccess(input: {
  userId: number;
  displayName: string;
  jobTitle?: string;
  isActive: boolean;
  permissionCodes: string[];
  grantedByUserId: number;
  storeId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");

  const existing = await db
    .select({ id: employeeProfiles.id })
    .from(employeeProfiles)
    .where(eq(employeeProfiles.userId, input.userId))
    .limit(1);

  let employeeId = existing[0]?.id;
  if (employeeId) {
    const [existingProfile] = await db.select({ storeId: employeeProfiles.storeId }).from(employeeProfiles).where(eq(employeeProfiles.id, employeeId)).limit(1);
    if (!existingProfile || existingProfile.storeId !== input.storeId) throw new Error("لا يمكن تعديل ملف موظف تابع لمتجر تشغيلي آخر.");
    await db
      .update(employeeProfiles)
      .set({ displayName: input.displayName, jobTitle: input.jobTitle ?? null, isActive: input.isActive })
      .where(eq(employeeProfiles.id, employeeId));
  } else {
    const result = await db.insert(employeeProfiles).values({
      userId: input.userId,
      storeId: input.storeId,
      displayName: input.displayName,
      jobTitle: input.jobTitle ?? null,
      isActive: input.isActive,
    });
    employeeId = Number(result[0].insertId);
  }

  await db.delete(employeePermissionGrants).where(eq(employeePermissionGrants.employeeId, employeeId));
  if (input.permissionCodes.length > 0) {
    await db.insert(employeePermissionGrants).values(
      input.permissionCodes.map(permissionCode => ({
        employeeId: employeeId!,
        permissionCode,
        grantedByUserId: input.grantedByUserId,
      })),
    );
  }

  return { employeeId };
}
