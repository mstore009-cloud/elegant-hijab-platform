import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditEvents, stores, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { listRecentAuditEvents, recordAuditEvent } from "./db";

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
let storeId: number | undefined;
let userId: number | undefined;

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  if (storeId) await db.delete(auditEvents).where(eq(auditEvents.storeId, storeId));
  if (storeId) await db.delete(stores).where(eq(stores.id, storeId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
  storeId = undefined;
  userId = undefined;
});

describe("audit events", () => {
  it("keeps sensitive changes scoped to their operational store", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة للاختبار.");
    const userResult = await db.insert(users).values({ openId: `audit-owner-${suffix}`, name: "مالك اختبار التدقيق", role: "admin" });
    userId = Number(userResult[0].insertId);
    const storeResult = await db.insert(stores).values({ name: "متجر اختبار التدقيق", slug: `audit-test-${suffix}`, primaryOwnerUserId: userId });
    storeId = Number(storeResult[0].insertId);

    await recordAuditEvent({
      storeId,
      actorUserId: userId,
      entityType: "employee_access",
      entityId: 77,
      action: "permissions.updated",
      summary: "تم تحديث صلاحيات الموظف.",
      metadata: { permissionCodes: ["products.edit"] },
    });

    const events = await listRecentAuditEvents(storeId);
    expect(events[0]).toMatchObject({ storeId, actorUserId: userId, entityType: "employee_access", entityId: "77", action: "permissions.updated" });
    expect(events[0]?.metadata).toContain("products.edit");
  });
});
