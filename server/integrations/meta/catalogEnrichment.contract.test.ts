import { describe, expect, it } from "vitest";
import { buildStorefrontProductUrl } from "./catalogEnrichment";

describe("رابط صفحة المنتج في Meta Catalog", () => {
  it("يبني رابط المنتج من نطاق المتجر الجذر", () => {
    expect(buildStorefrontProductUrl("https://shop.example", "HJ-001")).toBe("https://shop.example/store/HJ-001");
  });

  it("لا يكرر مسار /store عندما ينسخ المستخدم رابط واجهة المتجر الظاهر", () => {
    expect(buildStorefrontProductUrl("https://shop.example/store", "HJ-001")).toBe("https://shop.example/store/HJ-001");
  });

  it("يحافظ على مسار واجهة متجر مخصص", () => {
    expect(buildStorefrontProductUrl("https://shop.example/shop/", "HJ-001")).toBe("https://shop.example/shop/HJ-001");
  });
});
