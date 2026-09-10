import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products, stores } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { runMetaCatalogExport } from "./catalogExportDb";

const runLive = process.env.META_CATALOG_VISIBILITY_FIX === "1";

describe.runIf(runLive)("Meta Catalog live visibility repair", () => {
  it("updates H12 as published and verifies its Product Items", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة.");
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.productCode, "H12 test")).limit(1);
    const [store] = await db.select({ ownerId: stores.primaryOwnerUserId }).from(stores).where(eq(stores.id, 1)).limit(1);
    expect(product).toBeTruthy();
    expect(store?.ownerId).toBeTruthy();
    const result = await runMetaCatalogExport({ storeId: 1, catalogAssetId: 510040, productIds: [product!.id], createdByUserId: store!.ownerId! });
    expect(result.reused).toBe(false);
    expect(result.job.status).toBe("completed");
    expect(result.verification?.missing).toEqual([]);
    expect(result.verification?.categoryMismatches).toEqual([]);
  }, 60_000);
});
