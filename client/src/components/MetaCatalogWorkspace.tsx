import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronLeft, ImageUp, Layers3, Send, Settings2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

type Props = { canEdit: boolean; onOpenProduct: (productId: number) => void; onOpenSettings: () => void };
type WorkspaceStep = "select" | "complete" | "review";

const stepLabels: Array<{ id: WorkspaceStep; label: string }> = [
  { id: "select", label: "اختر المنتجات" },
  { id: "complete", label: "فحص وتجهيز" },
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
  const exportNow = trpc.metaCatalog.exportNow.useMutation({ onSuccess: () => { void utils.metaCatalog.jobs.invalidate(); void utils.metaCatalog.sourceUpdates.invalidate(); void utils.metaCatalog.workspaceProducts.invalidate(); } });

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ar");
    return (products.data ?? []).filter(product => {
      const haystack = [product.productCode, product.name, product.groupPath ?? "", product.material ?? ""].join(" ").toLocaleLowerCase("ar");
      return !normalizedQuery || haystack.includes(normalizedQuery);
    });
  }, [products.data, query]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedProducts = useMemo(() => (products.data ?? []).filter(product => selectedSet.has(product.id)), [products.data, selectedSet]);
  const reportByProduct = useMemo(() => new Map((preview.data?.productReports ?? []).map(report => [report.productId, report])), [preview.data?.productReports]);
  const sourceUpdateByProduct = useMemo(() => new Map((sourceUpdates.data ?? []).filter(update => update.status === "pending_review" || update.status === "media_prepared").map(update => [update.productId, update])), [sourceUpdates.data]);
  const readyCount = (preview.data?.productReports ?? []).filter(report => report.status === "ready").length;
  const needsReviewCount = (preview.data?.productReports ?? []).filter(report => report.status !== "ready").length;
  const toggle = (productId: number) => setSelectedIds(current => current.includes(productId) ? current.filter(id => id !== productId) : [...current, productId]);
  const selectVisibleProducts = () => setSelectedIds(visibleProducts.map(product => product.id));
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

  return <div className="space-y-4"><section className="rounded-2xl border border-[#d8e5de] bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><p className="flex items-center gap-2 font-bold text-[#183d35]"><Layers3 className="h-4 w-4 text-[#a47d40]" />تصدير Meta Catalog</p><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#f2f8f4] px-3 py-1.5 text-xs font-bold text-[#245b4d]">{selectedIds.length} منتج محدد</span><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${readyCount ? "bg-[#e4f3ea] text-[#17633b]" : "bg-[#f5f2eb] text-[#69736d]"}`}>{readyCount} جاهز</span>{needsReviewCount ? <span className="rounded-full bg-[#fff1de] px-3 py-1.5 text-xs font-bold text-[#a35d1c]">{needsReviewCount} يحتاج إصلاحًا</span> : null}<Button size="sm" variant="outline" onClick={onOpenSettings} className="border-[#d7e2dc] text-[#245b4d]"><Settings2 className="ml-1.5 h-3.5 w-3.5" />الإعدادات</Button></div></div><div className="mt-3 flex gap-2">{stepLabels.map((item, index) => <span key={item.id} className={`rounded-full px-3 py-1.5 text-xs ${step === item.id ? "bg-[#183d35] font-bold text-white" : index < stepLabels.findIndex(stepItem => stepItem.id === step) ? "bg-[#e9f4ef] text-[#21624d]" : "bg-[#f6f5f1] text-[#74817a]"}`}>{index + 1}. {item.label}</span>)}</div></section>

    {step === "select" ? <section className="rounded-2xl border border-[#d8e5de] bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-[#183d35]">المنتجات النشطة</h3><p className="mt-1 text-xs leading-5 text-[#68756e]">حدد منتجًا واحدًا أو أكثر. المسودات لا تظهر هنا ولا يمكن إرسالها إلى Meta.</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={selectVisibleProducts} disabled={!visibleProducts.length} className="border-[#b9d3c6] text-[#245b4d]">تحديد الكل ({visibleProducts.length})</Button><Button size="sm" variant="ghost" onClick={() => setSelectedIds([])} disabled={!selectedIds.length} className="text-[#7a5a25]">إلغاء التحديد</Button></div></div><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو الكود" className="mt-4 h-10 max-w-md rounded-xl border-[#d8e5de]" /><div className="mt-3 overflow-hidden rounded-2xl border border-[#e6ece8]"><div className="grid grid-cols-[34px_minmax(150px,1.2fr)_minmax(100px,.8fr)_78px_104px] gap-2 bg-[#f7faf8] px-3 py-2 text-xs font-bold text-[#587066]"><span></span><span>المنتج</span><span>القسم</span><span>الوسائط</span><span>الحالة</span></div>{products.isLoading ? <p className="p-4 text-xs text-[#718178]">جارٍ تحميل المنتجات النشطة…</p> : visibleProducts.length ? visibleProducts.map(product => { const selected = selectedSet.has(product.id); const hasSourceUpdate = Boolean(sourceUpdateByProduct.get(product.id)); return <div key={product.id} className={`grid grid-cols-[34px_minmax(150px,1.2fr)_minmax(100px,.8fr)_78px_104px] items-center gap-2 border-t border-[#edf0ee] px-3 py-3 text-xs ${selected ? "bg-[#f1f8f4]" : "bg-white"}`}><input aria-label={`تحديد ${product.name}`} type="checkbox" checked={selected} onChange={() => toggle(product.id)} className="h-4 w-4 accent-[#28604e]" /><button type="button" onClick={() => onOpenProduct(product.id)} className="min-w-0 text-right"><b className="block truncate text-[#28463b]">{product.name}</b><span className="block truncate text-[#76837c]">{product.productCode}</span></button><span className="truncate text-[#64786e]">{product.groupPath ?? "غير مصنف"}</span><span className="text-[#64786e]">{product.imageCount} ص · {product.videoCount} ف</span><span className={`rounded-full px-2 py-1 text-center font-bold ${hasSourceUpdate ? "bg-[#fff1de] text-[#a35d1c]" : product.preparedMediaCount >= product.imageCount && product.imageCount ? "bg-[#e4f3ea] text-[#17633b]" : "bg-[#fff1de] text-[#a35d1c]"}`}>{hasSourceUpdate ? "تحديث OneDrive" : product.preparedMediaCount >= product.imageCount && product.imageCount ? "وسائط جاهزة" : "تحتاج تجهيز"}</span></div>; }) : <p className="p-4 text-xs text-[#718178]">لا توجد منتجات نشطة مطابقة للبحث.</p>}</div><div className="mt-4 flex justify-end"><Button onClick={() => setStep("complete")} disabled={!selectedIds.length} className="bg-[#183d35] text-white hover:bg-[#245b4d]">فحص المنتجات المحددة ({selectedIds.length})<ChevronLeft className="mr-1.5 h-4 w-4" /></Button></div></section> : null}

    {step === "complete" || step === "review" ? <section className="rounded-2xl border border-[#d8e5de] bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-[#183d35]">{step === "complete" ? "فحص المنتج وتجهيز الوسائط" : "معاينة ما سيُرسل"}</h3><p className="mt-1 text-xs leading-5 text-[#68756e]">الاسم الرئيسي يبقى اسم المنتج؛ اللون والقياس يظهران في حقولهما المنفصلة داخل Meta.</p></div>{selectedAssetId ? <label className="text-xs font-bold text-[#4d6158]">الكتالوج المستهدف<select value={selectedAssetId} onChange={event => setCatalogAssetId(Number(event.target.value))} className="mt-1 block h-9 rounded-lg border border-[#d8e5de] bg-white px-2 text-xs text-[#30483e]">{readiness.data?.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.displayName ?? asset.externalId}</option>)}</select></label> : null}</div>{preview.isLoading ? <p className="mt-4 rounded-xl bg-[#f7faf8] p-3 text-xs text-[#718178]">جارٍ فحص المنتجات المختارة دون إرسال أي بيانات…</p> : preview.error ? <p className="mt-4 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs text-[#9c4b25]">تعذر فحص الدفعة: {preview.error.message}</p> : <div className="mt-4 space-y-2">{selectedProducts.map(product => { const report = reportByProduct.get(product.id); const isReady = report?.status === "ready"; return <article key={product.id} className={`rounded-xl border p-3 ${isReady ? "border-[#cce0d7] bg-[#f6fbf8]" : "border-[#efd9ba] bg-[#fffaf1]"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3">{report?.primaryImageUrl ? <img src={report.primaryImageUrl} alt={`معاينة ${report.metaTitle}`} className="h-14 w-14 rounded-xl object-cover" /> : null}<div><p className="font-bold text-[#28463b]">{report?.metaTitle ?? product.name} <span className="font-normal text-[#74817a]">— {product.productCode}</span></p><p className="mt-1 text-xs text-[#64786e]">الخامة: <b>{report?.material ?? product.material ?? "غير محددة"}</b> · سيُرسل {report?.imageCount ?? 0} صور و{report?.videoCount ?? 0} فيديو</p>{report?.issues.length ? <p className="mt-1 text-xs text-[#a35d1c]"><AlertCircle className="ml-1 inline h-3.5 w-3.5" />{reportMessage(report.issues)}</p> : null}</div></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onOpenProduct(product.id)} className="border-[#b9d3c6] text-[#245b4d]">{isReady ? "عرض المنتج" : "إصلاح المنتج"}</Button>{product.preparedMediaCount < product.imageCount + product.videoCount ? <Button size="sm" variant="outline" onClick={() => prepare.mutate({ productIds: [product.id] })} disabled={!canEdit || prepare.isPending} className="border-[#d5c29e] text-[#7a5a25]"><ImageUp className="ml-1 h-3.5 w-3.5" />تجهيز الوسائط</Button> : null}</div></div></article>; })}</div>}<div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-[#edf0ee] pt-4">{step === "complete" ? <Button variant="outline" onClick={() => setStep("select")} className="border-[#d8e5de] text-[#526a60]">تعديل الاختيار</Button> : <Button variant="outline" onClick={() => setStep("complete")} className="border-[#d8e5de] text-[#526a60]">عودة للفحص</Button>}{step === "complete" ? <Button onClick={() => { prepareSelection(); }} disabled={!canEdit || !selectedIds.length || prepare.isPending} className="bg-[#a47d40] text-white hover:bg-[#8f6b35]"><ImageUp className="ml-1.5 h-4 w-4" />{prepare.isPending ? "جارٍ التجهيز…" : "جهّز الوسائط وراجع"}</Button> : null}{step === "review" ? <Button onClick={submitSelected} disabled={!canEdit || !selectedAssetId || !readyCount || exportNow.isPending || !readiness.data?.capability?.enabled || readiness.data.capability.status !== "ready"} className="bg-[#183d35] text-white hover:bg-[#245b4d]"><Send className="ml-1.5 h-4 w-4" />{exportNow.isPending ? "جارٍ الإرسال…" : `تصدير ${readyCount} منتج جاهز إلى Meta`}</Button> : null}</div>{prepareResult ? <div className={`mt-3 rounded-xl p-3 text-xs ${prepareResult.skipped.length ? "border border-[#f0d6bc] bg-[#fff7ef] text-[#8f5527]" : "bg-[#eef7f2] text-[#21624d]"}`}><p className="font-bold"><CheckCircle2 className="ml-1 inline h-4 w-4" />تم تجهيز {prepareResult.prepared} وسيط.</p>{prepareResult.preparedItems.length ? <div className="mt-2 space-y-1">{prepareResult.preparedItems.map(item => <p key={`${item.productId}-${item.mediaId}`}><CheckCircle2 className="ml-1 inline h-3.5 w-3.5" />المنتج #{item.productId} · {item.mediaType === "image" ? "صورة" : "فيديو"} #{item.mediaId}: جاهز</p>)}</div> : null}{prepareResult.skipped.length ? <div className="mt-2 space-y-1">{prepareResult.skipped.map(item => <p key={`${item.productId}-${item.mediaId}`}><AlertCircle className="ml-1 inline h-3.5 w-3.5" />الوسيط #{item.mediaId}: {item.reason}</p>)}</div> : <p className="mt-1">لا توجد وسائط متخطاة في هذه العملية.</p>}</div> : null}{exportNow.data ? <p className="mt-3 rounded-xl bg-[#eef7f2] p-3 text-xs font-bold text-[#21624d]"><Sparkles className="ml-1 inline h-4 w-4" />تم إرسال {exportNow.data.snapshot.itemCount} عنصرًا من المنتجات النشطة المحددة إلى Meta.</p> : null}{exportNow.error ? <p className="mt-3 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs text-[#9c4b25]">{exportNow.error.message}</p> : null}</section> : null}
  </div>;
}
