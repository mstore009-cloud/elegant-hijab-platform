import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProductListThumbnail } from "@/components/ProductListThumbnail";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Check, CheckCircle2, ChevronDown, CircleAlert, CloudCog, ImagePlus, Layers3, PackagePlus, Palette, RefreshCw, Save, Search, Sparkles, TriangleAlert, Warehouse, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

const missingFieldLabels: Record<string, string> = {
  "product.txt": "ملف البيانات",
  name: "اسم المنتج",
  description: "الوصف",
  sellingPrice: "السعر",
  sizes: "القياسات",
  images: "الصور",
  colors: "الألوان",
  inventory: "المخزون",
};

type WorkFilter = "needs_work" | "draft" | "ready" | "active" | "all";
type EditableColorSuggestion = { colorNameArabic: string; confidence: number; mediaIds: number[]; reviewNote: string; selectedMediaIds: number[] };

function fieldLabel(field: string) { return missingFieldLabels[field] ?? field; }
function safeSizes(raw: string | null) {
  try { const parsed = JSON.parse(raw ?? "[]"); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { return []; }
}
function statusLabel(status: string) { return ({ draft: "مسودة", needs_review: "تحتاج مراجعة", ready: "جاهز للمراجعة", active: "نشط", archived: "مؤرشف" } as Record<string, string>)[status] ?? status; }
function statusClass(status: string) { return ({ draft: "bg-[#f1eee7] text-[#635d53]", needs_review: "bg-[#fff1de] text-[#a35d1c]", ready: "bg-[#e9f4ef] text-[#21624d]", active: "bg-[#e4f3ea] text-[#17633b]", archived: "bg-[#f0f0f0] text-[#747474]" } as Record<string, string>)[status] ?? "bg-slate-100 text-slate-700"; }

export default function Products() {
  const profile = trpc.access.myProfile.useQuery();
  const products = trpc.products.list.useQuery(undefined, { enabled: profile.isSuccess });
  const syncStatus = trpc.catalogSync.status.useQuery(undefined, { enabled: profile.isSuccess });
  const canEdit = profile.data?.permissions.includes("products.edit") ?? false;
  const canCreate = profile.data?.permissions.includes("products.create") ?? false;
  const canInventory = profile.data?.permissions.includes("products.inventory.update") ?? false;
  const utils = trpc.useUtils();

  const [filter, setFilter] = useState<WorkFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const detailInput = useMemo(() => selectedProductId ? { productId: selectedProductId } : skipToken, [selectedProductId]);
  const selectedProduct = trpc.products.byId.useQuery(detailInput, { enabled: detailInput !== skipToken && profile.isSuccess });
  const selectedProductMedia = trpc.products.mediaPreviews.useQuery(detailInput, { enabled: detailInput !== skipToken && profile.isSuccess, staleTime: 5 * 60_000 });

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [draftSizes, setDraftSizes] = useState("");
  const [newColorName, setNewColorName] = useState("");
  const [inventoryValues, setInventoryValues] = useState<Record<number, string>>({});
  const [suggestions, setSuggestions] = useState<EditableColorSuggestion[]>([]);
  const [analysisNote, setAnalysisNote] = useState("");

  const invalidateProducts = async () => {
    await Promise.all([utils.products.list.invalidate(), utils.products.byId.invalidate(), utils.products.mediaPreviews.invalidate(), syncStatus.refetch()]);
  };
  const updateDetails = trpc.products.updateDetails.useMutation({ onSuccess: invalidateProducts });
  const uploadImage = trpc.products.uploadManualImage.useMutation({ onSuccess: invalidateProducts });
  const addColor = trpc.products.addColor.useMutation({ onSuccess: invalidateProducts });
  const assignMediaColor = trpc.products.assignMediaColor.useMutation({ onSuccess: invalidateProducts });
  const saveInventory = trpc.products.saveInventory.useMutation({ onSuccess: invalidateProducts });
  const analyzeColors = trpc.products.analyzeColors.useMutation();
  const runCatalogScan = trpc.catalogSync.runNow.useMutation({ onSuccess: invalidateProducts });

  useEffect(() => {
    const detail = selectedProduct.data;
    if (!detail) return;
    setDraftName(detail.product.name);
    setDraftDescription(detail.product.description ?? "");
    setDraftPrice(detail.missingFields.includes("sellingPrice") ? "" : detail.product.sellingPrice);
    setDraftSizes(safeSizes(detail.product.sizeLabels).join("، "));
    setInventoryValues(Object.fromEntries(detail.variants.map(variant => [variant.id, String(variant.inventoryQuantity)])));
    setSuggestions([]);
    setAnalysisNote("");
    setNewColorName("");
  }, [selectedProduct.data?.product.id]);

  const workCounts = useMemo(() => ({
    needs_work: products.data?.filter(product => product.missingFields.length > 0).length ?? 0,
    draft: products.data?.filter(product => product.status === "draft").length ?? 0,
    ready: products.data?.filter(product => product.status === "ready" || product.status === "needs_review").length ?? 0,
    active: products.data?.filter(product => product.status === "active").length ?? 0,
  }), [products.data]);
  const filteredProducts = useMemo(() => (products.data ?? []).filter(product => {
    const matchesFilter = filter === "all" || (filter === "needs_work" ? product.missingFields.length > 0 : filter === "draft" ? product.status === "draft" : filter === "ready" ? ["ready", "needs_review"].includes(product.status) : product.status === "active");
    const keyword = search.trim().toLocaleLowerCase("ar");
    const matchesSearch = !keyword || [product.name, product.productCode, product.category ?? "", ...product.missingFields.map(fieldLabel)].join(" ").toLocaleLowerCase("ar").includes(keyword);
    return matchesFilter && matchesSearch;
  }), [products.data, filter, search]);

  const saveDetails = () => {
    if (!selectedProductId || !draftName.trim()) return;
    updateDetails.mutate({ productId: selectedProductId, name: draftName.trim(), description: draftDescription.trim() || null, sellingPrice: draftPrice.trim() || undefined, sizeLabels: draftSizes.split(/[،,]/).map(size => size.trim()).filter(Boolean) });
  };
  const addImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !selectedProductId || !/^image\/(jpeg|png|webp)$/.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => { const base64Data = typeof reader.result === "string" ? reader.result.split(",")[1] : ""; if (base64Data) uploadImage.mutate({ productId: selectedProductId, fileName: file.name, mimeType: file.type, base64Data }); };
    reader.readAsDataURL(file);
  };
  const createColor = async (colorName: string, mediaIds: number[] = [], suggestionIndex?: number) => {
    if (!selectedProductId || !colorName.trim()) return;
    try {
      await addColor.mutateAsync({ productId: selectedProductId, colorName: colorName.trim() });
      for (const mediaId of mediaIds) await assignMediaColor.mutateAsync({ productId: selectedProductId, mediaId, colorName: colorName.trim() });
      setSuggestions(current => suggestionIndex === undefined ? current.filter(suggestion => suggestion.colorNameArabic !== colorName) : current.filter((_, index) => index !== suggestionIndex));
      setNewColorName("");
    } catch { /* mutation renders its error below */ }
  };
  const acceptAnalysis = (result: { colorGroups: Array<{ colorNameArabic: string; confidence: number; mediaIds: number[]; reviewNote: string }>; overallReviewNote: string }) => {
    setSuggestions(result.colorGroups.map(group => ({ ...group, selectedMediaIds: [...group.mediaIds] })));
    setAnalysisNote(result.overallReviewNote);
  };
  const runAllColorAnalysis = () => {
    if (!selectedProductId) return;
    analyzeColors.mutate({ productId: selectedProductId }, { onSuccess: acceptAnalysis });
  };
  const toggleSuggestedMedia = (suggestionIndex: number, mediaId: number) => {
    setSuggestions(current => current.map((suggestion, index) => index !== suggestionIndex ? suggestion : {
      ...suggestion,
      selectedMediaIds: suggestion.selectedMediaIds.includes(mediaId) ? suggestion.selectedMediaIds.filter(id => id !== mediaId) : [...suggestion.selectedMediaIds, mediaId],
    }));
  };
  const removeSelectedFromSuggestion = (suggestionIndex: number) => {
    setSuggestions(current => current.flatMap((suggestion, index) => {
      if (index !== suggestionIndex) return [suggestion];
      const remainingMediaIds = suggestion.mediaIds.filter(mediaId => !suggestion.selectedMediaIds.includes(mediaId));
      const remaining = remainingMediaIds.length ? [{ ...suggestion, mediaIds: remainingMediaIds, selectedMediaIds: remainingMediaIds }] : [];
      const uncertain = suggestion.selectedMediaIds.length ? [{ colorNameArabic: "غير مؤكد", confidence: 0, mediaIds: suggestion.selectedMediaIds, selectedMediaIds: suggestion.selectedMediaIds, reviewNote: "صور فُصلت يدويًا من اقتراح آخر. حللها مجددًا أو سمِّها قبل الاعتماد." }] : [];
      return [...remaining, ...uncertain];
    }));
  };
  const reanalyzeSelectedMedia = async (suggestionIndex: number) => {
    if (!selectedProductId) return;
    const suggestion = suggestions[suggestionIndex];
    if (!suggestion?.selectedMediaIds.length) return;
    try {
      const result = await analyzeColors.mutateAsync({ productId: selectedProductId, mediaIds: suggestion.selectedMediaIds });
      setAnalysisNote(result.overallReviewNote);
      setSuggestions(current => current.flatMap((item, index) => {
        if (index !== suggestionIndex) return [item];
        const remainingMediaIds = item.mediaIds.filter(mediaId => !item.selectedMediaIds.includes(mediaId));
        const remaining = remainingMediaIds.length ? [{ ...item, mediaIds: remainingMediaIds, selectedMediaIds: remainingMediaIds }] : [];
        return [...remaining, ...result.colorGroups.map(group => ({ ...group, selectedMediaIds: [...group.mediaIds] }))];
      }));
    } catch { /* تظهر رسالة الخطأ في مساحة التحليل */ }
  };
  const saveAllInventory = () => {
    if (!selectedProduct.data) return;
    const quantities = selectedProduct.data.variants.map(variant => ({ variantId: variant.id, inventoryQuantity: Number(inventoryValues[variant.id] ?? 0) }));
    if (quantities.some(item => !Number.isInteger(item.inventoryQuantity) || item.inventoryQuantity < 0)) return;
    saveInventory.mutate({ productId: selectedProduct.data.product.id, quantities });
  };

  const detail = selectedProduct.data;
  const sizes = safeSizes(detail?.product.sizeLabels ?? null);
  const variantsByColor = useMemo(() => {
    const result = new Map<string, NonNullable<typeof detail>["variants"]>();
    detail?.variants.forEach(variant => result.set(variant.colorName, [...(result.get(variant.colorName) ?? []), variant]));
    return result;
  }, [detail?.variants]);
  const mediaById = new Map((selectedProductMedia.data ?? []).map(media => [media.mediaId, media]));
  const suggestionMediaFor = (mediaIds: number[]) => mediaIds.map(mediaId => mediaById.get(mediaId)).filter((media): media is NonNullable<typeof media> => Boolean(media));

  return (
    <div dir="rtl" className="mx-auto w-full max-w-[1440px] space-y-5 pb-10">
      <header className="flex flex-col gap-4 border-b border-[#e6ded0] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#98713f]">إدارة الكتالوج</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#183d35]">المنتجات</h1>
          <p className="mt-1 text-sm text-[#68756e]">كل المنتجات ظاهرة هنا؛ صفِّها حسب المسودة أو النواقص أو المراجعة. التفعيل غير متاح قبل اعتماد آليته.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#506b61]">
          <span className="rounded-full border border-[#cce0d7] bg-[#f1f8f4] px-3 py-1.5"><CloudCog className="ml-1 inline h-3.5 w-3.5" />Catalog تلقائي · {syncStatus.data?.lastSummary ? "آخر فحص مسجل" : "بانتظار الفحص"}</span>
          <Button size="sm" variant="outline" onClick={() => runCatalogScan.mutate()} disabled={!canCreate || runCatalogScan.isPending} className="border-[#b9d3c6] text-[#245b4d]"><RefreshCw className={`ml-1.5 h-3.5 w-3.5 ${runCatalogScan.isPending ? "animate-spin" : ""}`} />فحص يدوي</Button>
        </div>
      </header>

      {(products.error || runCatalogScan.error) && <div className="flex gap-3 rounded-2xl border border-[#f0d6bc] bg-[#fff7ef] p-4 text-sm text-[#9c4b25]"><AlertCircle className="h-5 w-5 shrink-0" />{products.error?.message ?? runCatalogScan.error?.message}</div>}

      <section className="rounded-3xl border border-[#e6ded0] bg-white p-3 shadow-[0_15px_38px_rgba(43,58,49,0.05)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1 overflow-x-auto rounded-2xl bg-[#f5f2eb] p-1.5">
            {([
              ["needs_work", "يحتاج إكمالًا", workCounts.needs_work], ["draft", "مسودات", workCounts.draft], ["ready", "للمراجعة", workCounts.ready], ["active", "نشط", workCounts.active], ["all", "الكل", products.data?.length ?? 0],
            ] as Array<[WorkFilter, string, number]>).map(([key, label, count]) => <button key={key} onClick={() => setFilter(key)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm transition ${filter === key ? "bg-[#183d35] font-bold text-white shadow-sm" : "text-[#68756e] hover:bg-white"}`}>{label}<span className={`mr-1.5 text-xs ${filter === key ? "text-[#dbeee4]" : "text-[#9a8770]"}`}>{count}</span></button>)}
          </div>
          <div className="relative w-full lg:w-80"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a968f]" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الكود أو النقص" className="h-11 rounded-xl border-[#ded8cd] pr-10" /></div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1.3fr)]">
        <article className="overflow-hidden rounded-3xl border border-[#e6ded0] bg-white shadow-[0_15px_38px_rgba(43,58,49,0.05)]">
          <div className="flex items-center justify-between border-b border-[#eee9df] px-5 py-4"><div><h2 className="font-bold text-[#183d35]">قائمة العمل</h2><p className="mt-0.5 text-xs text-[#7b857f]">{filteredProducts.length} نتيجة في العرض الحالي</p></div><Layers3 className="h-5 w-5 text-[#a78550]" /></div>
          {products.isLoading && <div className="space-y-3 p-5"><div className="h-20 animate-pulse rounded-2xl bg-[#f5f2eb]" /><div className="h-20 animate-pulse rounded-2xl bg-[#f5f2eb]" /></div>}
          {!products.isLoading && filteredProducts.length === 0 && <div className="grid min-h-72 place-items-center p-8 text-center"><CheckCircle2 className="h-9 w-9 text-[#6da58b]" /><div><p className="mt-3 font-bold text-[#314b41]">لا توجد منتجات في هذا العرض</p><p className="mt-1 text-sm text-[#78847e]">جرّب تغيير الحالة أو البحث.</p></div></div>}
          <div className="divide-y divide-[#eee9df]">
            {filteredProducts.map(product => <button key={product.id} onClick={() => setSelectedProductId(product.id)} className={`group w-full px-4 py-4 text-right transition sm:px-5 ${selectedProductId === product.id ? "bg-[#eef7f2]" : "hover:bg-[#fcfbf8]"}`}>
              <div className="flex gap-3"><ProductListThumbnail imageUrl={product.primaryImageUrl} alt={product.primaryImageAlt ?? `صورة ${product.name}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-bold text-[#263f36]">{product.name}</p><p className="mt-0.5 text-xs text-[#7a837d]">{product.productCode}{product.category ? ` · ${product.category}` : ""}</p></div><Badge className={statusClass(product.status)}>{statusLabel(product.status)}</Badge></div><div className="mt-2 flex flex-wrap items-center gap-1.5">{product.missingFields.slice(0, 3).map(field => <span key={field} className="rounded-full bg-[#fff0dc] px-2 py-0.5 text-[11px] font-medium text-[#995f24]">ينقص {fieldLabel(field)}</span>)}{product.missingFields.length > 3 && <span className="text-xs text-[#8a7660]">+{product.missingFields.length - 3}</span>}</div><div className="mt-2 flex items-center justify-between text-xs"><span className="text-[#4e675d]">{product.missingFields.includes("sellingPrice") ? "أضف السعر" : `${product.sellingPrice} د.ع`}</span><span className="font-medium text-[#967342]">{product.missingFields.length ? "إكمال ←" : "مراجعة ←"}</span></div></div></div>
            </button>)}
          </div>
        </article>

        <article className="min-h-[680px] overflow-hidden rounded-3xl border border-[#e6ded0] bg-white shadow-[0_15px_38px_rgba(43,58,49,0.05)]">
          {!selectedProductId && <div className="grid min-h-[680px] place-items-center p-8 text-center"><div><PackagePlus className="mx-auto h-10 w-10 text-[#a78550]" /><h2 className="mt-4 text-xl font-bold text-[#183d35]">اختر منتجًا من قائمة العمل</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#78847e]">ستظهر البيانات والصور والألوان والمخزون في مساحة مراجعة واحدة.</p></div></div>}
          {selectedProduct.isLoading && <div className="p-6 text-sm text-[#526a60]">جارٍ فتح المنتج...</div>}
          {detail && <div className="space-y-0">
            <header className="sticky top-0 z-10 border-b border-[#e9e4da] bg-white/95 px-5 py-4 backdrop-blur sm:px-6"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3">{selectedProductMedia.data?.[0] ? <img src={selectedProductMedia.data[0].dataUrl} alt={`صورة ${detail.product.name}`} className="h-16 w-16 rounded-2xl border border-[#d9e6de] object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#f2eee6] text-[#9a815c]"><ImagePlus className="h-5 w-5" /></div>}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-bold text-[#183d35]">{detail.product.name}</h2><Badge className={statusClass(detail.product.status)}>{statusLabel(detail.product.status)}</Badge></div><p className="mt-1 text-xs text-[#74817a]">{detail.product.productCode}{detail.product.category ? ` · ${detail.product.category}` : ""}</p><p className="mt-2 text-xs font-medium text-[#a06122]">{detail.missingFields.length ? `${detail.missingFields.length} عناصر تحتاج إكمالًا` : "البيانات الأساسية مكتملة"}</p></div></div><Button size="icon" variant="ghost" onClick={() => setSelectedProductId(null)} aria-label="إغلاق التفاصيل"><X className="h-4 w-4" /></Button></div></header>

            {detail.missingFields.length > 0 && <div className="mx-5 mt-5 flex flex-wrap gap-2 rounded-2xl border border-[#f1d8bd] bg-[#fff9f1] p-3 text-xs text-[#8f5527] sm:mx-6">{detail.missingFields.map(field => <span key={field} className="flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5" />ينقص {fieldLabel(field)}</span>)}</div>}

            <div className="space-y-8 px-5 py-6 sm:px-6">
              <section id="basic-details"><SectionTitle number="1" title="البيانات الأساسية" subtitle="أكمل المعلومات التي ستظهر في التشغيل لاحقًا." /><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="اسم المنتج"><Input value={draftName} onChange={event => setDraftName(event.target.value)} disabled={!canEdit} /></Field><Field label="سعر البيع (د.ع)"><Input inputMode="decimal" value={draftPrice} onChange={event => setDraftPrice(event.target.value)} disabled={!canEdit} placeholder="أدخل السعر" /></Field><Field label="القياسات المشتركة" hint="مثال: Medium، Large"><Input value={draftSizes} onChange={event => setDraftSizes(event.target.value)} disabled={!canEdit} placeholder="لا توجد قياسات" /></Field><Field label="حالة العمل"><div className="flex h-10 items-center rounded-md border border-[#e2ddd2] bg-[#faf9f6] px-3 text-sm text-[#66736c]">{statusLabel(detail.product.status)} — النشر قرار منفصل</div></Field><div className="sm:col-span-2"><Field label="الوصف"><Textarea value={draftDescription} onChange={event => setDraftDescription(event.target.value)} disabled={!canEdit} placeholder="أضف وصف المنتج" className="min-h-28" /></Field></div></div><div className="mt-4 flex flex-wrap items-center gap-3"><Button onClick={saveDetails} disabled={!canEdit || updateDetails.isPending || !draftName.trim()} className="bg-[#183d35] hover:bg-[#102f29]"><Save className="ml-2 h-4 w-4" />{updateDetails.isPending ? "جارٍ الحفظ..." : "حفظ البيانات"}</Button>{updateDetails.error && <p className="text-xs text-[#a14724]">{updateDetails.error.message}</p>}</div></section>

              <section id="media"><SectionTitle number="2" title="الصور وتحليل الألوان" subtitle="التحليل يقترح فقط؛ يمكنك تفكيك المجموعة وإعادة تحليل الصور المحددة." /><div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f5faf7] p-4"><div><p className="font-bold text-[#245746]">صور المنتج التشغيلية</p><p className="mt-1 text-xs text-[#6b7d74]">كل صورة يرفعها الموظف تتحول إلى WebP داخل المنصة، ولا تحتاج OneDrive.</p></div><div className="flex flex-wrap gap-2"><label className="cursor-pointer"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={addImage} className="sr-only" disabled={!canEdit || uploadImage.isPending} /><span className="inline-flex h-10 items-center rounded-lg border border-[#aacbbc] bg-white px-3 text-sm font-bold text-[#28604e]"><ImagePlus className="ml-1.5 h-4 w-4" />{uploadImage.isPending ? "جارٍ التحويل..." : "إضافة صور"}</span></label><Button onClick={runAllColorAnalysis} disabled={!canEdit || analyzeColors.isPending || !(selectedProductMedia.data?.length)} className="bg-[#a47d40] text-white hover:bg-[#8b6933]"><Sparkles className={`ml-1.5 h-4 w-4 ${analyzeColors.isPending ? "animate-pulse" : ""}`} />{analyzeColors.isPending ? "جارٍ تحليل الصور..." : "تحليل الألوان"}</Button></div></div>{(uploadImage.error || analyzeColors.error) && <p className="mt-3 rounded-xl bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{uploadImage.error?.message ?? analyzeColors.error?.message}</p>}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{selectedProductMedia.data?.map(media => <div key={media.mediaId} className="overflow-hidden rounded-2xl border border-[#e8e2d5] bg-white"><img src={media.dataUrl} alt={media.originalFileName} className="aspect-[4/5] w-full object-cover" /><div className="p-2.5 text-xs"><p className="truncate font-medium text-[#40554c]">{media.colorName || "غير مرتبطة بلون"}</p><p className="mt-1 text-[#879089]">{media.colorName ? `${media.inventoryQuantity} قطعة` : "تحتاج مراجعة"}</p></div></div>)}</div>
                {suggestions.length > 0 && <div className="mt-4 rounded-2xl border border-[#ead8b7] bg-[#fffaf0] p-4"><div className="flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 text-[#a77b2f]" /><div><p className="font-bold text-[#745429]">اقتراحات تحتاج اعتمادًا</p>{analysisNote && <p className="mt-1 text-xs leading-5 text-[#8b7659]">{analysisNote}</p>}</div></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{suggestions.map((suggestion, index) => { const suggestionMedia = suggestion.mediaIds.map(mediaId => mediaById.get(mediaId)).filter((media): media is NonNullable<typeof media> => Boolean(media)); return <div key={`${suggestion.colorNameArabic}-${index}`} className="rounded-xl border border-[#eddfc4] bg-white p-3"><div className="flex items-start gap-3"><div className="flex shrink-0 -space-x-2 space-x-reverse" aria-label={`صور اقتراح ${suggestion.colorNameArabic}`}>{suggestionMedia.slice(0, 4).map(media => <img key={media.mediaId} src={media.dataUrl} alt={`صورة مقترحة للون ${suggestion.colorNameArabic}`} className="h-12 w-12 rounded-xl border-2 border-white object-cover shadow-sm" />)}{suggestionMedia.length > 4 && <span className="grid h-12 w-12 place-items-center rounded-xl border-2 border-white bg-[#f1eadc] text-xs font-bold text-[#765f3c]">+{suggestionMedia.length - 4}</span>}{suggestionMedia.length === 0 && <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#f3f0e9] text-[#9a815c]"><ImagePlus className="h-4 w-4" /></span>}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><Input value={suggestion.colorNameArabic} onChange={event => setSuggestions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, colorNameArabic: event.target.value } : item))} className="h-9" disabled={!canEdit} /><span className="whitespace-nowrap text-xs text-[#8a7150]">ثقة {Math.round(suggestion.confidence * 100)}%</span></div><p className="mt-2 text-xs text-[#786a57]">{suggestion.reviewNote}</p></div></div><div className="mt-3 flex items-center justify-between"><span className="text-xs text-[#786a57]">{suggestionMedia.length} صور مرتبطة</span><Button size="sm" onClick={() => createColor(suggestion.colorNameArabic, suggestion.mediaIds)} disabled={!canEdit || addColor.isPending || assignMediaColor.isPending} className="bg-[#285f4e] hover:bg-[#1c4b3d]"><Check className="ml-1 h-3.5 w-3.5" />اعتماد وربط</Button></div></div>; })}</div></div>}</section>

              {suggestions.length > 0 ? (
                <section className="rounded-2xl border border-dashed border-[#d9c28d] bg-[#fffdf7] p-4">
                  <SectionTitle number="3" title="تفكيك الاقتراحات" subtitle="حدد الصور الصحيحة للون، ثم حلل المحدد أو أزله من المجموعة الخاطئة." />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {suggestions.map((suggestion, index) => (
                      <ColorSuggestionEditor
                        key={`editor-${suggestion.colorNameArabic}-${index}`}
                        suggestion={suggestion}
                        media={suggestionMediaFor(suggestion.mediaIds)}
                        canEdit={canEdit}
                        isAnalyzing={analyzeColors.isPending}
                        onRename={colorNameArabic => setSuggestions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, colorNameArabic } : item))}
                        onToggle={mediaId => toggleSuggestedMedia(index, mediaId)}
                        onRemoveSelected={() => removeSelectedFromSuggestion(index)}
                        onReanalyze={() => reanalyzeSelectedMedia(index)}
                        onAccept={() => createColor(suggestion.colorNameArabic, suggestion.selectedMediaIds, index)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <section id="colors"><SectionTitle number="4" title="الألوان" subtitle="أضف اللون يدويًا أو اعتمد اقتراح التحليل، ثم أدخل الكمية في الخطوة التالية." /><div className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-[#b8d4c7] bg-[#f8fcfa] p-4 sm:flex-row"><Input value={newColorName} onChange={event => setNewColorName(event.target.value)} placeholder="مثال: عنابي" disabled={!canEdit} className="bg-white" /><Button onClick={() => createColor(newColorName)} disabled={!canEdit || !newColorName.trim() || addColor.isPending} className="whitespace-nowrap bg-[#183d35] hover:bg-[#102f29]"><Palette className="ml-1.5 h-4 w-4" />{addColor.isPending ? "جارٍ الإضافة..." : "إضافة لون"}</Button></div>{addColor.error && <p className="mt-2 text-xs text-[#a14724]">{addColor.error.message}</p>}<div className="mt-4 flex flex-wrap gap-2">{Array.from(variantsByColor.entries()).map(([colorName, variants]) => <div key={colorName} className="rounded-xl border border-[#d6e4dd] bg-white px-3 py-2"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#a47d40]" /><span className="font-bold text-[#355046]">{colorName}</span><span className="text-xs text-[#74817a]">{sizes.length ? `${variants.length} قياسات` : "بلا قياسات"}</span></div></div>)}{variantsByColor.size === 0 && <p className="text-sm text-[#74817a]">لا توجد ألوان معتمدة بعد. استخدم اقتراح التحليل أو أضف لونًا يدويًا.</p>}</div></section>

              <section id="inventory"><SectionTitle number="4" title="المخزون" subtitle={sizes.length ? "أدخل كمية كل تركيبة لون وقياس." : "أدخل كمية كل لون متاح."} />{variantsByColor.size === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-[#d9d0c1] bg-[#fcfaf6] p-5 text-sm text-[#7a786f]">أضف لونًا واحدًا على الأقل أولًا، ثم ستظهر حقول الكمية هنا.</div> : <><div className="mt-4 overflow-hidden rounded-2xl border border-[#e5e0d7]"><div className="overflow-x-auto"><table className="w-full min-w-[440px] text-right text-sm"><thead className="bg-[#f6f3ec] text-[#5f6d65]"><tr><th className="px-4 py-3 font-bold">اللون</th>{sizes.length ? sizes.map(size => <th key={size} className="px-4 py-3 font-bold">{size}</th>) : <th className="px-4 py-3 font-bold">الكمية المتاحة</th>}<th className="px-4 py-3 font-bold">الحالة</th></tr></thead><tbody>{Array.from(variantsByColor.entries()).map(([colorName, variants]) => <tr key={colorName} className="border-t border-[#eee9df]"><td className="px-4 py-3 font-bold text-[#355046]">{colorName}</td>{sizes.length ? sizes.map(size => { const variant = variants.find(item => item.sizeLabel === size); return <td key={size} className="px-4 py-2">{variant ? <Input inputMode="numeric" value={inventoryValues[variant.id] ?? "0"} onChange={event => setInventoryValues(current => ({ ...current, [variant.id]: event.target.value }))} disabled={!canInventory} className="h-9 min-w-20" /> : "—"}</td>; }) : variants.map(variant => <td key={variant.id} className="px-4 py-2"><Input inputMode="numeric" value={inventoryValues[variant.id] ?? "0"} onChange={event => setInventoryValues(current => ({ ...current, [variant.id]: event.target.value }))} disabled={!canInventory} className="h-9 min-w-24" /></td>)}<td className="px-4 py-3 text-xs text-[#6b796f]">{variants.every(variant => Number(inventoryValues[variant.id] ?? 0) <= 0) ? "نفد" : "متاح"}</td></tr>)}</tbody></table></div></div><div className="mt-4 flex flex-wrap items-center gap-3"><Button onClick={saveAllInventory} disabled={!canInventory || saveInventory.isPending} className="bg-[#183d35] hover:bg-[#102f29]"><Warehouse className="ml-1.5 h-4 w-4" />{saveInventory.isPending ? "جارٍ حفظ المخزون..." : "حفظ المخزون"}</Button>{saveInventory.error && <p className="text-xs text-[#a14724]">{saveInventory.error.message}</p>}</div></>}</section>

              <section className="border-t border-[#eee9df] pt-6"><details><summary className="flex cursor-pointer list-none items-center justify-between font-bold text-[#4a6459]">مصدر Catalog وسجل العمل <ChevronDown className="h-4 w-4" /></summary><p className="mt-3 text-sm leading-6 text-[#718078]">Catalog يُقرأ في الخلفية فقط. لا تُعدّل المنصة ملفات OneDrive، وتبقى عملية النشر منفصلة عن هذه الخطوات.</p></details></section>
            </div>
          </div>}
        </article>
      </section>
    </div>
  );
}

function SectionTitle({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <div className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#183d35] text-xs font-bold text-white">{number}</span><div><h3 className="font-bold text-[#183d35]">{title}</h3><p className="mt-0.5 text-xs leading-5 text-[#74817a]">{subtitle}</p></div></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-[#4d6158]"><span>{label}</span>{hint && <span className="mr-1 text-xs font-normal text-[#8b968f]">{hint}</span>}<div className="mt-1.5">{children}</div></label>;
}

function ColorSuggestionEditor({ suggestion, media, canEdit, isAnalyzing, onRename, onToggle, onRemoveSelected, onReanalyze, onAccept }: {
  suggestion: EditableColorSuggestion;
  media: Array<{ mediaId: number; dataUrl: string }>;
  canEdit: boolean;
  isAnalyzing: boolean;
  onRename: (name: string) => void;
  onToggle: (mediaId: number) => void;
  onRemoveSelected: () => void;
  onReanalyze: () => void;
  onAccept: () => void;
}) {
  return <div className="rounded-xl border border-[#eddfc4] bg-white p-3"><div className="flex items-center justify-between gap-2"><Input value={suggestion.colorNameArabic} onChange={event => onRename(event.target.value)} className="h-9" disabled={!canEdit} /><span className="whitespace-nowrap text-xs text-[#8a7150]">ثقة {Math.round(suggestion.confidence * 100)}%</span></div><div className="mt-3 flex flex-wrap gap-2">{media.map(item => { const selected = suggestion.selectedMediaIds.includes(item.mediaId); return <button type="button" key={item.mediaId} onClick={() => onToggle(item.mediaId)} aria-pressed={selected} title={selected ? "الصورة محددة" : "اختيار الصورة"} className={`relative h-16 w-16 overflow-hidden rounded-xl border-2 transition ${selected ? "border-[#a47d40] ring-2 ring-[#ead7ac]" : "border-transparent opacity-55 hover:opacity-100"}`}><img src={item.dataUrl} alt={`صورة ضمن اقتراح ${suggestion.colorNameArabic}`} className="h-full w-full object-cover" />{selected && <span className="absolute inset-0 grid place-items-center bg-[#183d35]/35 text-white"><Check className="h-5 w-5" /></span>}</button>; })}</div><p className="mt-3 text-xs text-[#786a57]">{suggestion.selectedMediaIds.length} من {media.length} صور محددة. {suggestion.reviewNote}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={onRemoveSelected} disabled={!canEdit || !suggestion.selectedMediaIds.length} className="border-[#d6c9b6] text-[#765f3c]">نقل إلى غير مؤكد</Button><Button size="sm" variant="outline" onClick={onReanalyze} disabled={!canEdit || isAnalyzing || !suggestion.selectedMediaIds.length} className="border-[#b8d4c7] text-[#28604e]"><RefreshCw className="ml-1 h-3.5 w-3.5" />حلل المحدد</Button><Button size="sm" onClick={onAccept} disabled={!canEdit || !suggestion.selectedMediaIds.length} className="bg-[#285f4e] hover:bg-[#1c4b3d]"><Check className="ml-1 h-3.5 w-3.5" />اعتماد المحدد</Button></div></div>;
}
