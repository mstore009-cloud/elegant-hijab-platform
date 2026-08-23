import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("عقد معاينة وسائط المنتج في الواجهة", () => {
  it("يربط بيانات mediaPreviews بعناصر الصورة واللون واسم الملف", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");

    expect(source).toContain("trpc.products.mediaPreviews.useQuery");
    expect(source).toContain('import { ProductMediaPreview } from "@/components/ProductMediaPreview"');
    expect(source).toContain("<ProductMediaPreview media={selectedProductMedia.data} />");
  });
});
