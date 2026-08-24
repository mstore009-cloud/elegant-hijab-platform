import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("عقد الصور المرجعية في واجهة المنتج", () => {
  it("يعرض صور المنتج كمصدر لاسم اللون والعدد ويزيل إدخالات اللون والمخزون اليدوية", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");

    expect(source).toContain("trpc.products.mediaPreviews.useQuery");
    expect(source).toContain("<ProductMediaCard");
    expect(source).toContain("اسم اللون والعدد المكتوبان داخل الصورة هما المرجع التشغيلي الحالي");
    expect(source).toContain("إضافة صور");
    expect(source).not.toContain("trpc.products.addColor.useMutation");
    expect(source).not.toContain("trpc.products.saveInventory.useMutation");
    expect(source).not.toContain("trpc.products.saveColorInventory.useMutation");
    expect(source).not.toContain("trpc.products.analyzeColors.useMutation");
    expect(source).not.toContain("إضافة لون");
    expect(source).not.toContain("حفظ المخزون");
  });
});
