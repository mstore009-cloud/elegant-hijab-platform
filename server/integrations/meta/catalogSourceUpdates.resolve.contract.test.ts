import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("عقد حسم تعارضات OneDrive", () => {
  it("يعرض القيمتين ويطبق قرار المصدر أو المنصة ويسجل الأثر", () => {
    const source = readFileSync(resolve(process.cwd(), "server/integrations/meta/catalogSourceUpdates.ts"), "utf8");
    const router = readFileSync(resolve(process.cwd(), "server/routers/metaCatalog.ts"), "utf8");
    expect(source).toContain("resolveMetaCatalogSourceUpdate");
    expect(source).toContain("sourceFieldsAccepted");
    expect(source).toContain("platformFieldsKept");
    expect(source).toContain("onedrive_conflict_resolved");
    expect(router).toContain("resolveSourceUpdate");
    expect(router).toContain('z.enum(["source", "platform"])');
  });
});
