import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { employeeProfiles, stores, users, type User } from "../../drizzle/schema";
import { getDb } from "../db";
import { getOperationalStoreContext } from "./db";

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
let userId: number | undefined;
let storeId: number | undefined;

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (userId) await db.delete(employeeProfiles).where(eq(employeeProfiles.userId, userId));
  if (storeId) await db.delete(stores).where(eq(stores.id, storeId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  userId = undefined;
  storeId = undefined;
});

describe("operational store context", () => {
  it("returns only the active store assigned to the employee profile", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة للاختبار.");

    const createdUser = await db.insert(users).values({
      openId: `store-context-${suffix}`,
      name: "موظف اختبار النطاق",
      role: "user",
    });
    userId = Number(createdUser[0].insertId);

    const createdStore = await db.insert(stores).values({
      name: "متجر اختبار النطاق",
      slug: `scope-test-${suffix}`,
      status: "active",
      primaryOwnerUserId: userId,
    });
    storeId = Number(createdStore[0].insertId);

    await db.insert(employeeProfiles).values({
      userId,
      storeId,
      displayName: "موظف اختبار النطاق",
      isActive: true,
    });

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const context = await getOperationalStoreContext(user as User);

    expect(context).toMatchObject({
      source: "employee_profile",
      store: { id: storeId, slug: `scope-test-${suffix}`, status: "active" },
    });
  });
});
