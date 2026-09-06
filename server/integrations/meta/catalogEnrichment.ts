import { and, eq } from "drizzle-orm";
import { catalogFolderImports, metaCatalogEnrichmentSettings, metaCatalogGroupEnrichments, metaCatalogProductEnrichments, products, stores } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { describeMetaProductTaxonomy, normalizeMetaFbProductCategory } from "./catalogTaxonomy";

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

export type MetaCatalogGroupEnrichmentInput = {
  groupPath: string;
  fbProductCategory?: string | null;
  pattern?: string | null;
  gender?: (typeof META_CATALOG_GENDERS)[number] | null;
  ageGroup?: (typeof META_CATALOG_AGE_GROUPS)[number] | null;
  productLink?: string | null;
};

function normalizeOptional(value: string | null | undefined, max: number) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, max) : null;
}

function normalizeGroupPath(value: string) {
  const path = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("اختر مجموعة منتجات من شجرة OneDrive أولاً.");
  return path.slice(0, 1000);
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
  if (currency !== "IQD" && currency !== "USD") throw new Error("اختر IQD أو USD لعملة Meta Catalog.");
  return currency;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

function categoryDisplay(value: string | null | undefined) {
  return describeMetaProductTaxonomy(value);
}

export function selectMostSpecificMetaGroupRule<T extends { groupPath: string }>(groupPath: string | null | undefined, rules: T[]) {
  const actualPath = groupPath?.trim() ?? "";
  return rules
    .filter(rule => actualPath === rule.groupPath || actualPath.startsWith(`${rule.groupPath}/`))
    .sort((left, right) => right.groupPath.length - left.groupPath.length)[0] ?? null;
}

export async function getMetaCatalogEnrichmentSettings(storeId: number) {
  const db = await requireDb();
  const [[settings], [store]] = await Promise.all([
    db.select().from(metaCatalogEnrichmentSettings).where(eq(metaCatalogEnrichmentSettings.storeId, storeId)).limit(1),
    db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId)).limit(1),
  ]);
  const defaultFbProductCategory = settings?.defaultFbProductCategory ?? null;
  return {
    id: settings?.id ?? null,
    storeId,
    brand: settings?.brand ?? store?.name ?? "",
    currency: settings?.currency ?? "IQD",
    condition: settings?.condition ?? "new",
    defaultFbProductCategory,
    defaultFbProductCategoryDetails: categoryDisplay(defaultFbProductCategory),
    defaultGoogleProductCategory: settings?.defaultGoogleProductCategory ?? null,
    defaultGender: settings?.defaultGender ?? "female",
    defaultAgeGroup: settings?.defaultAgeGroup ?? "adult",
    productLinkBaseUrl: settings?.productLinkBaseUrl ?? null,
    defaultProductType: null,
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
    defaultFbProductCategory: normalizeMetaFbProductCategory(input.defaultFbProductCategory ?? current.defaultFbProductCategory),
    defaultGoogleProductCategory: normalizeOptional(input.defaultGoogleProductCategory ?? current.defaultGoogleProductCategory, 250),
    defaultGender: input.defaultGender ?? current.defaultGender,
    defaultAgeGroup: input.defaultAgeGroup ?? current.defaultAgeGroup,
    productLinkBaseUrl: normalizeCatalogBaseUrl(input.productLinkBaseUrl ?? current.productLinkBaseUrl),
    defaultProductType: null,
    defaultAvailability: input.defaultAvailability ?? current.defaultAvailability,
    mediaPolicy: input.mediaPolicy ?? current.mediaPolicy,
    updatedByUserId: input.actorUserId,
  };
  await db.insert(metaCatalogEnrichmentSettings).values({ ...values, createdByUserId: input.actorUserId }).onDuplicateKeyUpdate({ set: values });
  return getMetaCatalogEnrichmentSettings(input.storeId);
}

