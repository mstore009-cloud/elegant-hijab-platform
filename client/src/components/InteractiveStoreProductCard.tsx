import { useState } from "react";
import { Eye, Heart, LoaderCircle, ShoppingBag, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Product = { productCode: string; name: string; sellingPrice: string; primaryImageUrl?: string | null; defaultColorName?: string | null; sizeLabels?: string | string[] | null };
const parseSizeLabels = (value: unknown) => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
};

export function InteractiveStoreProductCard({ product, onOpen, onAdd, isFavorite, onToggleFavorite }: { product: Product; onOpen: () => void; onAdd: (color: string, imageUrl: string | null, sizeLabel?: string | null) => void; isFavorite?: boolean; onToggleFavorite?: () => void }) {
  const [quickView, setQuickView] = useState(false);
  const [localFavorite, setLocalFavorite] = useState(() => { try { const stored = JSON.parse(window.localStorage.getItem("elegant_hijab_favorite_products") ?? "[]"); return Array.isArray(stored) && stored.includes(product.productCode); } catch { return false; } });
  const detail = trpc.products.publicByCode.useQuery({ productCode: product.productCode }, { enabled: quickView });
  const data: any = detail.data;
  const colors: string[] = data?.colors ?? [];
  const sizes: string[] = parseSizeLabels(data?.product?.sizeLabels);
  const productHasSizes = parseSizeLabels(product.sizeLabels).length > 0;
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const selected = color ?? colors[0] ?? product.defaultColorName ?? null;
  const selectedSize = size ?? sizes[0] ?? null;
  const imageFor = (value: string | null) => data?.media?.find((media: any) => media.mediaType === "image" && media.colorName === value)?.url ?? product.primaryImageUrl ?? null;
  const formatPrice = (value: string) => `${Number(value).toLocaleString("ar-IQ")} د.ع`;
  const favorite = isFavorite ?? localFavorite; const toggle = onToggleFavorite ?? (() => setLocalFavorite(current => { const next = !current; try { const stored = JSON.parse(window.localStorage.getItem("elegant_hijab_favorite_products") ?? "[]"); const codes = Array.isArray(stored) ? stored.filter((code): code is string => typeof code === "string") : []; window.localStorage.setItem("elegant_hijab_favorite_products", JSON.stringify(next ? [product.productCode, ...codes.filter(code => code !== product.productCode)] : codes.filter(code => code !== product.productCode))); } catch {} return next; }));

  return <>
    <article className="group overflow-hidden rounded-2xl border border-[#e6dfd2] bg-white text-right transition duration-200 hover:-translate-y-1 hover:shadow-lg">
      <div className="relative"><button onClick={onOpen} className="block w-full">{product.primaryImageUrl ? <img src={product.primaryImageUrl} alt={product.name} loading="lazy" decoding="async" className="aspect-square w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <div className="aspect-square bg-[#ece8dd]" role="img" aria-label={`لا توجد صورة للمنتج ${product.name}`} />}<div className="p-2.5"><p className="truncate text-sm font-black leading-5 text-[#173f38]">{product.name}</p><p className="mt-1 text-sm font-black text-[#285f4e]">{formatPrice(product.sellingPrice)}</p></div></button><button onClick={toggle} aria-label={favorite ? "إزالة من المفضلة" : "حفظ في المفضلة"} className={`absolute left-2 top-2 rounded-full p-2 shadow-sm ${favorite ? "bg-[#a14724] text-white" : "bg-white/90 text-[#173f38]"}`}><Heart className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} /></button></div>
      <div className="flex gap-1.5 px-2.5 pb-2.5"><button onClick={() => setQuickView(true)} className="flex-1 rounded-lg border border-[#d9d0c1] px-2 py-1.5 text-xs font-bold"><Eye className="ml-0.5 inline h-3.5 w-3.5" />عرض</button><button onClick={() => productHasSizes ? setQuickView(true) : selected && onAdd(selected, imageFor(selected), null)} disabled={!selected} className="flex-1 rounded-lg bg-[#173f38] px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"><ShoppingBag className="ml-0.5 inline h-3.5 w-3.5" />{productHasSizes ? "اختيار" : "إضافة"}</button></div>
    </article>
    {quickView && <div className="fixed inset-0 z-[70] bg-[#173f38]/45 p-4"><section dir="rtl" className="mx-auto mt-[8vh] max-w-lg rounded-3xl bg-[#faf8f2] p-5 shadow-2xl"><div className="flex items-center justify-between"><b className="text-xl">{product.name}</b><div className="flex items-center gap-2">{onToggleFavorite && <button onClick={onToggleFavorite} aria-label={isFavorite ? "إزالة من المفضلة" : "حفظ في المفضلة"} className={`rounded-full p-2 ${isFavorite ? "bg-[#a14724] text-white" : "bg-white text-[#173f38]"}`}><Heart className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} /></button>}<button onClick={() => setQuickView(false)} aria-label="إغلاق المعاينة"><X /></button></div></div>{detail.isLoading ? <div className="flex justify-center py-16"><LoaderCircle className="animate-spin" /></div> : <><div className="mt-4 overflow-hidden rounded-2xl bg-white">{imageFor(selected) ? <img src={imageFor(selected)!} alt={product.name} className="aspect-[4/5] w-full object-cover" /> : <div className="aspect-[4/5] bg-[#ece8dd]" />}</div><p className="mt-4 font-black text-[#285f4e]">{formatPrice(product.sellingPrice)}</p><p className="mt-4 text-sm font-black">اختاري اللون</p><div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4">{colors.map(value => <button key={value} onClick={() => setColor(value)} className={`overflow-hidden rounded-xl border text-right transition hover:-translate-y-0.5 ${selected === value ? "border-[#173f38] ring-2 ring-[#173f38]" : "border-[#d9d0c1] bg-white"}`}>{imageFor(value) ? <img src={imageFor(value)!} alt={`لون ${value}`} className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-[#ece8dd]" role="img" aria-label={`لا توجد صورة للون ${value}`} />}<span className={`block px-2 py-2 text-center text-xs font-black ${selected === value ? "bg-[#173f38] text-white" : "text-[#173f38]"}`}>{value}</span></button>)}</div>{sizes.length > 0 && <><p className="mt-4 text-sm font-black">اختاري القياس</p><div className="mt-2 flex flex-wrap gap-2">{sizes.map(item => <button key={item} type="button" onClick={() => setSize(item)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${selectedSize === item ? "border-[#173f38] bg-[#173f38] text-white" : "border-[#d9d0c1] bg-white text-[#173f38]"}`}>{item}</button>)}</div></>}<button onClick={() => { if (selected) { onAdd(selected, imageFor(selected), sizes.length > 0 ? selectedSize : null); setQuickView(false); } }} disabled={!selected || (sizes.length > 0 && !selectedSize)} className="mt-5 w-full rounded-xl bg-[#173f38] py-3 font-bold text-white disabled:opacity-50">أضف {selected ? `لون ${selected}${sizes.length > 0 && selectedSize ? ` (قياس ${selectedSize})` : ""}` : "إلى السلة"}</button></>}</section></div>}
  </>;
}
