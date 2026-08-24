import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("عقد بطاقات الألوان وتعديل المنتج", () => {
  it("يعرض بطاقة واحدة لكل لون ومراجعة تلقائية ومساحة تحرير منفصلة للعدد والصور", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");

    expect(source).toContain("trpc.products.mediaPreviews.useQuery");
    expect(source).toContain("<ColorCard");
    expect(source).toContain("تأكيد الألوان المقترحة");
    expect(source).toContain("تعديل المنتج");
    expect(source).toContain("إضافة مجموعة صور");
    expect(source).toContain("حفظ العدد");
    expect(source).toContain("trpc.products.analyzeColors.useMutation");
    expect(source).toContain("trpc.products.saveColorInventory.useMutation");
    expect(source).toContain("إضافة صور");
    expect(source).not.toContain("trpc.products.saveInventory.useMutation");
    expect(source).toContain("detachMedia");
    expect(source).not.toContain("حفظ المخزون");
  });
});
