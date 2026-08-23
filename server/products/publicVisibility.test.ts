import { describe, expect, it } from "vitest";
import { isPublicProductStatus } from "./db";

describe("رؤية المنتجات العامة", () => {
  it("يقصر الظهور العام على المنتجات النشطة فقط", () => {
    expect(isPublicProductStatus("active")).toBe(true);
    expect(isPublicProductStatus("draft")).toBe(false);
    expect(isPublicProductStatus("needs_review")).toBe(false);
    expect(isPublicProductStatus("ready")).toBe(false);
    expect(isPublicProductStatus("archived")).toBe(false);
  });
});
