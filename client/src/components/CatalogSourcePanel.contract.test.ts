import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("عقد لوحة مصدر OneDrive داخل المنتجات", () => {
  it("تربط حالة المتجر والجذر والمعاينات ومسار الاستيراد الفعلي", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/CatalogSourcePanel.tsx"), "utf8");
    expect(source).toContain("trpc.integrations.catalogSelectionStatus.useQuery");
    expect(source).toContain("trpc.integrations.catalogRootFolders.useQuery");
    expect(source).toContain("trpc.integrations.catalogFolderChildren.useQuery");
    expect(source).toContain("trpc.integrations.selectCatalogRoot.useMutation");
    expect(source).toContain("trpc.integrations.previewCatalogTree.useQuery");
    expect(source).toContain("trpc.integrations.previewCatalogGroupProducts.useQuery");
    expect(source).toContain("trpc.integrations.syncCatalogCategoryTree.useMutation");
    expect(source).toContain("trpc.catalogSync.runNow.useMutation");
    expect(source).toContain("استيراد/تحديث من OneDrive");
    expect(source).toContain("معاينة الشجرة والأقسام");
    expect(source).toContain("تغيير الجذر");
  });
});
