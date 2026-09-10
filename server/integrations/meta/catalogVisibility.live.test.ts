import { describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { products, stores } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { runMetaCatalogExport } from "./catalogExportDb";
import { getMetaCatalogAccessToken } from "./db";

const runLive = process.env.META_CATALOG_VISIBILITY_FIX === "1";

describe.runIf(runLive)("Meta Catalog live visibility repair", () => {
  it("updates H12 as published and verifies its Product Items", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة.");
    const activeProducts = await db.select({ id: products.id }).from(products).where(and(inArray(products.id, [990001, 1380001]), eq(products.storeId, 1)));
    const [store] = await db.select({ ownerId: stores.primaryOwnerUserId }).from(stores).where(eq(stores.id, 1)).limit(1);
    expect(activeProducts).toHaveLength(2);
    const result = await runMetaCatalogExport({ storeId: 1, catalogAssetId: 510040, productIds: activeProducts.map(product => product.id), createdByUserId: store!.ownerId! });
    const token = await getMetaCatalogAccessToken({ storeId: 1, connectionId: result.job.connectionId, assetId: 510040 });
    const checkUrl = new URL("https://graph.facebook.com/v26.0/998320369206650/check_batch_request_status");
    checkUrl.searchParams.set("handle", result.job.handle ?? "");
    checkUrl.searchParams.set("load_ids_of_invalid_requests", "true");
    checkUrl.searchParams.set("fields", "handle,status,warnings,errors_total_count,ids_of_invalid_requests");
    const batchStatus = await (await fetch(checkUrl, { headers: { Authorization: `Bearer ${token}` } })).json();
    console.log(JSON.stringify({ result, batchStatus }, null, 2));
    expect(result.reused).toBe(false);
    expect(result.job.status).toBe("completed");
    expect(result.verification?.missing).toEqual([]);
    expect(result.verification?.categoryMismatches).toEqual([]);
  }, 60_000);
});
