import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("عقد الصور والألوان والمخزون في واجهة المنتج", () => {
  it("يربط بيانات mediaPreviews بمعرض صور المنتج وتحليل الألوان وإدخال المخزون", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");

    expect(source).toContain("trpc.products.mediaPreviews.useQuery");
    expect(source).toContain("selectedProductMedia.data?.[0]");
    expect(source).toContain("selectedProductMedia.data?.map(media");
    expect(source).toContain("trpc.products.analyzeColors.useMutation");
    expect(source).toContain("const suggestionMedia = suggestion.mediaIds.map(mediaId => mediaById.get(mediaId))");
    expect(source).toContain("صور مرتبطة");
    expect(source).toContain("trpc.products.addColor.useMutation");
    expect(source).toContain("trpc.products.saveInventory.useMutation");
  });
});
