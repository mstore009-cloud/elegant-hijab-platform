import { describe, expect, it } from "vitest";
import { buildCatalogExportIdempotencyKey, buildMetaCatalogProductItems, chunkMetaCatalogBatchRequests, submitMetaCatalogBatch, toMetaCatalogBatchRequests } from "./catalogExport";

describe("Meta Catalog export mapping", () => {
  const baseProduct = {
    id: 7,
    productCode: "HJ-001",
    name: "حجاب حريري",
    category: "حجابات",
    description: "وصف المنتج",
    status: "active" as const,
    sellingPrice: "25000.00",
    previousPrice: "30000.00",
    productLink: "https://shop.example/store/HJ-001",
    fbProductCategory: "Clothing & Accessories",
    material: "حرير",
    pattern: "سادة",
    gender: "female" as const,
    ageGroup: "adult" as const,
    productType: "حجابات > حريري",
  };
  const variants = [{ id: 11, colorName: "أسود", sizeLabel: "مقاس موحد", inventoryQuantity: 4 }];

  it("maps only active variants and uses previous price as regular price", () => {
    const result = buildMetaCatalogProductItems({
      product: baseProduct,
      variants,
      brand: "عالم الحجابات الأنيقة",
      currency: "IQD",
      media: [{ id: 1, variantId: 11, mediaType: "image", catalogUrl: "https://cdn.example/item.jpg", sortOrder: 0 }, { id: 2, variantId: 11, mediaType: "video", catalogUrl: "https://cdn.example/item.mp4", sortOrder: 1 }],
    });
    expect(result.skipped).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "HJ-001-11",
      retailer_id: "HJ-001-11",
      availability: "in stock",
      price: "30000.00 IQD",
      sale_price: "25000.00 IQD",
      image: [{ url: "https://cdn.example/item.jpg" }],
      video: [{ url: "https://cdn.example/item.mp4" }],
      size: "مقاس موحد",
      item_group_id: "HJ-001",
      link: "https://shop.example/store/HJ-001",
      fb_product_category: "Clothing & Accessories",
      material: "حرير",
      pattern: "سادة",
      gender: "female",
      age_group: "adult",
    });
    expect(JSON.stringify(result.items[0])).not.toContain("costPrice");
    expect(JSON.stringify(result.items[0])).not.toContain("targetMarginPercent");
  });

  it("skips drafts and does not create catalog items without a real active product", () => {
    const result = buildMetaCatalogProductItems({
      product: { ...baseProduct, status: "needs_review" },
      variants,
      brand: "Brand",
      currency: "IQD",
      media: [],
    });
    expect(result).toMatchObject({ skipped: true, items: [] });
  });

  it("requires a public product link and prefers the prepared Catalog image over the operational preview", () => {
    const missingLink = buildMetaCatalogProductItems({ product: { ...baseProduct, productLink: null }, variants, brand: "Brand", currency: "IQD", media: [{ id: 1, variantId: 11, mediaType: "image", catalogUrl: "https://cdn.example/original.jpg" }] });
    expect(missingLink).toMatchObject({ skipped: true, items: [] });
    const prepared = buildMetaCatalogProductItems({ product: baseProduct, variants, brand: "Brand", currency: "IQD", media: [{ id: 1, variantId: 11, mediaType: "image", catalogUrl: "https://cdn.example/original.jpg", operationalUrl: "https://cdn.example/preview.webp" }] });
    expect(prepared.items[0]?.image).toEqual([{ url: "https://cdn.example/original.jpg" }]);
  });

  it("does not invent a discount when previous price is absent or not higher", () => {
    const result = buildMetaCatalogProductItems({
      product: { ...baseProduct, previousPrice: "24000.00" },
      variants,
      brand: "Brand",
      currency: "IQD",
      media: [{ id: 1, variantId: 11, mediaType: "image", catalogUrl: "https://cdn.example/item.jpg" }],
    });
    expect(result.items[0]).toMatchObject({ price: "25000.00 IQD" });
    expect(result.items[0]).not.toHaveProperty("sale_price");
  });

  it("does not create a catalog item for a variant without an approved color name", () => {
    const result = buildMetaCatalogProductItems({
      product: baseProduct,
      variants: [{ id: 12, colorName: " ", sizeLabel: "", inventoryQuantity: 1 }],
      brand: "Brand",
      currency: "IQD",
      media: [{ id: 1, variantId: 12, mediaType: "image", catalogUrl: "https://cdn.example/item.jpg" }],
    });
    expect(result).toMatchObject({ skipped: true, items: [] });
    expect(result.issues?.join(" ")).toContain("بلا اسم لون معتمد");
  });

  it("creates a stable idempotency key for the exact export snapshot", () => {
    const input = buildMetaCatalogProductItems({ product: baseProduct, variants, brand: "Brand", currency: "IQD", media: [{ id: 1, variantId: 11, mediaType: "image", catalogUrl: "https://cdn.example/item.jpg" }] });
    const first = buildCatalogExportIdempotencyKey({ storeId: 1, catalogId: "cat-1", productItems: input.items });
    const second = buildCatalogExportIdempotencyKey({ storeId: 1, catalogId: "cat-1", productItems: input.items });
    expect(first).toBe(second);
    expect(toMetaCatalogBatchRequests(input.items)[0]).toMatchObject({ method: "UPDATE" });
  });

  it("chunks requests safely and submits only the official items_batch payload", async () => {
    const requests = toMetaCatalogBatchRequests(Array.from({ length: 5 }, (_, index) => ({ ...baseProduct, id: index + 1, productCode: `HJ-${index + 1}`, productLink: `https://shop.example/store/HJ-${index + 1}`, status: "active" as const })).flatMap(product => buildMetaCatalogProductItems({ product, variants, brand: "Brand", currency: "IQD", media: [{ id: 1, variantId: 11, mediaType: "image", catalogUrl: "https://cdn.example/item.jpg" }] }).items));
    expect(chunkMetaCatalogBatchRequests(requests, 2)).toHaveLength(3);
    let captured: { url: string; body: string; auth: string } | null = null;
    const result = await submitMetaCatalogBatch({
      catalogId: "catalog-1",
      accessToken: "token",
      graphApiVersion: "v21.0",
      requests,
      fetcher: async (url, init) => {
        captured = { url: String(url), body: String(init?.body), auth: String((init?.headers as Record<string, string>).Authorization) };
        return new Response(JSON.stringify({ handles: ["handle-1"], validation_status: [{ status: "success" }] }), { status: 200 });
      },
    });
    expect(captured).toMatchObject({ url: "https://graph.facebook.com/v21.0/catalog-1/items_batch", auth: "Bearer token" });
    expect(captured?.body).toContain("allow_upsert=true");
    expect(captured?.body).toContain("item_type=PRODUCT_ITEM");
    expect(result).toMatchObject({ handles: ["handle-1"] });
  });
});
