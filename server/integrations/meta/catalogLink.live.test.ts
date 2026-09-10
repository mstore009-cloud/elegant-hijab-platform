import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { metaAssets, products, stores } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getMetaCatalogAccessToken } from "./db";
import { buildMetaCatalogExportSnapshot, runMetaCatalogExport } from "./catalogExportDb";

const runLive = process.env.META_CATALOG_LINK_LIVE_CHECK === "1";

describe.runIf(runLive)("Meta Catalog live product link", () => {
  it("syncs one product and verifies all h04 variants exist in Meta", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة.");
    const [asset] = await db.select({ id: metaAssets.id, connectionId: metaAssets.connectionId, externalId: metaAssets.externalId })
      .from(metaAssets)
      .where(and(eq(metaAssets.id, 510040), eq(metaAssets.assetType, "catalog")))
      .limit(1);
    expect(asset).toBeTruthy();
    const [product] = await db.select({ id: products.id, productCode: products.productCode })
      .from(products)
      .where(and(eq(products.storeId, 1), eq(products.productCode, "h04")))
      .limit(1);
    expect(product).toBeTruthy();
    const [store] = await db.select({ ownerId: stores.primaryOwnerUserId }).from(stores).where(eq(stores.id, 1)).limit(1);
    expect(store?.ownerId).toBeTruthy();

    const snapshot = await buildMetaCatalogExportSnapshot({ storeId: 1, catalogAssetId: asset!.id, productIds: [product!.id] });
    expect(snapshot.items.length).toBeGreaterThan(0);
    const expectedRetailerIds = snapshot.items.map(item => item.retailer_id);
    const expectedLinks = Array.from(new Set(snapshot.items.map(item => item.link)));
    expect(expectedLinks).toHaveLength(1);
    expect(expectedLinks[0]).toBe("https://wa.me/message/EL7M7TRX6QQVN1/h04");

    const result = await runMetaCatalogExport({ storeId: 1, catalogAssetId: asset!.id, productIds: [product!.id], createdByUserId: store!.ownerId! });
    expect(result.job.status).toBe("completed");

    const token = await getMetaCatalogAccessToken({ storeId: 1, connectionId: asset!.connectionId, assetId: asset!.id });
    const items: any[] = [];
    let nextUrl: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const url = nextUrl ? new URL(nextUrl) : new URL(`https://graph.facebook.com/v26.0/${encodeURIComponent(asset!.externalId)}/products`);
      if (!nextUrl) {
        url.searchParams.set("fields", "id,retailer_id,title,fb_product_category,material");
        url.searchParams.set("limit", "100");
      }
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
      const body = await response.json().catch(() => null) as any;
      expect(response.ok, JSON.stringify(body)).toBe(true);
      if (Array.isArray(body?.data)) items.push(...body.data);
      const found = new Set(items.map(item => item.retailer_id));
      if (expectedRetailerIds.every(retailerId => found.has(retailerId))) break;
      nextUrl = typeof body?.paging?.next === "string" ? body.paging.next : null;
      if (!nextUrl) break;
    }
    const foundRetailerIds = expectedRetailerIds.filter(retailerId => items.some(item => item.retailer_id === retailerId));
    console.log(JSON.stringify({ productCode: product!.productCode, catalogId: asset!.externalId, exportStatus: result.job.status, reused: result.reused, expectedRetailerIds, foundRetailerIds, expectedProductLink: expectedLinks[0], linkReadback: "Graph API v26 does not expose link on Product Item reads; verified in Commerce Manager UI." }, null, 2));
    expect(foundRetailerIds).toEqual(expectedRetailerIds);
  }, 120_000);
});
