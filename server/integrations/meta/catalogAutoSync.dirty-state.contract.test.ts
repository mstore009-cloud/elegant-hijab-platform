import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Meta auto-sync dirty product contract", () => {
  const queueSource = readFileSync(resolve(process.cwd(), "server/integrations/meta/catalogAutoSync.ts"), "utf8");
  const productsSource = readFileSync(resolve(process.cwd(), "server/routers/products.ts"), "utf8");
  const catalogSource = readFileSync(resolve(process.cwd(), "server/products/catalogAutomation.ts"), "utf8");

  it("clears the previous successful sync timestamp when a product is queued", () => {
    expect(queueSource).toContain("lastMetaCatalogSyncAt: null");
    expect(queueSource).toContain("requestedAt: new Date()");
  });

  it("queues product detail changes and active OneDrive changes", () => {
    expect(productsSource).toContain("await queueProductMetaSync(ctx, productId)");
    expect(catalogSource).toContain("existingProduct.status === \"active\"");
    expect(catalogSource).toContain("enqueueMetaCatalogAutoSync");
  });
});
