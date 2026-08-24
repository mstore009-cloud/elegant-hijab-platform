import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("واجهة المتجر العامة", () => {
  it("تعرض المنتجات النشطة وتفاصيل اللون ومعاينة فيديو تفاعلية بلا سلة أو دفع", () => {
    const source = readFileSync(new URL("./Storefront.tsx", import.meta.url), "utf8");
    expect(source).toContain("trpc.products.publicList.useQuery");
    expect(source).toContain("trpc.products.publicByCode.useQuery");
    expect(source).toContain("muted loop playsInline autoPlay");
    expect(source).toContain("اختاري اللون");
    expect(source).toContain("اطلب هذا المنتج");
    expect(source).toContain("trpc.orders.createFromStorefront.useMutation");
    expect(source).not.toContain("الدفع الإلكتروني");
  });
});
