import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Inbox Meta history sync visibility", () => {
  it("يعرض حالة لم تبدأ ورابط بدء المزامنة حتى عندما لا توجد مهام", () => {
    const source = readFileSync(new URL("./Inbox.tsx", import.meta.url), "utf8");
    expect(source).toContain("metaConnections.historyProgress.useQuery");
    expect(source).toContain("لم تبدأ مزامنة الرسائل السابقة");
    expect(source).toContain("بدء المزامنة من مركز Meta");
    expect(source).not.toContain("{historyJobs.length > 0 && <section");
  });
});
