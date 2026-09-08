import { describe, expect, it } from "vitest";
import { matchesProductSearch, normalizeProductSearch } from "./productSearch";

describe("بحث المنتجات", () => {
  it("يطابق الاسم العربي عند اختلاف الهمزة والتشكيل", () => {
    expect(normalizeProductSearch("حِجاب أميرة")).toBe("حجاب اميره");
    expect(matchesProductSearch("حجاب اميره", ["حِجاب أميرة", "H04"])).toBe(true);
  });

  it("يطابق كود المنتج دون حساسية لحالة الأحرف ويجمع كلمات البحث", () => {
    expect(matchesProductSearch("hj 004", ["حجاب أميرة", "Hj-004"])).toBe(true);
    expect(matchesProductSearch("hj 005", ["حجاب أميرة", "Hj-004"])).toBe(false);
  });
});
