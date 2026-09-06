import crypto from "node:crypto";
import { getMetaCatalogFieldDescriptors } from "./catalogTaxonomy";

export type MetaCatalogProduct = {
  id: number;
  productCode: string;
  name: string;
  category?: string | null;
  description?: string | null;
  status: "draft" | "needs_review" | "ready" | "active" | "archived" | string;
  sellingPrice: string | number;
  previousPrice?: string | number | null;
  exportEnabled?: boolean;
  productLink?: string | null;
  fbProductCategory?: string | null;
  googleProductCategory?: string | null;
  material?: string | null;
  pattern?: string | null;
  gender?: "female" | "male" | "unisex" | null;
  ageGroup?: "newborn" | "infant" | "toddler" | "kids" | "teen" | "adult" | "all ages" | null;
  productType?: string | null;
  defaultAvailability?: "in stock" | "out of stock" | "available for order" | "discontinued";
  condition?: "new" | "refurbished" | "used";
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
  catalogUrl?: string | null;
  operationalUrl?: string | null;
  sortOrder?: number | null;
};

export type MetaCatalogProductItem = {
  id: string;
  retailer_id: string;
  title: string;
  description: string;
  availability: "in stock" | "out of stock" | "available for order" | "discontinued";
  condition: "new" | "refurbished" | "used";
  brand: string;
  price: string;
  sale_price?: string;
  color?: string;
  size?: string;
  item_group_id?: string;
  link: string;
  fb_product_category?: string;
  google_product_category?: string;
  material?: string;
  pattern?: string;
  gender?: "female" | "male" | "unisex";
  age_group?: "newborn" | "infant" | "toddler" | "kids" | "teen" | "adult" | "all ages";
  product_type?: string;
  image?: Array<{ url: string }>;
  video?: Array<{ url: string }>;
};

function money(value: string | number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("قيمة مالية غير صالحة لتصدير Meta Catalog.");
  return parsed.toFixed(2);
}

function titleFor(product: MetaCatalogProduct, variant: MetaCatalogVariant) {
  return [product.name.trim(), variant.colorName.trim(), variant.sizeLabel?.trim()].filter(Boolean).join(" - ").slice(0, 100);
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
  if (product.exportEnabled === false) return { items: [] as MetaCatalogProductItem[], skipped: true, reason: "استُبعد المنتج من تصدير Meta عبر إعداداته الخاصة." };
  if (!variants.length) return { items: [] as MetaCatalogProductItem[], skipped: true, reason: "لا توجد متغيرات معتمدة لتصدير المنتج." };
  if (!product.fbProductCategory?.trim()) return { items: [] as MetaCatalogProductItem[], skipped: true, reason: "اختر فئة Meta من Taxonomy الرسمية في إعدادات المتجر أو المجموعة أو المنتج." };
  const productLink = product.productLink;
  if (!productLink || !/^https:\/\//i.test(productLink)) return { items: [] as MetaCatalogProductItem[], skipped: true, reason: "أضف رابط صفحة المنتج العامة في إعدادات Meta Catalog أو استثناء المنتج." };
  if (!input.brand.trim()) return { items: [] as MetaCatalogProductItem[], skipped: true, reason: "أضف العلامة التجارية في إعدادات Meta Catalog." };
  const currentPrice = money(product.sellingPrice);
  const priorPrice = product.previousPrice == null ? null : money(product.previousPrice);
  const salePrice = priorPrice && Number(priorPrice) > Number(currentPrice) ? `${currentPrice} ${input.currency}` : undefined;
  const regularPrice = `${priorPrice && Number(priorPrice) > Number(currentPrice) ? priorPrice : currentPrice} ${input.currency}`;
  const issues: string[] = [];
  const categoryFields = getMetaCatalogFieldDescriptors(product.fbProductCategory);
  if (categoryFields.some(field => field.key === "material") && !product.material?.trim()) {
    issues.push("الخامة غير موجودة في product.txt أو product.docx ولا يوجد استثناء يدوي للمنتج.");
  }
  const items = variants.flatMap(variant => {
    if (!variant.colorName?.trim()) {
      issues.push("يوجد متغير بلا اسم لون معتمد؛ لم يُنشأ له عنصر Meta.");
      return [];
    }
    const variantImages = media
      .filter(item => item.variantId === variant.id && item.mediaType === "image" && /^https?:\/\//i.test(item.catalogUrl ?? item.operationalUrl ?? ""))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (!variantImages.length) {
      issues.push(`لا توجد صورة صالحة لمتغير ${variant.colorName}${variant.sizeLabel ? ` (${variant.sizeLabel})` : ""}.`);
      return [];
    }
    const variantVideos = media
      .filter(item => item.variantId === variant.id && item.mediaType === "video" && /^https?:\/\//i.test(item.catalogUrl ?? item.operationalUrl ?? ""))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const item: MetaCatalogProductItem = {
      id: stableRetailerId(product, variant),
      retailer_id: stableRetailerId(product, variant),
      title: titleFor(product, variant),
      description: (product.description ?? product.name).trim().slice(0, 5000),
      availability: variant.inventoryQuantity > 0 ? (product.defaultAvailability ?? "in stock") : "out of stock",
      condition: product.condition ?? "new",
      brand: input.brand.trim().slice(0, 100),
      price: regularPrice,
      sale_price: salePrice,
      color: variant.colorName.trim().slice(0, 100) || undefined,
      size: variant.sizeLabel?.trim() || undefined,
      item_group_id: product.productCode.trim().slice(0, 100),
      link: productLink,
      fb_product_category: product.fbProductCategory?.trim() || undefined,
      google_product_category: product.googleProductCategory?.trim() || undefined,
      material: product.material?.trim() || undefined,
      pattern: product.pattern?.trim() || undefined,
      gender: product.gender ?? undefined,
      age_group: product.ageGroup ?? undefined,
      product_type: product.productType?.trim() || undefined,
      image: variantImages.slice(0, 21).map(entry => ({ url: entry.catalogUrl ?? entry.operationalUrl! })),
      video: variantVideos.slice(0, 20).map(entry => ({ url: entry.catalogUrl ?? entry.operationalUrl! })),
    };
    return [Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)) as MetaCatalogProductItem];
  });
  return { items, skipped: items.length === 0, reason: items.length === 0 ? (issues.join(" ") || "لا توجد متغيرات قابلة للتصدير.") : null, issues };
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
