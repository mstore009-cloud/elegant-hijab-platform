import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Inbox Meta history sync visibility", () => {
  it("يعرض حالة المزامنة التلقائية ورابط إدارة الربط حتى عندما لا توجد مهام", () => {
    const source = readFileSync(new URL("./Inbox.tsx", import.meta.url), "utf8");
    expect(source).toContain("metaConnections.historyProgress.useQuery");
    expect(source).toContain("بانتظار اختيار أصول الرسائل");
    expect(source).toContain("تبدأ المزامنة الأولية تلقائياً");
    expect(source).toContain("عرض الربط والتقدم");
    expect(source).not.toContain("{historyJobs.length > 0 && <section");
  });
});
