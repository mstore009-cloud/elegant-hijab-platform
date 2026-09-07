import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronLeft, ClipboardCheck, ImageUp, Layers3, Send, Settings2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

type Props = { canEdit: boolean; onOpenProduct: (productId: number) => void; onOpenSettings: () => void };
type WorkspaceStep = "select" | "complete" | "prepare" | "review";
type Scope = "all" | "group" | "manual";

const stepLabels: Array<{ id: WorkspaceStep; label: string }> = [
  { id: "select", label: "اختر المنتجات" },
  { id: "complete", label: "فحص وإكمال" },
  { id: "prepare", label: "جهّز الوسائط" },
  { id: "review", label: "راجع وأرسل" },
];

function reportMessage(issues: string[]) {
  return issues[0] ?? "تحتاج بيانات المنتج إلى مراجعة.";
}

export function MetaCatalogWorkspace({ canEdit, onOpenProduct, onOpenSettings }: Props) {
  const utils = trpc.useUtils();
  const readiness = trpc.metaCatalog.readiness.useQuery();
  const products = trpc.metaCatalog.workspaceProducts.useQuery();
  const sourceUpdates = trpc.metaCatalog.sourceUpdates.useQuery();
  const [step, setStep] = useState<WorkspaceStep>("select");
  const [scope, setScope] = useState<Scope>("manual");
  const [groupPath, setGroupPath] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [catalogAssetId, setCatalogAssetId] = useState<number | null>(null);
  const [prepareResult, setPrepareResult] = useState<{ prepared: number; preparedItems: Array<{ productId: number; mediaId: number; mediaType: "image" | "video"; source: string }>; skipped: Array<{ productId: number; mediaId: number; reason: string }> } | null>(null);
  const selectedAsset = readiness.data?.assets.find(asset => asset.id === catalogAssetId) ?? readiness.data?.assets.find(asset => asset.isSelected) ?? readiness.data?.assets[0] ?? null;
  const selectedAssetId = selectedAsset?.id ?? null;
  const selectedInput = useMemo(() => selectedAssetId && selectedIds.length ? { catalogAssetId: selectedAssetId, productIds: selectedIds } : skipToken, [selectedAssetId, selectedIds]);
  const preview = trpc.metaCatalog.preview.useQuery(selectedInput, { enabled: selectedInput !== skipToken });
  const prepare = trpc.metaCatalog.prepareProductsMedia.useMutation({
    onSuccess: result => {
      setPrepareResult({ prepared: result.prepared.length, preparedItems: result.prepared, skipped: result.skipped });
      void utils.metaCatalog.workspaceProducts.invalidate();
      void utils.metaCatalog.preview.invalidate();
      void utils.metaCatalog.sourceUpdates.invalidate();
      setStep("review");
    },
  });
  const dismissSourceUpdate = trpc.metaCatalog.dismissSourceUpdate.useMutation({ onSuccess: () => { void utils.metaCatalog.sourceUpdates.invalidate(); void utils.metaCatalog.workspaceProducts.invalidate(); } });
  const exportNow = trpc.metaCatalog.exportNow.useMutation({ onSuccess: () => { void utils.metaCatalog.jobs.invalidate(); void utils.metaCatalog.sourceUpdates.invalidate(); void utils.metaCatalog.workspaceProducts.invalidate(); } });

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products.data ?? []) {
      const path = product.groupPath?.trim();
      if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    return Array.from(counts, ([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path, "ar"));
  }, [products.data]);
  const scopedProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ar");
    return (products.data ?? []).filter(product => {
      const matchesScope = scope === "group" ? product.groupPath === groupPath : true;
      const haystack = [product.productCode, product.name, product.groupPath ?? "", product.material ?? ""].join(" ").toLocaleLowerCase("ar");
      return matchesScope && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [products.data, scope, groupPath, query]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedProducts = useMemo(() => (products.data ?? []).filter(product => selectedSet.has(product.id)), [products.data, selectedSet]);
  const reportByProduct = useMemo(() => new Map((preview.data?.productReports ?? []).map(report => [report.productId, report])), [preview.data?.productReports]);
  const sourceUpdateByProduct = useMemo(() => new Map((sourceUpdates.data ?? []).filter(update => update.status === "pending_review" || update.status === "media_prepared").map(update => [update.productId, update])), [sourceUpdates.data]);
  const readyCount = (preview.data?.productReports ?? []).filter(report => report.status === "ready").length;
  const needsReviewCount = (preview.data?.productReports ?? []).filter(report => report.status !== "ready").length;
  const toggle = (productId: number) => setSelectedIds(current => current.includes(productId) ? current.filter(id => id !== productId) : [...current, productId]);
  const selectScopeProducts = () => setSelectedIds(scopedProducts.map(product => product.id));
  const beginScope = (nextScope: Scope) => {
    setScope(nextScope);
    setPrepareResult(null);
    if (nextScope === "all") setSelectedIds((products.data ?? []).map(product => product.id));
    if (nextScope === "manual") setSelectedIds([]);
  };
  const prepareSelection = () => {
    if (!selectedIds.length) return;
    setPrepareResult(null);
    prepare.mutate({ productIds: selectedIds });
  };
  const submitSelected = () => {
    if (!selectedAssetId || !selectedIds.length || !readyCount) return;
    if (!window.confirm(`سيتم إرسال ${readyCount} منتج جاهز فقط إلى Meta. لن تُرسل المنتجات التي تحتاج إصلاحًا. هل تريد المتابعة؟`)) return;
    exportNow.mutate({ catalogAssetId: selectedAssetId, productIds: selectedIds });
  };

  if (!readiness.isLoading && !readiness.data?.assets.length) {
    return <section className="rounded-2xl border border-[#eadcbf] bg-[#fffaf0] p-4 text-sm text-[#7a5a25]"><p className="font-bold">لم يُحدد Catalog متصل لهذا المتجر بعد.</p><p className="mt-1 text-xs leading-5">اختر أصل Meta Catalog من مركز Meta، ثم ارجع إلى هذه المساحة لاختيار المنتجات وتجهيزها.</p><Button size="sm" variant="outline" onClick={() => window.location.assign("/meta-connections")} className="mt-3 border-[#d5c29e] text-[#7a5a25]">فتح مركز Meta</Button></section>;
  }

  return <div className="space-y-4">{sourceUpdates.data?.some(update => update.status === "pending_review" || update.status === "media_prepared") ? <section className="rounded-2xl border border-[#ead8b7] bg-[#fffaf0] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 font-bold text-[#7a5525]"><ClipboardCheck className="h-4 w-4" />تحديثات من OneDrive بانتظار المراجعة</p><p className="mt-1 text-xs leading-5 text-[#806b50]">هذه تحديثات لمنتجات موجودة؛ لن يُرسل أي تغيير إلى Meta قبل أن تختار المنتج وتراجعه.</p></div><span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#7a5525]">{sourceUpdates.data.filter(update => update.status === "pending_review" || update.status === "media_prepared").length} تحديثات</span></div><div className="mt-3 space-y-2">{sourceUpdates.data.filter(update => update.status === "pending_review" || update.status === "media_prepared").slice(0, 5).map(update => <div key={update.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#ecdcbf] bg-white px-3 py-2"><div className="text-xs"><b className="text-[#5b472d]">{update.productName}</b><span className="mr-1 text-[#8b7a64]">— {update.changes.map(change => change.label).join(" · ")}</span></div><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => { setScope("manual"); setSelectedIds([update.productId]); setStep("complete"); }} className="border-[#d5c29e] text-[#7a5a25]">مراجعة هذا التحديث</Button><Button size="sm" variant="ghost" onClick={() => { if (window.confirm("سيُخفى تنبيه هذا التحديث فقط. لن تُحذف أي صورة أو بيانات من Meta. هل تريد المتابعة؟")) dismissSourceUpdate.mutate({ productId: update.productId }); }} disabled={!canEdit || dismissSourceUpdate.isPending} className="px-2 text-[#8b7a64]">إخفاء</Button></div></div>)}</div></section> : null}
    <section className="rounded-2xl border border-[#d8e5de] bg-white p-4 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="flex items-center gap-2 font-bold text-[#183d35]"><Layers3 className="h-4 w-4 text-[#a47d40]" />مساحة عمل Meta Catalog</p><p className="mt-1 text-xs leading-5 text-[#68756e]">اختر ما تريد إرساله، ثم أصلح النواقص وجهّز الوسائط قبل التصدير. لا يغير اختيار الدفعة أي إعداد دائم.</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-[#f2f8f4] px-3 py-1.5 text-xs font-bold text-[#245b4d]">{selectedIds.length} منتج محدد</span><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${readyCount ? "bg-[#e4f3ea] text-[#17633b]" : "bg-[#f5f2eb] text-[#69736d]"}`}>{readyCount} جاهز</span>{needsReviewCount ? <span className="rounded-full bg-[#fff1de] px-3 py-1.5 text-xs font-bold text-[#a35d1c]">{needsReviewCount} يحتاج إكمالًا</span> : null}<Button size="sm" variant="outline" onClick={onOpenSettings} className="border-[#d7e2dc] text-[#245b4d]"><Settings2 className="ml-1.5 h-3.5 w-3.5" />إعدادات التصنيف</Button></div></div><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{stepLabels.map((item, index) => <button key={item.id} type="button" onClick={() => selectedIds.length || item.id === "select" ? setStep(item.id) : undefined} disabled={!selectedIds.length && item.id !== "select"} className={`rounded-xl px-2 py-2.5 text-right text-xs transition ${step === item.id ? "bg-[#183d35] font-bold text-white shadow-sm" : index < stepLabels.findIndex(stepItem => stepItem.id === step) ? "bg-[#e9f4ef] text-[#21624d]" : "bg-[#f6f5f1] text-[#74817a] disabled:cursor-not-allowed"}`}><span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px]">{index + 1}</span>{item.label}</button>)}</div></section>

    {step === "select" ? <section className="rounded-2xl border border-[#d8e5de] bg-white p-4"><div><h3 className="font-bold text-[#183d35]">1. اختر المنتجات لهذه الدفعة</h3><p className="mt-1 text-xs leading-5 text-[#68756e]">هذا اختيار مؤقت للتصدير الحالي، وليس قاعدة دائمة ولا تغييرًا في المنتجات الأخرى.</p></div><div className="mt-4 grid gap-3 md:grid-cols-3">{([ ["all", "كل المنتجات النشطة", "يختار كل المنتجات النشطة في المتجر."], ["group", "قسم من OneDrive", "اختر قسمًا مثل ربطات قطن أو الحجابات الجاهزة."], ["manual", "اختيار يدوي", "حدد المنتجات التي تريدها من جدول العمل."] ] as Array<[Scope, string, string]>).map(([id, title, description]) => <button type="button" key={id} onClick={() => beginScope(id)} className={`rounded-2xl border p-4 text-right transition ${scope === id ? "border-[#2e6d58] bg-[#eef7f2] shadow-sm" : "border-[#e4e9e5] hover:border-[#b8d4c7]"}`}><p className="font-bold text-[#28463b]">{title}</p><p className="mt-1 text-xs leading-5 text-[#718178]">{description}</p></button>)}</div>{scope === "group" ? <div className="mt-4 rounded-2xl border border-[#dce8df] bg-[#f7fbf8] p-3"><label className="block text-xs font-bold text-[#4d6158]">القسم الذي تريد العمل عليه<select value={groupPath} onChange={event => { setGroupPath(event.target.value); setSelectedIds([]); }} className="mt-1.5 h-10 w-full rounded-xl border border-[#d8e5de] bg-white px-3 text-sm text-[#30483e]"><option value="">اختر قسمًا من شجرة OneDrive</option>{groups.map(group => <option key={group.path} value={group.path}>{group.path} — {group.count} منتج نشط</option>)}</select></label>{groupPath ? <p className="mt-2 text-xs text-[#4f695d]">سيظهر فقط منتجات قسم «{groupPath}» لتحددها أو تحددها كلها.</p> : <p className="mt-2 text-xs text-[#9c4b25]">إن لم تظهر الأقسام، شغّل مزامنة OneDrive أولًا أو استخدم الاختيار اليدوي.</p>}</div> : null}<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو الكود أو القسم" className="h-10 max-w-md rounded-xl border-[#d8e5de]" /><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={selectScopeProducts} disabled={!scopedProducts.length} className="border-[#b9d3c6] text-[#245b4d]">تحديد نتائج العرض ({scopedProducts.length})</Button><Button size="sm" variant="ghost" onClick={() => setSelectedIds([])} disabled={!selectedIds.length} className="text-[#7a5a25]">إلغاء التحديد</Button></div></div><div className="mt-3 overflow-hidden rounded-2xl border border-[#e6ece8]"><div className="grid grid-cols-[34px_minmax(150px,1.2fr)_minmax(100px,.8fr)_78px_104px] gap-2 bg-[#f7faf8] px-3 py-2 text-xs font-bold text-[#587066]"><span></span><span>المنتج</span><span>القسم</span><span>الوسائط</span><span>الحالة</span></div>{products.isLoading ? <p className="p-4 text-xs text-[#718178]">جارٍ تحميل المنتجات النشطة…</p> : scopedProducts.length ? scopedProducts.map(product => { const selected = selectedSet.has(product.id); const hasSourceUpdate = Boolean(sourceUpdateByProduct.get(product.id)); return <div key={product.id} className={`grid grid-cols-[34px_minmax(150px,1.2fr)_minmax(100px,.8fr)_78px_104px] items-center gap-2 border-t border-[#edf0ee] px-3 py-3 text-xs ${selected ? "bg-[#f1f8f4]" : "bg-white"}`}><input aria-label={`تحديد ${product.name}`} type="checkbox" checked={selected} onChange={() => toggle(product.id)} className="h-4 w-4 accent-[#28604e]" /><button type="button" onClick={() => onOpenProduct(product.id)} className="min-w-0 text-right"><b className="block truncate text-[#28463b]">{product.name}</b><span className="block truncate text-[#76837c]">{product.productCode}</span></button><span className="truncate text-[#64786e]">{product.groupPath ?? "غير مصنف"}</span><span className="text-[#64786e]">{product.imageCount} ص · {product.videoCount} ف</span><span className={`rounded-full px-2 py-1 text-center font-bold ${hasSourceUpdate ? "bg-[#fff1de] text-[#a35d1c]" : product.preparedMediaCount >= product.imageCount && product.imageCount ? "bg-[#e4f3ea] text-[#17633b]" : "bg-[#fff1de] text-[#a35d1c]"}`}>{hasSourceUpdate ? "تحديث OneDrive" : product.preparedMediaCount >= product.imageCount && product.imageCount ? "وسائط جاهزة" : "تحتاج تجهيز"}</span></div>; }) : <p className="p-4 text-xs text-[#718178]">لا توجد منتجات نشطة مطابقة لهذا الاختيار.</p>}</div><div className="mt-4 flex justify-end"><Button onClick={() => setStep("complete")} disabled={!selectedIds.length} className="bg-[#183d35] text-white hover:bg-[#245b4d]">متابعة بالمنتجات المحددة ({selectedIds.length})<ChevronLeft className="mr-1.5 h-4 w-4" /></Button></div></section> : null}

    {step === "complete" || step === "prepare" || step === "review" ? <section className="rounded-2xl border border-[#d8e5de] bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-[#183d35]">{step === "complete" ? "2. افحص النواقص" : step === "prepare" ? "3. جهّز الوسائط" : "4. راجع الدفعة"}</h3><p className="mt-1 text-xs leading-5 text-[#68756e]">تظهر المنتجات المختارة فقط. أصلح السبب من الصف نفسه، ثم ارجع إلى المراجعة.</p></div>{selectedAssetId ? <label className="text-xs font-bold text-[#4d6158]">الكتالوج المستهدف<select value={selectedAssetId} onChange={event => setCatalogAssetId(Number(event.target.value))} className="mt-1 block h-9 rounded-lg border border-[#d8e5de] bg-white px-2 text-xs text-[#30483e]">{readiness.data?.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.displayName ?? asset.externalId}</option>)}</select></label> : null}</div>{preview.isLoading ? <p className="mt-4 rounded-xl bg-[#f7faf8] p-3 text-xs text-[#718178]">جارٍ فحص المنتجات المختارة دون إرسال أي بيانات…</p> : preview.error ? <p className="mt-4 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs text-[#9c4b25]">تعذر فحص الدفعة: {preview.error.message}</p> : <div className="mt-4 space-y-2">{selectedProducts.map(product => { const report = reportByProduct.get(product.id); const isReady = report?.status === "ready"; return <article key={product.id} className={`rounded-xl border p-3 ${isReady ? "border-[#cce0d7] bg-[#f6fbf8]" : "border-[#efd9ba] bg-[#fffaf1]"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-[#28463b]">{product.name} <span className="font-normal text-[#74817a]">— {product.productCode}</span></p><p className="mt-1 text-xs text-[#64786e]">الخامة: <b>{report?.material ?? product.material ?? "غير محددة"}</b> · الوسائط: {product.preparedMediaCount}/{product.imageCount + product.videoCount} مجهزة</p>{report?.issues.length ? <p className="mt-1 text-xs text-[#a35d1c]"><AlertCircle className="ml-1 inline h-3.5 w-3.5" />{reportMessage(report.issues)}</p> : null}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onOpenProduct(product.id)} className="border-[#b9d3c6] text-[#245b4d]">{isReady ? "عرض المنتج" : "إصلاح المنتج"}</Button>{product.preparedMediaCount < product.imageCount + product.videoCount ? <Button size="sm" variant="outline" onClick={() => prepare.mutate({ productIds: [product.id] })} disabled={!canEdit || prepare.isPending} className="border-[#d5c29e] text-[#7a5a25]"><ImageUp className="ml-1 h-3.5 w-3.5" />تجهيز هذا المنتج</Button> : null}</div></div></article>; })}</div>}<div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-[#edf0ee] pt-4">{step === "complete" ? <Button variant="outline" onClick={() => setStep("select")} className="border-[#d8e5de] text-[#526a60]">تعديل الاختيار</Button> : <Button variant="outline" onClick={() => setStep("complete")} className="border-[#d8e5de] text-[#526a60]">العودة للنواقص</Button>}{step === "complete" ? <Button onClick={() => { setStep("prepare"); prepareSelection(); }} disabled={!canEdit || !selectedIds.length || prepare.isPending} className="bg-[#a47d40] text-white hover:bg-[#8f6b35]"><ImageUp className="ml-1.5 h-4 w-4" />{prepare.isPending ? "جارٍ التجهيز…" : "فحص وتجهيز المنتجات المحددة"}</Button> : null}{step === "prepare" ? <Button onClick={() => { setStep("review"); void preview.refetch(); }} className="bg-[#183d35] text-white hover:bg-[#245b4d]">مراجعة النتيجة<ChevronLeft className="mr-1.5 h-4 w-4" /></Button> : null}{step === "review" ? <Button onClick={submitSelected} disabled={!canEdit || !selectedAssetId || !readyCount || exportNow.isPending || !readiness.data?.capability?.enabled || readiness.data.capability.status !== "ready"} className="bg-[#183d35] text-white hover:bg-[#245b4d]"><Send className="ml-1.5 h-4 w-4" />{exportNow.isPending ? "جارٍ الإرسال…" : `تصدير ${readyCount} منتج جاهز إلى Meta`}</Button> : null}</div>{prepareResult ? <div className={`mt-3 rounded-xl p-3 text-xs ${prepareResult.skipped.length ? "border border-[#f0d6bc] bg-[#fff7ef] text-[#8f5527]" : "bg-[#eef7f2] text-[#21624d]"}`}><p className="font-bold"><CheckCircle2 className="ml-1 inline h-4 w-4" />تم تجهيز {prepareResult.prepared} وسيط.</p>{prepareResult.preparedItems.length ? <div className="mt-2 space-y-1">{prepareResult.preparedItems.map(item => <p key={`${item.productId}-${item.mediaId}`}><CheckCircle2 className="ml-1 inline h-3.5 w-3.5" />المنتج #{item.productId} · {item.mediaType === "image" ? "صورة" : "فيديو"} #{item.mediaId}: جاهز</p>)}</div> : null}{prepareResult.skipped.length ? <div className="mt-2 space-y-1">{prepareResult.skipped.map(item => <p key={`${item.productId}-${item.mediaId}`}><AlertCircle className="ml-1 inline h-3.5 w-3.5" />الوسيط #{item.mediaId}: {item.reason}</p>)}</div> : <p className="mt-1">لا توجد وسائط متخطاة في هذه العملية.</p>}</div> : null}{exportNow.data ? <p className="mt-3 rounded-xl bg-[#eef7f2] p-3 text-xs font-bold text-[#21624d]"><Sparkles className="ml-1 inline h-4 w-4" />تم إرسال {exportNow.data.snapshot.itemCount} عنصرًا من نطاقك المحدد إلى Meta.</p> : null}{exportNow.error ? <p className="mt-3 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs text-[#9c4b25]">{exportNow.error.message}</p> : null}</section> : null}
  </div>;
}
