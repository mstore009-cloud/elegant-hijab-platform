import { describe, expect, it } from "vitest";
import { absoluteMetaCatalogStorageUrl } from "./catalogExportDb";

describe("روابط وسائط Meta Catalog", () => {
  it("يبني رابط الوسيط من نطاق المنصة العام وليس رابط WhatsApp أو صفحة المنتج", async () => {
    const url = await absoluteMetaCatalogStorageUrl("products/7/meta-catalog/image/1.jpg");
    expect(url).toContain("/manus-storage/products/7/meta-catalog/image/1.jpg");
    expect(url).not.toContain("wa.me");
    expect(url).toMatch(/^https:\/\//);
  });
});
