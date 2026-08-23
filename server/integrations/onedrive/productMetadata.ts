export type CatalogProductMetadata = {
  name: string;
  sellingPrice: string;
  description: string;
  sizes: string[];
  status: "draft";
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
