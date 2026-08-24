import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProductListThumbnail } from "@/components/ProductListThumbnail";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, CircleAlert, CloudCog, ImagePlus, Layers3, RefreshCw, Save, Search, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

const missingFieldLabels: Record<string, string> = {
  "product.txt": "ملف البيانات",
  name: "اسم المنتج",
  description: "الوصف",
  sellingPrice: "السعر",
  sizes: "القياسات",
  images: "الصور",
};

type WorkFilter = "needs_work" | "draft" | "ready" | "active" | "all";
type ProductMediaPreview = { mediaId: number; dataUrl: string; originalFileName: string };

function fieldLabel(field: string) { return missingFieldLabels[field] ?? field; }
function safeSizes(raw: string | null) {
  try { const parsed = JSON.parse(raw ?? "[]"); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { return []; }
}
function statusLabel(status: string) { return ({ draft: "مسودة", needs_review: "تحتاج مراجعة", ready: "جاهز للمراجعة", active: "نشط", archived: "مؤرشف" } as Record<string, string>)[status] ?? status; }
function statusClass(status: string) { return ({ draft: "bg-[#f1eee7] text-[#635d53]", needs_review: "bg-[#fff1de] text-[#a35d1c]", ready: "bg-[#e9f4ef] text-[#21624d]", active: "bg-[#e4f3ea] text-[#17633b]", archived: "bg-[#f0f0f0] text-[#747474]" } as Record<string, string>)[status] ?? "bg-slate-100 text-slate-700"; }

function ProductMediaCard({ media }: { media: ProductMediaPreview }) {
  return <figure className="overflow-hidden rounded-2xl border border-[#e8e2d5] bg-white"><img src={media.dataUrl} alt={`صورة المنتج ${media.originalFileName}`} className="aspect-[4/5] w-full object-cover" /><figcaption className="p-2.5 text-xs text-[#68756e]">الصورة هي مرجع اسم اللون والعدد المكتوب عليها.</figcaption></figure>;
}

export default function Products() {
  const profile = trpc.access.myProfile.useQuery();
  const products = trpc.products.list.useQuery(undefined, { enabled: profile.isSuccess });
  const syncStatus = trpc.catalogSync.status.useQuery(undefined, { enabled: profile.isSuccess });
  const canEdit = profile.data?.permissions.includes("products.edit") ?? false;
  const canCreate = profile.data?.permissions.includes("products.create") ?? false;
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

  const invalidateProducts = async () => {
    await Promise.all([utils.products.list.invalidate(), utils.products.byId.invalidate(), utils.products.mediaPreviews.invalidate(), syncStatus.refetch()]);
  };
  const updateDetails = trpc.products.updateDetails.useMutation({ onSuccess: invalidateProducts });
  const uploadImage = trpc.products.uploadManualImage.useMutation({ onSuccess: invalidateProducts });
  const runCatalogScan = trpc.catalogSync.runNow.useMutation({ onSuccess: invalidateProducts });

  useEffect(() => {
    const detail = selectedProduct.data;
    if (!detail) return;
    setDraftName(detail.product.name);
    setDraftDescription(detail.product.description ?? "");
    setDraftPrice(detail.missingFields.includes("sellingPrice") ? "" : detail.product.sellingPrice);
    setDraftSizes(safeSizes(detail.product.sizeLabels).join("، "));
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
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedProductId || !/^image\/(jpeg|png|webp)$/.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = typeof reader.result === "string" ? reader.result.split(",")[1] : "";
      if (base64Data) uploadImage.mutate({ productId: selectedProductId, fileName: file.name, mimeType: file.type, base64Data });
    };
    reader.readAsDataURL(file);
  };

  const detail = selectedProduct.data;
  const productMedia = selectedProductMedia.data ?? [];

  return (
    <div dir="rtl" className="mx-auto w-full max-w-[1440px] space-y-5 pb-10">
      <header className="flex flex-col gap-4 border-b border-[#e6ded0] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-medium text-[#98713f]">إدارة الكتالوج</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#183d35]">المنتجات</h1><p className="mt-1 text-sm text-[#68756e]">مرجع اللون والعدد هو ما كُتب داخل صورة المنتج؛ لا توجد حقول ألوان أو مخزون يدوية في هذه المرحلة.</p></div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#506b61]"><span className="rounded-full border border-[#cce0d7] bg-[#f1f8f4] px-3 py-1.5"><CloudCog className="ml-1 inline h-3.5 w-3.5" />Catalog تلقائي · {syncStatus.data?.lastSummary ? "آخر فحص مسجل" : "بانتظار الفحص"}</span><Button size="sm" variant="outline" onClick={() => runCatalogScan.mutate()} disabled={!canCreate || runCatalogScan.isPending} className="border-[#b9d3c6] text-[#245b4d]"><RefreshCw className={`ml-1.5 h-3.5 w-3.5 ${runCatalogScan.isPending ? "animate-spin" : ""}`} />فحص يدوي</Button></div>
      </header>

      {(products.error || runCatalogScan.error) && <div className="flex gap-3 rounded-2xl border border-[#f0d6bc] bg-[#fff7ef] p-4 text-sm text-[#9c4b25]"><AlertCircle className="h-5 w-5 shrink-0" />{products.error?.message ?? runCatalogScan.error?.message}</div>}

      <section className="rounded-3xl border border-[#e6ded0] bg-white p-3 shadow-[0_15px_38px_rgba(43,58,49,0.05)] sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex gap-1 overflow-x-auto rounded-2xl bg-[#f5f2eb] p-1.5">{([ ["needs_work", "يحتاج إكمالًا", workCounts.needs_work], ["draft", "مسودات", workCounts.draft], ["ready", "للمراجعة", workCounts.ready], ["active", "نشط", workCounts.active], ["all", "الكل", products.data?.length ?? 0] ] as Array<[WorkFilter, string, number]>).map(([key, label, count]) => <button key={key} onClick={() => setFilter(key)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm transition ${filter === key ? "bg-[#183d35] font-bold text-white shadow-sm" : "text-[#68756e] hover:bg-white"}`}>{label}<span className={`mr-1.5 text-xs ${filter === key ? "text-[#dbeee4]" : "text-[#9a8770]"}`}>{count}</span></button>)}</div><div className="relative w-full lg:w-80"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a968f]" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الكود أو النقص" className="h-11 rounded-xl border-[#ded8cd] pr-10" /></div></div></section>

      <section className={selectedProductId ? "grid gap-5 xl:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1.3fr)]" : ""}>
        <article className="overflow-hidden rounded-3xl border border-[#e6ded0] bg-white shadow-[0_15px_38px_rgba(43,58,49,0.05)]"><div className="flex items-center justify-between border-b border-[#eee9df] px-5 py-4"><div><h2 className="font-bold text-[#183d35]">قائمة العمل</h2><p className="mt-0.5 text-xs text-[#7b857f]">{filteredProducts.length} نتيجة في العرض الحالي</p></div><Layers3 className="h-5 w-5 text-[#a78550]" /></div>{products.isLoading && <div className="space-y-3 p-5"><div className="h-20 animate-pulse rounded-2xl bg-[#f5f2eb]" /><div className="h-20 animate-pulse rounded-2xl bg-[#f5f2eb]" /></div>}{!products.isLoading && filteredProducts.length === 0 && <div className="grid min-h-72 place-items-center p-8 text-center"><CheckCircle2 className="h-9 w-9 text-[#6da58b]" /><div><p className="mt-3 font-bold text-[#314b41]">لا توجد منتجات في هذا العرض</p><p className="mt-1 text-sm text-[#78847e]">جرّب تغيير الحالة أو البحث.</p></div></div>}<div className="divide-y divide-[#eee9df]">{filteredProducts.map(product => <button key={product.id} onClick={() => setSelectedProductId(product.id)} className={`group w-full px-4 py-4 text-right transition sm:px-5 ${selectedProductId === product.id ? "bg-[#eef7f2]" : "hover:bg-[#fcfbf8]"}`}><div className="flex gap-3"><ProductListThumbnail imageUrl={product.primaryImageUrl} alt={product.primaryImageAlt ?? `صورة ${product.name}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-bold text-[#263f36]">{product.name}</p><p className="mt-0.5 text-xs text-[#7a837d]">{product.productCode}{product.category ? ` · ${product.category}` : ""}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(product.status)}`}>{statusLabel(product.status)}</span></div><div className="mt-2 flex flex-wrap items-center gap-1.5">{product.missingFields.slice(0, 3).map(field => <span key={field} className="rounded-full bg-[#fff0dc] px-2 py-0.5 text-[11px] font-medium text-[#995f24]">ينقص {fieldLabel(field)}</span>)}{product.missingFields.length > 3 && <span className="text-xs text-[#8a7660]">+{product.missingFields.length - 3}</span>}</div><div className="mt-2 flex items-center justify-between text-xs"><span className="text-[#4e675d]">{product.missingFields.includes("sellingPrice") ? "أضف السعر" : `${product.sellingPrice} د.ع`}</span><span className="font-medium text-[#967342]">{product.missingFields.length ? "إكمال ←" : "مراجعة ←"}</span></div></div></div></button>)}</div></article>

        {selectedProductId && <article className="min-h-[680px] overflow-hidden rounded-3xl border border-[#e6ded0] bg-white shadow-[0_15px_38px_rgba(43,58,49,0.05)]">{selectedProduct.isLoading && <div className="p-6 text-sm text-[#526a60]">جارٍ فتح المنتج...</div>}{detail && <div className="space-y-0"><header className="sticky top-0 z-10 border-b border-[#e9e4da] bg-white/95 px-5 py-4 backdrop-blur sm:px-6"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3">{productMedia[0] ? <img src={productMedia[0].dataUrl} alt={`صورة ${detail.product.name}`} className="h-16 w-16 rounded-2xl border border-[#d9e6de] object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#f2eee6] text-[#9a815c]"><ImagePlus className="h-5 w-5" /></div>}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-bold text-[#183d35]">{detail.product.name}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(detail.product.status)}`}>{statusLabel(detail.product.status)}</span></div><p className="mt-1 text-xs text-[#74817a]">{detail.product.productCode}{detail.product.category ? ` · ${detail.product.category}` : ""}</p><p className="mt-2 text-xs font-medium text-[#a06122]">{detail.missingFields.length ? `${detail.missingFields.length} عناصر تحتاج إكمالًا` : "البيانات الأساسية مكتملة"}</p></div></div><Button size="icon" variant="ghost" onClick={() => setSelectedProductId(null)} aria-label="إغلاق التفاصيل"><X className="h-4 w-4" /></Button></div></header>{detail.missingFields.length > 0 && <div className="mx-5 mt-5 flex flex-wrap gap-2 rounded-2xl border border-[#f1d8bd] bg-[#fff9f1] p-3 text-xs text-[#8f5527] sm:mx-6">{detail.missingFields.map(field => <span key={field} className="flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5" />ينقص {fieldLabel(field)}</span>)}</div>}<div className="space-y-8 px-5 py-6 sm:px-6"><section><SectionTitle number="1" title="البيانات الأساسية" subtitle="أكمل معلومات المنتج، مع بقاء حالة النشر قرارًا منفصلًا." /><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="اسم المنتج"><Input value={draftName} onChange={event => setDraftName(event.target.value)} disabled={!canEdit} /></Field><Field label="سعر البيع (د.ع)"><Input inputMode="decimal" value={draftPrice} onChange={event => setDraftPrice(event.target.value)} disabled={!canEdit} placeholder="أدخل السعر" /></Field><Field label="القياسات المشتركة" hint="مثال: Medium، Large"><Input value={draftSizes} onChange={event => setDraftSizes(event.target.value)} disabled={!canEdit} placeholder="لا توجد قياسات" /></Field><Field label="حالة العمل"><div className="flex h-10 items-center rounded-md border border-[#e2ddd2] bg-[#faf9f6] px-3 text-sm text-[#66736c]">{statusLabel(detail.product.status)} — النشر قرار منفصل</div></Field><div className="sm:col-span-2"><Field label="الوصف"><Textarea value={draftDescription} onChange={event => setDraftDescription(event.target.value)} disabled={!canEdit} placeholder="أضف وصف المنتج" className="min-h-28" /></Field></div></div><div className="mt-4 flex flex-wrap items-center gap-3"><Button onClick={saveDetails} disabled={!canEdit || updateDetails.isPending || !draftName.trim()} className="bg-[#183d35] hover:bg-[#102f29]"><Save className="ml-2 h-4 w-4" />{updateDetails.isPending ? "جارٍ الحفظ..." : "حفظ البيانات"}</Button>{updateDetails.error && <p className="text-xs text-[#a14724]">{updateDetails.error.message}</p>}</div></section><section><SectionTitle number="2" title="الصور المرجعية" subtitle="اسم اللون والعدد المكتوبان داخل الصورة هما المرجع التشغيلي الحالي؛ لا توجد حقول ألوان أو مخزون يدوية." /><div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f5faf7] p-4"><div><p className="font-bold text-[#245746]">صور المنتج التشغيلية</p><p className="mt-1 text-xs text-[#6b7d74]">تُحفظ نسخة WebP للعرض فقط، ولا تعدل أصل OneDrive عالي الجودة.</p></div><label className="cursor-pointer"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={addImage} className="sr-only" disabled={!canEdit || uploadImage.isPending} /><span className="inline-flex h-10 items-center rounded-lg border border-[#aacbbc] bg-white px-3 text-sm font-bold text-[#28604e]"><ImagePlus className="ml-1.5 h-4 w-4" />{uploadImage.isPending ? "جارٍ التحويل..." : "إضافة صور"}</span></label></div>{uploadImage.error && <p className="mt-3 rounded-xl bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{uploadImage.error.message}</p>}{productMedia.length > 0 ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{productMedia.map(media => <ProductMediaCard key={media.mediaId} media={media} />)}</div> : <div className="mt-4 rounded-2xl border border-dashed border-[#d9d0c1] bg-[#fcfaf6] p-5 text-sm text-[#7a786f]">أضف صورة يظهر عليها اسم اللون والعدد لتكون المرجع التشغيلي لهذا المنتج.</div>}</section><section className="border-t border-[#eee9df] pt-6"><details><summary className="flex cursor-pointer list-none items-center justify-between font-bold text-[#4a6459]">مصدر Catalog وسجل العمل <ChevronDown className="h-4 w-4" /></summary><p className="mt-3 text-sm leading-6 text-[#718078]">Catalog يُقرأ في الخلفية فقط. لا تُعدّل المنصة ملفات OneDrive، وتبقى الصور المعلَّمة المرجع الحالي للون والعدد.</p></details></section></div></div>}</article>}
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
