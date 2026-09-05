import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("عقد إعداد OneDrive للمتجر", () => {
  it("يعرض حالة اتصال المتجر واختيار الجذر من دون عرض أي رمز وصول", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/OneDriveSettings.tsx"), "utf8");

    expect(source).toContain("trpc.integrations.catalogSelectionStatus.useQuery");
    expect(source).toContain("trpc.integrations.beginCatalogSelection.useMutation");
    expect(source).toContain("trpc.integrations.catalogRootFolders.useQuery");
    expect(source).toContain("trpc.integrations.selectCatalogRoot.useMutation");
    expect(source).toContain("trpc.integrations.previewCatalogTree.useQuery");
    expect(source).toContain("trpc.integrations.syncCatalogCategoryTree.useMutation");
    expect(source).toContain("اعتماد شجرة التصنيفات");
    expect(source).toContain("لا تستورد منتجاً ولا تنزّل وسائط");
    expect(source).toContain("اختيار جذر شجرة المنتجات");
    expect(source).toContain("مرتبطة بالمتجر لا بالمستخدم");
    expect(source).toContain("لا تُخزّن كلمة المرور في المنصة");
    expect(source).not.toContain("encryptedAccessToken");
    expect(source).not.toContain("encryptedRefreshToken");
  });
});
