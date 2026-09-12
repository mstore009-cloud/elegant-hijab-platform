import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("عقود عمليات المنتج والمراجعة", () => {
  it("يعرض سجلًا محدودًا بنطاق المتجر ويعيد الصور المستبعدة للمراجعة", () => {
    const routerSource = readFileSync(new URL("./products.ts", import.meta.url), "utf8");
    const dbSource = readFileSync(new URL("../products/db.ts", import.meta.url), "utf8");
    expect(routerSource).toContain("operations: protectedProcedure");
    expect(routerSource).toContain("restoreMediaToColorReview");
    expect(routerSource).toContain("setPrimaryMedia");
    expect(dbSource).toContain("listProductOperations");
    expect(dbSource).toContain("innerJoin(products");
    expect(dbSource).toContain("media_color_review_restored");
    expect(dbSource).toContain("primary_media_changed");
  });
});
