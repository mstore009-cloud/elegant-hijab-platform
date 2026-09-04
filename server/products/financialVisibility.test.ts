import { describe, expect, it } from "vitest";
import { presentProductForViewer } from "./financialVisibility";

const product = {
  id: 7,
  productCode: "HJB-007",
  name: "حجاب أميرة",
  category: "حجابات",
  status: "draft",
  sellingPrice: "8000.00",
  previousPrice: "10000.00",
  costPrice: "4200.00",
  targetMarginPercent: "47.50",
};

describe("حجب البيانات المالية للمنتجات", () => {
  it("لا يعيد سعر التكلفة أو الهامش للموظف غير المخول", () => {
    const visible = presentProductForViewer(product, false);
    expect(visible).not.toHaveProperty("costPrice");
    expect(visible).not.toHaveProperty("targetMarginPercent");
    expect(visible).toMatchObject({ productCode: "HJB-007", sellingPrice: "8000.00", previousPrice: "10000.00" });
  });

  it("يعيد الحقول المالية للمدير أو للمخول صراحة", () => {
    const visible = presentProductForViewer(product, true);
    expect(visible).toMatchObject({ previousPrice: "10000.00", costPrice: "4200.00", targetMarginPercent: "47.50" });
  });
});
