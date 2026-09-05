import { describe, expect, it } from "vitest";
import { buildOneDriveCallbackUrl, normalizeOneDrivePublicBaseUrl } from "./appSettings";

describe("إعداد Microsoft المتجري لـ OneDrive", () => {
  it("يطبع نطاق HTTPS منشوراً ويزيل الشرطة الختامية", () => {
    expect(normalizeOneDrivePublicBaseUrl("https://store.example.com/")).toBe("https://store.example.com");
    expect(buildOneDriveCallbackUrl("https://store.example.com/")).toBe("https://store.example.com/api/onedrive/callback");
  });

  it("يرفض روابط المعاينة غير الآمنة أو المسارات التي لا يمكن تسجيلها كـ Redirect URI موحد", () => {
    expect(() => normalizeOneDrivePublicBaseUrl("http://store.example.com")).toThrow("HTTPS");
    expect(() => normalizeOneDrivePublicBaseUrl("https://store.example.com/settings")).toThrow("مسار");
    expect(() => normalizeOneDrivePublicBaseUrl("not-a-url")).toThrow("غير صالح");
  });
});
