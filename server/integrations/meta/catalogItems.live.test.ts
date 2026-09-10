import { describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { metaAssets, productVariants, products } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getMetaCatalogAccessToken } from "./db";

const runLive = process.env.META_CATALOG_LIVE_CHECK === "1";

describe.runIf(runLive)("Meta Catalog live Product Items", () => {
  it("reads the exported H04 and H12 variants from the selected catalog", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة.");
    const [asset] = await db.select({ id: metaAssets.id, connectionId: metaAssets.connectionId, externalId: metaAssets.externalId })
      .from(metaAssets)
      .where(and(eq(metaAssets.id, 510040), eq(metaAssets.assetType, "catalog")))
      .limit(1);
    expect(asset).toBeTruthy();
    const token = await getMetaCatalogAccessToken({ storeId: 1, connectionId: asset!.connectionId, assetId: asset!.id });
    const rows = await db.select({ productCode: products.productCode, variantId: productVariants.id })
      .from(products)
      .innerJoin(productVariants, eq(productVariants.productId, products.id))
      .where(inArray(products.productCode, ["h04", "H12 test"]));
    const retailerIds = rows.map(row => `${row.productCode}-${row.variantId}`);
    expect(retailerIds.length).toBeGreaterThan(0);
    const url = new URL(`https://graph.facebook.com/v26.0/${encodeURIComponent(asset!.externalId)}/products`);
    url.searchParams.set("fields", "id,retailer_id,title,description,fb_product_category,material,video,videos,video_fetch_status,item_group_id,availability,condition,visibility,commerce_approval_status");
    url.searchParams.set("limit", "100");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => null) as any;
    const items = Array.isArray(body?.data) ? body.data : [];
    const results = retailerIds.map(retailerId => ({ retailerId, item: items.find((item: any) => item.retailer_id === retailerId) ?? null }));
    console.log(JSON.stringify({ catalogId: asset!.externalId, apiStatus: response.status, paging: body?.paging, results }, null, 2));
    expect(response.ok, JSON.stringify(body)).toBe(true);
    expect(results.every(result => result.item)).toBe(true);
    expect(results.filter(result => result.retailerId.startsWith("h04-")).every(result => String(result.item?.fb_product_category ?? "") === "381")).toBe(true);
    const h12Results = results.filter(result => result.retailerId.startsWith("H12 test-"));
    expect(h12Results.length).toBeGreaterThan(0);
    expect(h12Results.every(result => String(result.item?.fb_product_category ?? "") === "381")).toBe(true);
  }, 60_000);
});
