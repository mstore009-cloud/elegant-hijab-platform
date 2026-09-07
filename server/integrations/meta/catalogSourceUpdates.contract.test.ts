import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("سجل تحديثات Meta من OneDrive", () => {
  it("يعزل سجل المراجعة بالمتجر ولا يحسمه إلا بعد تجهيز أو تصدير محدد", () => {
    const source = readFileSync(resolve(process.cwd(), "server/integrations/meta/catalogSourceUpdates.ts"), "utf8");
    expect(source).toContain('eq(metaCatalogSourceUpdates.storeId, input.storeId)');
    expect(source).toContain('status: "pending_review"');
    expect(source).toContain('status: "exported"');
    expect(source).toContain("markMetaCatalogSourceUpdatesExported");
  });
});
