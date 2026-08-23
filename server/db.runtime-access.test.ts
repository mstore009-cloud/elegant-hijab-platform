import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "./db";

describe("اتصال قاعدة البيانات أثناء وقت التشغيل", () => {
  it("يكشف حالة القراءة فقط من نفس عميل قاعدة البيانات الذي يستخدمه OAuth", async () => {
    const db = await getDb();
    expect(db).not.toBeNull();
    const result = await db!.execute(sql`SELECT @@read_only AS readOnly`);
    const rows = result[0] as Array<{ readOnly?: number | string }>;
    const readOnly = String(rows[0]?.readOnly ?? "");
    expect(readOnly).toMatch(/^(0|OFF|false)$/i);
  }, 15_000);
});
