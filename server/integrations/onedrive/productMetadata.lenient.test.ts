import { describe, expect, it } from "vitest";
import { parseCatalogProductMetadataLenient } from "./productMetadata";

describe("محلل بيانات Catalog المتسامح", () => {
  it("يستخرج ما يمكنه من ملف ناقص ويعيد النواقص بدل رفض المجلد", () => {
    expect(parseCatalogProductMetadataLenient("PRODUCT_NAME_AR: حجاب اختبار\nSIZES: Medium, Large")).toEqual({
      name: "حجاب اختبار",
      sellingPrice: null,
      description: null,
      sizes: ["Medium", "Large"],
      problems: ["sellingPrice", "description"],
    });
  });

  it("يتعامل مع غياب product.txt كمسودة قابلة للإكمال", () => {
    expect(parseCatalogProductMetadataLenient(null)).toEqual({ name: null, sellingPrice: null, description: null, sizes: [], problems: ["product.txt"] });
  });
});
