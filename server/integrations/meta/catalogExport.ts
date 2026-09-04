import crypto from "node:crypto";

export type MetaCatalogProduct = {
  id: number;
  productCode: string;
  name: string;
  category?: string | null;
  description?: string | null;
  status: "draft" | "needs_review" | "ready" | "active" | "archived" | string;
  sellingPrice: string | number;
  previousPrice?: string | number | null;
};

export type MetaCatalogVariant = {
  id: number;
  colorName: string;
  sizeLabel?: string | null;
  inventoryQuantity: number;
};

export type MetaCatalogMedia = {
  id: number;
  variantId?: number | null;
  mediaType: "image" | "video" | "document" | string;
  publicUrl?: string | null;
  sortOrder?: number | null;
};

export type MetaCatalogProductItem = {
  id: string;
  retailer_id: string;
  title: string;
  description: string;
  availability: "in stock" | "out of stock";
  condition: "new";
  brand: string;
  price: string;
  sale_price?: string;
  color?: string;
  additional_variant_attribute?: string;
  image?: Array<{ url: string }>;
};

function money(value: string | number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("قيمة مالية غير صالحة لتصدير Meta Catalog.");
  return parsed.toFixed(2);
}

function titleFor(product: MetaCatalogProduct, variant: MetaCatalogVariant) {
  return [product.name.trim(), variant.colorName.trim(), variant.sizeLabel?.trim()].filter(Boolean).join(" - ").slice(0, 220);
}

function stableRetailerId(product: MetaCatalogProduct, variant: MetaCatalogVariant) {
  return `${product.productCode.trim()}-${variant.id}`.slice(0, 100);
}

export function buildMetaCatalogProductItems(input: {
  product: MetaCatalogProduct;
  variants: MetaCatalogVariant[];
  media: MetaCatalogMedia[];
  brand: string;
  currency: string;
}) {
  const { product, variants, media } = input;
  if (product.status !== "active") return { items: [] as MetaCatalogProductItem[], skipped: true, reason: "يُسمح بتصدير المنتجات النشطة فقط." };
  if (!variants.length) return { items: [] as MetaCatalogProductItem[], skipped: true, reason: "لا توجد متغيرات معتمدة لتصدير المنتج." };
  const currentPrice = money(product.sellingPrice);
  const priorPrice = product.previousPrice == null ? null : money(product.previousPrice);
  const salePrice = priorPrice && Number(priorPrice) > Number(currentPrice) ? `${currentPrice} ${input.currency}` : undefined;
  const regularPrice = `${priorPrice && Number(priorPrice) > Number(currentPrice) ? priorPrice : currentPrice} ${input.currency}`;
  const items = variants.map(variant => {
    const variantMedia = media
      .filter(item => item.variantId === variant.id && item.mediaType === "image" && /^https?:\/\//i.test(item.publicUrl ?? ""))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const item: MetaCatalogProductItem = {
      id: stableRetailerId(product, variant),
      retailer_id: stableRetailerId(product, variant),
      title: titleFor(product, variant),
      description: (product.description ?? product.name).trim().slice(0, 5000),
      availability: variant.inventoryQuantity > 0 ? "in stock" : "out of stock",
      condition: "new",
      brand: input.brand.trim().slice(0, 100),
      price: regularPrice,
      sale_price: salePrice,
      color: variant.colorName.trim().slice(0, 100) || undefined,
      additional_variant_attribute: variant.sizeLabel?.trim() ? `Size:${variant.sizeLabel.trim().slice(0, 80)}` : undefined,
      image: variantMedia.length ? variantMedia.slice(0, 21).map(entry => ({ url: entry.publicUrl! })) : undefined,
    };
    return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)) as MetaCatalogProductItem;
  });
  return { items, skipped: false, reason: null };
}

export function buildCatalogExportIdempotencyKey(input: { storeId: number; catalogId: string; productItems: MetaCatalogProductItem[] }) {
  const payload = JSON.stringify({ storeId: input.storeId, catalogId: input.catalogId, productItems: input.productItems });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function toMetaCatalogBatchRequests(items: MetaCatalogProductItem[]) {
  return items.map(item => ({ method: "UPDATE" as const, data: item }));
}

export type MetaCatalogBatchRequest = ReturnType<typeof toMetaCatalogBatchRequests>[number];

export function chunkMetaCatalogBatchRequests(requests: MetaCatalogBatchRequest[], chunkSize = 2500) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 3000) throw new Error("حجم دفعة Meta Catalog يجب أن يكون بين 1 و3000.");
  const chunks: MetaCatalogBatchRequest[][] = [];
  for (let index = 0; index < requests.length; index += chunkSize) chunks.push(requests.slice(index, index + chunkSize));
  return chunks;
}

export async function submitMetaCatalogBatch(input: {
  catalogId: string;
  accessToken: string;
  requests: MetaCatalogBatchRequest[];
  graphApiVersion: string;
  fetcher?: typeof fetch;
}) {
  if (!input.requests.length) throw new Error("لا توجد عناصر صالحة لإرسالها إلى Meta Catalog.");
  const fetcher = input.fetcher ?? fetch;
  const url = `https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.catalogId)}/items_batch`;
  const response = await fetcher(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ item_type: "PRODUCT_ITEM", allow_upsert: "true", requests: JSON.stringify(input.requests) }),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || payload?.error) throw new Error(`فشل إرسال Meta Catalog: ${String(payload?.error?.message || response.statusText || "خطأ غير معروف").slice(0, 300)}`);
  return {
    handles: Array.isArray(payload?.handles) ? payload.handles.map(String).slice(0, 1) : [],
    validationStatus: Array.isArray(payload?.validation_status) ? payload.validation_status : [],
  };
}
