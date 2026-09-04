import { describe, expect, it } from "vitest";
import { normalizeApprovedColorNames, parseCatalogProductMetadata, validateApprovedImageColorLinks } from "./productMetadata";

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

  it("يقبل PREVIOUS_PRICE_IQD فقط كسعر سابق أعلى من السعر الحالي", () => {
    expect(parseCatalogProductMetadata(`PRODUCT_NAME_AR: حجاب
SELLING_PRICE_IQD: 12000
PREVIOUS_PRICE_IQD: 15000
DESCRIPTION_AR: وصف
SIZES: Medium
PRODUCT_STATUS: draft`)).toMatchObject({ sellingPrice: "12000", previousPrice: "15000" });
    expect(() => parseCatalogProductMetadata(`PRODUCT_NAME_AR: حجاب
SELLING_PRICE_IQD: 12000
PREVIOUS_PRICE_IQD: 12000
DESCRIPTION_AR: وصف
SIZES:
PRODUCT_STATUS: draft`)).toThrow("خصم حقيقي");
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

  it("يوحد أسماء الألوان المعتمدة ويرفض بقايا المثال", () => {
    expect(normalizeApprovedColorNames([" عنابي ", "زيتي", "عنابي"])).toEqual(["عنابي", "زيتي"]);
    expect(() => normalizeApprovedColorNames(["...زيتي"])).toThrow("بقايا المثال");
  });

  it("يتحقق من ربط صورة واحدة بكل لون معتمد", () => {
    expect(validateApprovedImageColorLinks({
      approvedColorNames: ["عنابي", "زيتي"],
      availableImageFileNames: ["a.png", "b.jpg"],
      links: [{ colorName: "عنابي", imageFileName: "a.png" }, { colorName: "زيتي", imageFileName: "b.jpg" }],
    })).toHaveLength(2);
    expect(() => validateApprovedImageColorLinks({
      approvedColorNames: ["عنابي"],
      availableImageFileNames: ["a.png"],
      links: [{ colorName: "عنابي", imageFileName: "a.png" }, { colorName: "عنابي", imageFileName: "a.png" }],
    })).toThrow("تكرار");
  });
});
