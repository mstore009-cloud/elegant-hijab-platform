import { describe, expect, it } from "vitest";
import { parseCatalogProductMetadata } from "./productMetadata";

describe("parseCatalogProductMetadata", () => {
  it("يقبل SIZES الفارغ للمنتج غير المقيّس", () => {
    expect(parseCatalogProductMetadata(`PRODUCT_NAME_AR: حجاب اميرة كيبور
SELLING_PRICE_IQD: 8000
DESCRIPTION_AR: حجاب اميرة خامة كيبور
SIZES:
PRODUCT_STATUS: draft`)).toEqual({
      name: "حجاب اميرة كيبور",
      sellingPrice: "8000",
      description: "حجاب اميرة خامة كيبور",
      sizes: [],
      status: "draft",
    });
  });

  it("يقبل القياسات المفصولة بفواصل", () => {
    expect(parseCatalogProductMetadata(`PRODUCT_NAME_AR: حجاب
SELLING_PRICE_IQD: 12000
DESCRIPTION_AR: وصف
SIZES: Medium, Large
PRODUCT_STATUS: draft`).sizes).toEqual(["Medium", "Large"]);
  });

  it("يرفض بقايا المثال وعدم وجود SIZES", () => {
    expect(() => parseCatalogProductMetadata(`PRODUCT_NAME_AR: ...حجاب
SELLING_PRICE_IQD: 12000
DESCRIPTION_AR: وصف
SIZES:
PRODUCT_STATUS: draft`)).toThrow("بقايا المثال");
    expect(() => parseCatalogProductMetadata(`PRODUCT_NAME_AR: حجاب
SELLING_PRICE_IQD: 12000
DESCRIPTION_AR: وصف
PRODUCT_STATUS: draft`)).toThrow("SIZES");
  });
});
