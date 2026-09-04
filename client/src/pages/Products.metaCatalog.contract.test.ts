import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Products Meta Catalog export contract", () => {
  const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");

  it("exposes readiness, asset selection, safe preview, and guarded export", () => {
    expect(source).toContain("metaCatalog.readiness.useQuery");
    expect(source).toContain("metaCatalog.preview.useQuery");
    expect(source).toContain("metaCatalog.exportNow.useMutation");
    expect(source).toContain("لا يُرسل إلا المنتج النشط");
    expect(source).toContain("معاينة بلا بيانات مالية");
  });

  it("does not render a Catalog export action without a selected asset and preview items", () => {
    expect(source).toContain("!selectedMetaCatalogAssetId");
    expect(source).toContain("!metaCatalogPreview.data?.itemCount");
    expect(source).toContain("metaCatalogReadiness.data.capability.status !== \"ready\"");
  });
});
