import { describe, expect, it } from "vitest";
import { selectMostSpecificMetaGroupRule } from "./catalogEnrichment";
import { describeMetaProductTaxonomy, normalizeMetaFbProductCategory, searchMetaProductTaxonomy } from "./catalogTaxonomy";

describe("Meta Product Taxonomy الرسمية", () => {
  it("تبحث في قائمة Meta الكاملة وتدعم مرادف حجاب العربي", () => {
    const results = searchMetaProductTaxonomy({ query: "حجاب", limit: 20 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(entry => entry.path.includes("scarves & wraps"))).toBe(true);
  });

  it("تحفظ معرف Meta الرسمي عند اختيار الاسم أو المعرف وتمنع قيمة حرة", () => {
    expect(normalizeMetaFbProductCategory("381")).toBe("381");
    expect(normalizeMetaFbProductCategory("clothing & accessories > clothing accessories > women's accessories > scarves & wraps")).toBe("381");
    expect(() => normalizeMetaFbProductCategory("Not a Meta Category")).toThrow("Taxonomy الرسمية");
  });

  it("تعرض حقول اللون والخامة المتصلة بفئة إكسسوارات الملابس", () => {
    const category = describeMetaProductTaxonomy("381");
    expect(category?.fields.map(field => field.key)).toEqual(expect.arrayContaining(["color", "material", "gender", "age_group"]));
  });
});

describe("أولوية قواعد مجموعة Meta", () => {
  it("يختار مسار المجموعة الأكثر تحديداً ولا يطبق مساراً غير مطابق", () => {
    const rules = [{ groupPath: "ربطات" }, { groupPath: "ربطات/قطن" }, { groupPath: "حجابات" }];
    expect(selectMostSpecificMetaGroupRule("ربطات/قطن/تركي", rules)?.groupPath).toBe("ربطات/قطن");
    expect(selectMostSpecificMetaGroupRule("ربطات صيفية", rules)).toBeNull();
  });
});
