import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("إعدادات أجور التوصيل", () => {
  it("تعرض المحافظات وتحفظ أجرتها عبر مسار الطلبات المحمي", () => {
    const source = readFileSync(new URL("./DeliverySettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("trpc.orders.deliveryRates.useQuery");
    expect(source).toContain("trpc.orders.saveDeliveryRate.useMutation");
    expect(source).toContain("بغداد");
    expect(source).toContain("دهوك");
    expect(source).toContain("الأجرة بالدينار العراقي");
  });
});
