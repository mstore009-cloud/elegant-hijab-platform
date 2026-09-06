import { and, eq } from "drizzle-orm";
import { metaCatalogEnrichmentSettings, metaCatalogProductEnrichments, products, stores } from "../../../drizzle/schema";
import { getDb } from "../../db";

export const META_CATALOG_GENDERS = ["female", "male", "unisex"] as const;
export const META_CATALOG_AGE_GROUPS = ["newborn", "infant", "toddler", "kids", "teen", "adult", "all ages"] as const;
export const META_CATALOG_CONDITIONS = ["new", "refurbished", "used"] as const;
export const META_CATALOG_AVAILABILITY = ["in stock", "out of stock", "available for order", "discontinued"] as const;
export const META_CATALOG_MEDIA_POLICIES = ["catalog_high_quality", "operational_fallback"] as const;

export type MetaCatalogEnrichmentInput = {
  brand?: string | null;
  currency?: string;
  condition?: (typeof META_CATALOG_CONDITIONS)[number];
  defaultFbProductCategory?: string | null;
  defaultGoogleProductCategory?: string | null;
  defaultGender?: (typeof META_CATALOG_GENDERS)[number] | null;
  defaultAgeGroup?: (typeof META_CATALOG_AGE_GROUPS)[number] | null;
  productLinkBaseUrl?: string | null;
  defaultProductType?: string | null;
  defaultAvailability?: (typeof META_CATALOG_AVAILABILITY)[number];
  mediaPolicy?: (typeof META_CATALOG_MEDIA_POLICIES)[number];
};

export type MetaCatalogProductEnrichmentInput = {
  fbProductCategory?: string | null;
  googleProductCategory?: string | null;
  material?: string | null;
  pattern?: string | null;
  gender?: (typeof META_CATALOG_GENDERS)[number] | null;
  ageGroup?: (typeof META_CATALOG_AGE_GROUPS)[number] | null;
  productType?: string | null;
  productLink?: string | null;
  exportEnabled?: boolean;
};

const DEFAULT_FB_PRODUCT_CATEGORY = "Clothing & Accessories";

function normalizeOptional(value: string | null | undefined, max: number) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, max) : null;
}

export function normalizeCatalogBaseUrl(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("رابط صفحة المنتج العام غير صالح."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("استخدم رابط HTTPS عاماً من دون بيانات دخول أو معاملات.");
  }
  return parsed.origin;
}

