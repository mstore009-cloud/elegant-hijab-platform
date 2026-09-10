import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { metaAssets } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getMetaCatalogAccessToken } from "./db";

const runLive = process.env.META_CATALOG_DIRECT_ACTIVATION === "1";

describe.runIf(runLive)("Meta direct Product Item activation", () => {
  it("activates archived H12 Product Items with the Product Item update API", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة.");
    const [asset] = await db.select({ id: metaAssets.id, connectionId: metaAssets.connectionId, externalId: metaAssets.externalId }).from(metaAssets).where(and(eq(metaAssets.id, 510040), eq(metaAssets.assetType, "catalog"))).limit(1);
    expect(asset).toBeTruthy();
    const token = await getMetaCatalogAccessToken({ storeId: 1, connectionId: asset!.connectionId, assetId: asset!.id });
    const listUrl = new URL(`https://graph.facebook.com/v26.0/${asset!.externalId}/products`);
    listUrl.searchParams.set("fields", "id,retailer_id,visibility,status,errors");
    listUrl.searchParams.set("filter", JSON.stringify({ retailer_id: { i_contains: "H12 test" } }));
    const list = await (await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })).json() as any;
    const items = Array.isArray(list.data) ? list.data : [];
    expect(items).toHaveLength(3);
    const updates = await Promise.all(items.map(async (item: any) => {
      const response = await fetch(`https://graph.facebook.com/v26.0/${item.id}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ visibility: "published", fb_product_category: "381" }) });
      return { id: item.id, retailerId: item.retailer_id, status: response.status, body: await response.json().catch(() => null) };
    }));
    console.log(JSON.stringify({ updates }, null, 2));
    expect(updates.every(update => update.status === 200)).toBe(true);
  }, 60_000);
});
