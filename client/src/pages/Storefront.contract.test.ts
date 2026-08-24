import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("واجهة المتجر العامة", () => {
  it("تعرض المنتجات النشطة وتفاصيل اللون وسلة وملخصًا نهائيًا للطلب", () => {
    const source = readFileSync(new URL("./Storefront.tsx", import.meta.url), "utf8");
    expect(source).toContain("trpc.products.publicList.useQuery");
    expect(source).toContain("trpc.products.publicByCode.useQuery");
    expect(source).toContain("تمت إضافة اللون إلى السلة");
    expect(source).toContain("اختاري اللون");
    expect(source).toContain("أضف ");
    expect(source).toContain("تم ومتابعة الطلب");
    expect(source).toContain("سلتك");
    expect(source).toContain("governorates");
    expect(source).toContain("اختاري المحافظة");
    expect(source).toContain("border-2");
    expect(source).toContain("أجرة التوصيل");
    expect(source).toContain("الإجمالي النهائي");
    expect(source).toContain("موافق وإرسال الطلب");
    expect(source).toContain("trpc.orders.createFromStorefront.useMutation");
    expect(source).toContain("applyCoupon");
    expect(source).toContain("removeCoupon");
    expect(source).toContain("قسيمة الخصم");
    expect(source).toContain("خصم القسيمة");
    expect(source).toContain("couponCode: appliedCoupon");
    expect(source).toContain("price(total)");
    expect(source).not.toContain("الدفع الإلكتروني");
  });
});