export async function listMetaCatalogGroupPaths(storeId: number) {
  const db = await requireDb();
  const rows = await db.select({ groupName: catalogFolderImports.groupName }).from(catalogFolderImports).where(eq(catalogFolderImports.storeId, storeId));
  return Array.from(new Set(rows.map(row => row.groupName.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar"));
}

export async function listMetaCatalogGroupEnrichments(storeId: number) {
  const db = await requireDb();
  const rules = await db.select().from(metaCatalogGroupEnrichments).where(eq(metaCatalogGroupEnrichments.storeId, storeId));
  return rules.sort((a, b) => a.groupPath.localeCompare(b.groupPath, "ar")).map(rule => ({ ...rule, fbProductCategoryDetails: categoryDisplay(rule.fbProductCategory) }));
}

export async function saveMetaCatalogGroupEnrichment(input: MetaCatalogGroupEnrichmentInput & { storeId: number; actorUserId: number }) {
  const db = await requireDb();
  const groupPath = normalizeGroupPath(input.groupPath);
  const knownPaths = await listMetaCatalogGroupPaths(input.storeId);
  if (!knownPaths.includes(groupPath)) throw new Error("مجموعة المنتجات المحددة غير موجودة ضمن شجرة OneDrive المحفوظة لهذا المتجر.");
  const values = {
    storeId: input.storeId,
    groupPath,
    fbProductCategory: normalizeMetaFbProductCategory(input.fbProductCategory),
    pattern: normalizeOptional(input.pattern, 100),
    gender: input.gender ?? null,
    ageGroup: input.ageGroup ?? null,
    productLink: normalizeCatalogProductUrl(input.productLink),
    updatedByUserId: input.actorUserId,
  };
  await db.insert(metaCatalogGroupEnrichments).values(values).onDuplicateKeyUpdate({ set: values });
  const all = await listMetaCatalogGroupEnrichments(input.storeId);
  return all.find(rule => rule.groupPath === groupPath) ?? null;
}

export async function deleteMetaCatalogGroupEnrichment(input: { storeId: number; groupPath: string }) {
  const db = await requireDb();
  const groupPath = normalizeGroupPath(input.groupPath);
  await db.delete(metaCatalogGroupEnrichments).where(and(eq(metaCatalogGroupEnrichments.storeId, input.storeId), eq(metaCatalogGroupEnrichments.groupPath, groupPath)));
  return { groupPath };
}

export async function getMetaCatalogProductEnrichment(input: { storeId: number; productId: number }) {
  const db = await requireDb();
  const [product] = await db.select({ id: products.id, productCode: products.productCode, category: products.category, material: products.material }).from(products).where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId))).limit(1);
  if (!product) throw new Error("المنتج غير موجود في متجرك التشغيلي.");
  const [[enrichment], [folder], settings, groupRules] = await Promise.all([
    db.select().from(metaCatalogProductEnrichments).where(and(eq(metaCatalogProductEnrichments.storeId, input.storeId), eq(metaCatalogProductEnrichments.productId, input.productId))).limit(1),
    db.select({ groupName: catalogFolderImports.groupName }).from(catalogFolderImports).where(and(eq(catalogFolderImports.storeId, input.storeId), eq(catalogFolderImports.linkedProductId, input.productId))).limit(1),
    getMetaCatalogEnrichmentSettings(input.storeId),
    listMetaCatalogGroupEnrichments(input.storeId),
  ]);
  const inferredProductType = folder?.groupName?.trim() || product.category?.trim() || null;
  const groupRule = selectMostSpecificMetaGroupRule(inferredProductType, groupRules);
  const effectiveFbProductCategory = enrichment?.fbProductCategory ?? groupRule?.fbProductCategory ?? settings.defaultFbProductCategory;
  const effectiveMaterial = enrichment?.material ?? product.material ?? null;
  return {
    productId: input.productId,
    productCode: product.productCode,
    groupPath: inferredProductType,
    matchedGroupRule: groupRule ? { groupPath: groupRule.groupPath, id: groupRule.id } : null,
    fbProductCategory: enrichment?.fbProductCategory ?? null,
    googleProductCategory: enrichment?.googleProductCategory ?? null,
    material: enrichment?.material ?? null,
    sourceMaterial: product.material ?? null,
    pattern: enrichment?.pattern ?? null,
    gender: enrichment?.gender ?? null,
    ageGroup: enrichment?.ageGroup ?? null,
    productType: inferredProductType,
    productLink: enrichment?.productLink ?? null,
    exportEnabled: enrichment?.exportEnabled ?? true,
    effective: {
      fbProductCategory: effectiveFbProductCategory,
      fbProductCategoryDetails: categoryDisplay(effectiveFbProductCategory),
      googleProductCategory: enrichment?.googleProductCategory ?? settings.defaultGoogleProductCategory,
      material: effectiveMaterial,
      materialSource: enrichment?.material ? "product_override" as const : product.material ? "onedrive_metadata" as const : "missing" as const,
      pattern: enrichment?.pattern ?? groupRule?.pattern ?? null,
      gender: enrichment?.gender ?? groupRule?.gender ?? settings.defaultGender,
      ageGroup: enrichment?.ageGroup ?? groupRule?.ageGroup ?? settings.defaultAgeGroup,
      productType: inferredProductType,
      productLink: enrichment?.productLink ?? groupRule?.productLink ?? buildStorefrontProductUrl(settings.productLinkBaseUrl, product.productCode),
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
    fbProductCategory: normalizeMetaFbProductCategory(input.fbProductCategory),
    googleProductCategory: normalizeOptional(input.googleProductCategory, 250),
    material: normalizeOptional(input.material, 200),
    pattern: normalizeOptional(input.pattern, 100),
    gender: input.gender ?? null,
    ageGroup: input.ageGroup ?? null,
    productType: null,
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
