import { describe, expect, it } from "vitest";
import { deliveryTerms } from "./db";

describe("قاعدة التوصيل المجاني", () => {
  it("تطبق الأجرة الموحدة قبل بلوغ العتبة ثم تجعلها مجانية عند بلوغها", () => {
    const settings = { defaultDeliveryFee: "5000.00", freeDeliveryEnabled: true, freeDeliveryThreshold: "50000.00" };
    expect(deliveryTerms(settings, 49999)).toMatchObject({ fee: 5000, freeDelivery: false, threshold: 50000 });
    expect(deliveryTerms(settings, 50000)).toMatchObject({ fee: 0, freeDelivery: true, threshold: 50000 });
  });

  it("لا يطبق التوصيل المجاني إذا كان الخيار معطلًا", () => {
    expect(deliveryTerms({ defaultDeliveryFee: "5000.00", freeDeliveryEnabled: false, freeDeliveryThreshold: "1.00" }, 100000)).toMatchObject({ fee: 5000, freeDelivery: false });
  });
});
