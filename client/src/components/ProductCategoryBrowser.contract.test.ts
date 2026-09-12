import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browserSource = readFileSync(new URL("./ProductCategoryBrowser.tsx", import.meta.url), "utf8");
const managerSource = readFileSync(new URL("./ProductCategoryManager.tsx", import.meta.url), "utf8");

describe("متصفح أقسام المنتجات", () => {
  it("يبقي كل الأقسام بداية واضحة ويكشف التصنيفات الفرعية فقط عند اختيار قسم", () => {
    expect(browserSource).toContain("كل المنتجات");
    expect(browserSource).toContain("كل {displayName(selectedPrimaryCategory)}");
    expect(browserSource).toContain("matchingTotal");
    expect(browserSource).toContain("onSelectPrimary");
  });

  it("يوفر إدارة القسم وإسناد المنتج المختار بلا كشف مصدر OneDrive التقني", () => {
    expect(managerSource).toContain("إدارة الأقسام");
    expect(managerSource).toContain("إضافة قسم أو تصنيف");
    expect(managerSource).toContain("تصنيف المنتج المفتوح");
    expect(managerSource).toContain("ولا تستبدله مزامنة OneDrive");
    expect(managerSource).toContain("trpc.products.categories.reorder.useMutation");
    expect(managerSource).toContain("رفع");
    expect(managerSource).toContain("خفض");
  });
});
