import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Meta Catalog single-product sync contract", () => {
  const source = readFileSync(resolve(process.cwd(), "server/routers/metaCatalog.ts"), "utf8");

  it("exposes a protected syncProductNow procedure scoped to one product", () => {
    expect(source).toContain("syncProductNow: protectedProcedure");
    expect(source).toContain("productId: z.number().int().positive()");
    expect(source).toContain("productIds: [input.productId]");
  });

  it("uses the selected Catalog and reports a clear precondition when absent", () => {
    expect(source).toContain("asset.assetType === \"catalog\" && asset.isSelected");
    expect(source).toContain("لم يُحدد Catalog متصل لهذا المتجر بعد.");
  });
});
