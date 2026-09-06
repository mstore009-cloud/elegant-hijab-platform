import { META_PRODUCT_TAXONOMY, type MetaProductTaxonomyEntry } from "./fbProductTaxonomy.generated";

export type MetaCatalogFieldDescriptor = {
  key: "color" | "material" | "size" | "gender" | "age_group" | "pattern";
  label: string;
  source: string;
  required: boolean;
};

const ARABIC_SEARCH_HINTS: Array<{ token: string; aliases: string[] }> = [
  { token: "clothing & accessories", aliases: ["ملابس", "اكسسوارات", "إكسسوارات"] },
  { token: "scarves & wraps", aliases: ["وشاح", "أوشحة", "لفات", "شال", "حجاب"] },
  { token: "women's clothing", aliases: ["نساء", "نسائي", "نسائية"] },
  { token: "girls' clothing", aliases: ["بنات", "فتيات"] },
  { token: "jewelry & watches", aliases: ["مجوهرات", "ساعات"] },
  { token: "handbags & wallets", aliases: ["حقائب", "محافظ"] },
];

const APPAREL_FIELDS: MetaCatalogFieldDescriptor[] = [
  { key: "color", label: "اللون", source: "اسم متغير اللون المعتمد", required: false },
  { key: "material", label: "الخامة", source: "MATERIAL أو الخامة في product.txt / product.docx", required: false },
  { key: "size", label: "القياس", source: "متغير المنتج عند وجود قياس", required: false },
  { key: "gender", label: "الجنس", source: "إعداد المتجر أو قاعدة المجموعة أو المنتج", required: false },
  { key: "age_group", label: "الفئة العمرية", source: "إعداد المتجر أو قاعدة المجموعة أو المنتج", required: false },
  { key: "pattern", label: "النقشة", source: "قاعدة المجموعة أو استثناء المنتج", required: false },
];

const ACCESSORY_FIELDS: MetaCatalogFieldDescriptor[] = [
  { key: "color", label: "اللون", source: "اسم متغير اللون المعتمد", required: false },
  { key: "material", label: "الخامة", source: "MATERIAL أو الخامة في product.txt / product.docx", required: false },
  { key: "gender", label: "الجنس", source: "إعداد المتجر أو قاعدة المجموعة أو المنتج", required: false },
  { key: "age_group", label: "الفئة العمرية", source: "إعداد المتجر أو قاعدة المجموعة أو المنتج", required: false },
  { key: "pattern", label: "النقشة", source: "قاعدة المجموعة أو استثناء المنتج", required: false },
];

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function aliasesFor(entry: MetaProductTaxonomyEntry) {
  const path = normalized(entry.path);
  return ARABIC_SEARCH_HINTS.filter(hint => path.includes(hint.token)).flatMap(hint => hint.aliases);
}

export function getMetaCatalogFieldDescriptors(categoryValue: string | null | undefined): MetaCatalogFieldDescriptor[] {
  const entry = getMetaProductTaxonomyEntry(categoryValue);
  if (!entry) return [];
  const path = normalized(entry.path);
  if (!path.startsWith("clothing & accessories")) return [];
  return path.includes("clothing accessories") ? ACCESSORY_FIELDS : APPAREL_FIELDS;
}

export function getMetaProductTaxonomyEntry(categoryValue: string | null | undefined) {
  const value = categoryValue?.trim();
  if (!value) return null;
  const byId = META_PRODUCT_TAXONOMY.find(entry => String(entry.id) === value);
  if (byId) return byId;
  const valueKey = normalized(value);
  return META_PRODUCT_TAXONOMY.find(entry => normalized(entry.path) === valueKey) ?? null;
}

/** Store Meta's canonical numeric category id; Meta documents support ids and paths. */
export function normalizeMetaFbProductCategory(categoryValue: string | null | undefined) {
  if (categoryValue == null || !categoryValue.trim()) return null;
  const entry = getMetaProductTaxonomyEntry(categoryValue);
  if (!entry) throw new Error("فئة Meta المختارة غير موجودة في Facebook Product Taxonomy الرسمية.");
  return String(entry.id);
}

export function searchMetaProductTaxonomy(input: { query?: string | null; limit?: number }) {
  const query = normalized(input.query ?? "");
  const queryTokens = query.split(" ").filter(Boolean);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const matches = META_PRODUCT_TAXONOMY.filter(entry => {
    if (!queryTokens.length) return true;
    const haystack = `${normalized(entry.path)} ${aliasesFor(entry).join(" ")}`;
    return queryTokens.every(token => haystack.includes(token));
  }).sort((left, right) => {
    const leftAliasScore = aliasesFor(left).some(alias => queryTokens.includes(normalized(alias))) ? 0 : 1;
    const rightAliasScore = aliasesFor(right).some(alias => queryTokens.includes(normalized(alias))) ? 0 : 1;
    return leftAliasScore - rightAliasScore || left.path.length - right.path.length || left.path.localeCompare(right.path);
  }).slice(0, limit);
  return matches.map(entry => ({
    id: String(entry.id),
    path: entry.path,
    aliases: aliasesFor(entry),
    fields: getMetaCatalogFieldDescriptors(String(entry.id)),
  }));
}

export function describeMetaProductTaxonomy(categoryValue: string | null | undefined) {
  const entry = getMetaProductTaxonomyEntry(categoryValue);
  return entry ? { id: String(entry.id), path: entry.path, fields: getMetaCatalogFieldDescriptors(String(entry.id)) } : null;
}
