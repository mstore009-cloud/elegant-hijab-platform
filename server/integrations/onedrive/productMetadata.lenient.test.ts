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

  it("يحفظ السعر السابق الحقيقي ويحوّل السعر السابق المضلل إلى نقص", () => {
    expect(parseCatalogProductMetadataLenient("PRODUCT_NAME_AR: حجاب\nSELLING_PRICE_IQD: 12000\nPREVIOUS_PRICE_IQD: 15000\nDESCRIPTION_AR: وصف\nSIZES:")).toMatchObject({ previousPrice: "15000", problems: [] });
    const invalidPreviousPrice = parseCatalogProductMetadataLenient("PRODUCT_NAME_AR: حجاب\nSELLING_PRICE_IQD: 12000\nPREVIOUS_PRICE_IQD: 10000\nDESCRIPTION_AR: وصف\nSIZES:");
    expect(invalidPreviousPrice.problems).toContain("previousPrice");
    expect(invalidPreviousPrice).not.toHaveProperty("previousPrice");
  });

  it("يتعامل مع غياب product.txt كمسودة قابلة للإكمال", () => {
    expect(parseCatalogProductMetadataLenient(null)).toEqual({ name: null, sellingPrice: null, description: null, sizes: [], problems: ["product.txt"] });
  });
});
