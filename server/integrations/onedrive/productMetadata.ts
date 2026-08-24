export type CatalogProductMetadata = {
  name: string;
  sellingPrice: string;
  description: string;
  sizes: string[];
  status: "draft";
};

export type LenientCatalogProductMetadata = {
  name: string | null;
  sellingPrice: string | null;
  description: string | null;
  sizes: string[];
  problems: string[];
};

const knownKeys = new Set(["PRODUCT_NAME_AR", "SELLING_PRICE_IQD", "DESCRIPTION_AR", "SIZES", "PREVIOUS_PRICE_IQD", "PRODUCT_STATUS"]);

export function parseCatalogProductMetadata(content: string): CatalogProductMetadata {
  const values = new Map<string, string>();
  for (const sourceLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (knownKeys.has(key)) values.set(key, line.slice(separator + 1).trim());
  }

  const requireValue = (key: "PRODUCT_NAME_AR" | "SELLING_PRICE_IQD" | "DESCRIPTION_AR") => {
    const value = values.get(key)?.trim() ?? "";
    if (!value) throw new Error(`حقل ${key} مطلوب في product.txt.`);
    if (value.startsWith("...")) throw new Error(`لا يجوز أن تبدأ قيمة ${key} ببقايا المثال (...).`);
    return value;
  };

  if (!values.has("SIZES")) throw new Error("حقل SIZES مطلوب دائمًا في product.txt حتى عندما تكون قيمته فارغة.");
  const name = requireValue("PRODUCT_NAME_AR");
  const sellingPrice = requireValue("SELLING_PRICE_IQD");
  const description = requireValue("DESCRIPTION_AR");
  if (!/^\d+(\.\d{1,2})?$/.test(sellingPrice)) throw new Error("SELLING_PRICE_IQD يجب أن يكون رقمًا فقط.");
  const status = values.get("PRODUCT_STATUS")?.trim() ?? "";
  if (status !== "draft") throw new Error("PRODUCT_STATUS يجب أن يساوي draft في مسودة Catalog.");

  const sizes = (values.get("SIZES") ?? "")
    .split(",")
    .map(size => size.trim())
    .filter(Boolean);
  return { name, sellingPrice, description, sizes, status: "draft" };
}

/**
 * Extracts every usable field but never rejects the folder, so a staff member
 * can complete the resulting platform draft.
 */
export function parseCatalogProductMetadataLenient(content: string | null): LenientCatalogProductMetadata {
  if (content === null) return { name: null, sellingPrice: null, description: null, sizes: [], problems: ["product.txt"] };
  const values = new Map<string, string>();
  for (const sourceLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = sourceLine.trim();
    const separator = line.indexOf(":");
    if (!line || line.startsWith("#") || separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (knownKeys.has(key)) values.set(key, line.slice(separator + 1).trim());
  }
  const problems: string[] = [];
  const validText = (key: "PRODUCT_NAME_AR" | "DESCRIPTION_AR") => {
    const value = values.get(key)?.trim() || "";
    if (!value || value.startsWith("...")) {
      problems.push(key === "PRODUCT_NAME_AR" ? "name" : "description");
      return null;
    }
    return value;
  };
  const rawPrice = values.get("SELLING_PRICE_IQD")?.trim() || "";
  const sellingPrice = /^\d+(\.\d{1,2})?$/.test(rawPrice) ? rawPrice : null;
  if (!sellingPrice) problems.push("sellingPrice");
  if (!values.has("SIZES")) problems.push("sizes");
  const sizes = (values.get("SIZES") ?? "").split(",").map(size => size.trim()).filter(Boolean);
  return { name: validText("PRODUCT_NAME_AR"), sellingPrice, description: validText("DESCRIPTION_AR"), sizes, problems };
}

export function normalizeApprovedColorNames(colorNames: string[]): string[] {
  const normalized = colorNames.map(color => color.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error("اختر لونًا واحدًا معتمدًا على الأقل.");
  if (normalized.some(color => color.startsWith("..."))) throw new Error("لا يجوز أن يبدأ اسم اللون ببقايا المثال (...).");
  const unique = new Map<string, string>();
  for (const color of normalized) unique.set(color.toLocaleLowerCase("ar"), color);
  return Array.from(unique.values());
}

export function validateApprovedImageColorLinks(input: {
  approvedColorNames: string[];
  availableImageFileNames: string[];
  links: Array<{ colorName: string; imageFileName: string }>;
}) {
  const approvedColors = new Set(normalizeApprovedColorNames(input.approvedColorNames).map(color => color.toLocaleLowerCase("ar")));
  const availableImages = new Set(input.availableImageFileNames);
  const linkedColors = new Set<string>();
  const linkedImages = new Set<string>();
  for (const link of input.links) {
    const colorKey = link.colorName.trim().toLocaleLowerCase("ar");
    if (!approvedColors.has(colorKey)) throw new Error(`اللون ${link.colorName} ليس متغيرًا معتمدًا للمنتج.`);
    if (!availableImages.has(link.imageFileName)) throw new Error(`الصورة ${link.imageFileName} ليست ضمن مجلد المنتج.`);
    if (linkedColors.has(colorKey)) throw new Error(`تم تكرار ربط اللون ${link.colorName}.`);
    if (linkedImages.has(link.imageFileName)) throw new Error(`تم تكرار ربط الصورة ${link.imageFileName}.`);
    linkedColors.add(colorKey);
    linkedImages.add(link.imageFileName);
  }
  return input.links.map(link => ({ colorName: link.colorName.trim(), imageFileName: link.imageFileName }));
}
