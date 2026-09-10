import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Products Meta change type and dismiss contract", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
  const autoSyncSource = readFileSync(resolve(process.cwd(), "server/integrations/meta/catalogAutoSync.ts"), "utf8");
  const productsRouterSource = readFileSync(resolve(process.cwd(), "server/routers/products.ts"), "utf8");

  it("labels the change type next to the sync status in the product card", () => {
    expect(pageSource).toContain("metaChangeTypeLabel");
    expect(pageSource).toContain("تعديل السعر");
    expect(pageSource).toContain("تعديل المخزون");
    expect(pageSource).toContain("تعديل الصورة");
    expect(pageSource).toContain("تعديل داخلي فقط");
  });

  it("provides a dismiss button for internal-only changes", () => {
    expect(pageSource).toContain("dismissInternalSync");
    expect(pageSource).toContain("تجاهل هذه المزامنة");
    expect(pageSource).toContain("product.lastMetaCatalogChangeInternal");
  });

  it("implements a dismiss mutation that refuses external catalog changes", () => {
    expect(productsRouterSource).toContain("dismissInternalMetaSync");
    expect(autoSyncSource).toContain("dismissInternalMetaCatalogAutoSync");
    expect(autoSyncSource).toContain("لا يمكن تجاهل المزامنة لتعديل خارجي");
    expect(autoSyncSource).toContain("metaCatalogSyncIgnoredAt: ignoredAt");
  });

  it("restores an ignored internal change to the pending queue", () => {
    expect(productsRouterSource).toContain("restoreInternalMetaSync");
    expect(autoSyncSource).toContain("restoreInternalMetaCatalogAutoSync");
    expect(pageSource).toContain("إعادة للمزامنة");
    expect(pageSource).toContain("restoreInternalSync.mutate");
  });
});