export function normalizeCatalogProductUrl(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("رابط المنتج الخاص غير صالح."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("يجب أن يكون رابط المنتج الخاص رابط HTTPS عاماً.");
  return parsed.toString();
}

function normalizedCurrency(value: string | undefined) {
  const currency = (value ?? "IQD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("العملة يجب أن تكون رمز ISO من ثلاثة أحرف، مثل IQD.");
  return currency;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

export async function getMetaCatalogEnrichmentSettings(storeId: number) {
  const db = await requireDb();
  const [[settings], [store]] = await Promise.all([
    db.select().from(metaCatalogEnrichmentSettings).where(eq(metaCatalogEnrichmentSettings.storeId, storeId)).limit(1),
    db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId)).limit(1),
  ]);
  return {
    id: settings?.id ?? null,
    storeId,
    brand: settings?.brand ?? store?.name ?? "",
    currency: settings?.currency ?? "IQD",
    condition: settings?.condition ?? "new",
    defaultFbProductCategory: settings?.defaultFbProductCategory ?? DEFAULT_FB_PRODUCT_CATEGORY,
    defaultGoogleProductCategory: settings?.defaultGoogleProductCategory ?? null,
    defaultGender: settings?.defaultGender ?? "female",
    defaultAgeGroup: settings?.defaultAgeGroup ?? "adult",
    productLinkBaseUrl: settings?.productLinkBaseUrl ?? null,
    defaultProductType: settings?.defaultProductType ?? null,
    defaultAvailability: settings?.defaultAvailability ?? "in stock",
    mediaPolicy: settings?.mediaPolicy ?? "catalog_high_quality",
    updatedAt: settings?.updatedAt ?? null,
  };
}

export async function saveMetaCatalogEnrichmentSettings(input: MetaCatalogEnrichmentInput & { storeId: number; actorUserId: number }) {
  const db = await requireDb();
  const current = await getMetaCatalogEnrichmentSettings(input.storeId);
  const values = {
    storeId: input.storeId,
    brand: normalizeOptional(input.brand ?? current.brand, 100),
    currency: normalizedCurrency(input.currency ?? current.currency),
    condition: input.condition ?? current.condition,
    defaultFbProductCategory: normalizeOptional(input.defaultFbProductCategory ?? current.defaultFbProductCategory, 500),
    defaultGoogleProductCategory: normalizeOptional(input.defaultGoogleProductCategory ?? current.defaultGoogleProductCategory, 250),
    defaultGender: input.defaultGender ?? current.defaultGender,
    defaultAgeGroup: input.defaultAgeGroup ?? current.defaultAgeGroup,
    productLinkBaseUrl: normalizeCatalogBaseUrl(input.productLinkBaseUrl ?? current.productLinkBaseUrl),
    defaultProductType: normalizeOptional(input.defaultProductType ?? current.defaultProductType, 750),
    defaultAvailability: input.defaultAvailability ?? current.defaultAvailability,
    mediaPolicy: input.mediaPolicy ?? current.mediaPolicy,
    updatedByUserId: input.actorUserId,
  };
  await db.insert(metaCatalogEnrichmentSettings).values({ ...values, createdByUserId: input.actorUserId }).onDuplicateKeyUpdate({ set: values });
  return getMetaCatalogEnrichmentSettings(input.storeId);
}

export async function getMetaCatalogProductEnrichment(input: { storeId: number; productId: number }) {
  const db = await requireDb();
  const [product] = await db.select({ id: products.id, productCode: products.productCode, category: products.category }).from(products).where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId))).limit(1);
  if (!product) throw new Error("المنتج غير موجود في متجرك التشغيلي.");
  const [enrichment] = await db.select().from(metaCatalogProductEnrichments).where(and(eq(metaCatalogProductEnrichments.storeId, input.storeId), eq(metaCatalogProductEnrichments.productId, input.productId))).limit(1);
  const settings = await getMetaCatalogEnrichmentSettings(input.storeId);
  return {
    productId: input.productId,
    productCode: product.productCode,
    fbProductCategory: enrichment?.fbProductCategory ?? null,
    googleProductCategory: enrichment?.googleProductCategory ?? null,
    material: enrichment?.material ?? null,
    pattern: enrichment?.pattern ?? null,
    gender: enrichment?.gender ?? null,
    ageGroup: enrichment?.ageGroup ?? null,
    productType: enrichment?.productType ?? product.category ?? settings.defaultProductType ?? null,
    productLink: enrichment?.productLink ?? null,
    exportEnabled: enrichment?.exportEnabled ?? true,
    effective: {
      fbProductCategory: enrichment?.fbProductCategory ?? settings.defaultFbProductCategory,
      googleProductCategory: enrichment?.googleProductCategory ?? settings.defaultGoogleProductCategory,
      gender: enrichment?.gender ?? settings.defaultGender,
      ageGroup: enrichment?.ageGroup ?? settings.defaultAgeGroup,
      productType: enrichment?.productType ?? product.category ?? settings.defaultProductType,
      productLink: enrichment?.productLink ?? buildStorefrontProductUrl(settings.productLinkBaseUrl, product.productCode),
      brand: settings.brand,
      currency: settings.currency,
      condition: settings.condition,
      mediaPolicy: settings.mediaPolicy,
    },
  };
}

export async function saveMetaCatalogProductEnrichment(input: MetaCatalogProductEnrichmentInput & { storeId: number; productId: number; actorUserId: number }) {
  const db = await requireDb();
  await getMetaCatalogProductEnrichment({ storeId: input.storeId, productId: input.productId });
  const values = {
    storeId: input.storeId,
    productId: input.productId,
    fbProductCategory: normalizeOptional(input.fbProductCategory, 500),
    googleProductCategory: normalizeOptional(input.googleProductCategory, 250),
    material: normalizeOptional(input.material, 200),
    pattern: normalizeOptional(input.pattern, 100),
    gender: input.gender ?? null,
    ageGroup: input.ageGroup ?? null,
    productType: normalizeOptional(input.productType, 750),
    productLink: normalizeCatalogProductUrl(input.productLink),
    exportEnabled: input.exportEnabled ?? true,
    updatedByUserId: input.actorUserId,
  };
  await db.insert(metaCatalogProductEnrichments).values(values).onDuplicateKeyUpdate({ set: values });
  return getMetaCatalogProductEnrichment({ storeId: input.storeId, productId: input.productId });
}

export function buildStorefrontProductUrl(baseUrl: string | null | undefined, productCode: string) {
  const base = normalizeCatalogBaseUrl(baseUrl);
  return base ? `${base}/store/${encodeURIComponent(productCode)}` : null;
}
