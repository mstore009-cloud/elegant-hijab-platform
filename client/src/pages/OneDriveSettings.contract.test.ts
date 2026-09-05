import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("عقد إعداد OneDrive للمتجر", () => {
  it("يعرض إعداد Microsoft فقط ولا يخلط الأسرار مع التشغيل", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/OneDriveSettings.tsx"), "utf8");
    expect(source).toContain("trpc.integrations.oneDriveAppSettings.useQuery");
    expect(source).toContain("trpc.integrations.saveOneDriveAppSettings.useMutation");
    expect(source).toContain("trpc.integrations.testOneDriveAppSettings.useMutation");
    expect(source).toContain("Application (client) ID");
    expect(source).toContain("Client Secret");
    expect(source).toContain("Redirect URI المطلوب في Microsoft");
    expect(source).toContain("إعدادات التطبيق السرية فقط");
    expect(source).not.toContain("encryptedAccessToken");
    expect(source).not.toContain("encryptedRefreshToken");
    expect(source).not.toContain("trpc.integrations.catalogSelectionStatus.useQuery");
    expect(source).not.toContain("trpc.integrations.previewCatalogTree.useQuery");
    expect(source).not.toContain("trpc.integrations.syncCatalogCategoryTree.useMutation");
  });

  it("توجّه التشغيل إلى قسم المنتجات", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/OneDriveSettings.tsx"), "utf8");
    expect(source).toContain("window.location.assign(\"/products\")");
    expect(source).toContain("الاتصال، جذر المنتجات، معاينة الشجرة، والاستيراد الفعلي");
  });
});
