import { eq } from "drizzle-orm";
import { employeePermissionGrants, employeeProfiles, users } from "../../drizzle/schema";
import { getDb } from "../db";

export async function getEmployeePermissionCodesForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ permissionCode: employeePermissionGrants.permissionCode })
    .from(employeeProfiles)
    .innerJoin(employeePermissionGrants, eq(employeePermissionGrants.employeeId, employeeProfiles.id))
    .where(eq(employeeProfiles.userId, userId));

  return rows.map(row => row.permissionCode);
}

export async function getEmployeeAccessSummary(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const profiles = await db
    .select({
      id: employeeProfiles.id,
      displayName: employeeProfiles.displayName,
      jobTitle: employeeProfiles.jobTitle,
      isActive: employeeProfiles.isActive,
    })
    .from(employeeProfiles)
    .where(eq(employeeProfiles.userId, userId))
    .limit(1);

  return profiles[0] ?? null;
}

export async function listStaffAccessSummaries() {
  const db = await getDb();
  if (!db) return [];

  const staff = await db
    .select({
      employeeId: employeeProfiles.id,
      userId: users.id,
      name: users.name,
      displayName: employeeProfiles.displayName,
      jobTitle: employeeProfiles.jobTitle,
      isActive: employeeProfiles.isActive,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId));

  const grantRows = await db.select().from(employeePermissionGrants);
  return staff.map(member => ({
    ...member,
    permissions: grantRows
      .filter(grant => grant.employeeId === member.employeeId)
      .map(grant => grant.permissionCode),
  }));
}

export async function saveEmployeeAccess(input: {
  userId: number;
  displayName: string;
  jobTitle?: string;
  isActive: boolean;
  permissionCodes: string[];
  grantedByUserId: number;
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
    await db
      .update(employeeProfiles)
      .set({ displayName: input.displayName, jobTitle: input.jobTitle ?? null, isActive: input.isActive })
      .where(eq(employeeProfiles.id, employeeId));
  } else {
    const result = await db.insert(employeeProfiles).values({
      userId: input.userId,
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
