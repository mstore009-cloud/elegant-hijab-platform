/** يوحّد الكتابة العربية واللاتينية كي يعمل بحث المنتجات مع اختلاف الهمزات والتشكيل وحالة الأحرف. */
export function normalizeProductSearch(value: string | null | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("ar")
    .normalize("NFD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesProductSearch(query: string, searchableValues: Array<string | null | undefined>) {
  const terms = normalizeProductSearch(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const searchableText = searchableValues.map(normalizeProductSearch).join(" ");
  return terms.every(term => searchableText.includes(term));
}
