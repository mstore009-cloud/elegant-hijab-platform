import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProductMediaPreview } from "@/components/ProductMediaPreview";
import { ProductListThumbnail } from "@/components/ProductListThumbnail";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, CloudCog, ImagePlus, PencilLine, RefreshCw, Save, TriangleAlert, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

const missingFieldLabels: Record<string, string> = {
  "product.txt": "ملف بيانات المنتج",
  name: "اسم المنتج",
  description: "الوصف",
  sellingPrice: "سعر البيع",
  sizes: "القياسات",
  images: "الصور",
  colors: "الألوان",
  inventory: "المخزون",
};

function fieldLabel(field: string) {
  return missingFieldLabels[field] ?? field;
}

function safeSizes(raw: string | null) {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function statusLabel(status: string) {
  return ({ draft: "مسودة", needs_review: "تحتاج مراجعة", ready: "جاهز للمراجعة", active: "نشط", archived: "مؤرشف" } as Record<string, string>)[status] ?? status;
}

export default function Products() {
  const profile = trpc.access.myProfile.useQuery();
  const products = trpc.products.list.useQuery(undefined, { enabled: profile.isSuccess });
  const syncStatus = trpc.catalogSync.status.useQuery(undefined, { enabled: profile.isSuccess });
  const canEdit = profile.data?.permissions.includes("products.edit") ?? false;
  const canCreate = profile.data?.permissions.includes("products.create") ?? false;
  const catalogStatus = trpc.integrations.catalogSelectionStatus.useQuery(undefined, { enabled: profile.isSuccess && canCreate });
  const catalogFolders = trpc.integrations.catalogRootFolders.useQuery(undefined, {
    enabled: profile.isSuccess && canCreate && catalogStatus.data?.connected === true && catalogStatus.data.status === "connected",
    staleTime: 5 * 60_000,
  });
  const utils = trpc.useUtils();
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const detailInput = useMemo(() => selectedProductId ? { productId: selectedProductId } : skipToken, [selectedProductId]);
  const selectedProduct = trpc.products.byId.useQuery(detailInput, { enabled: detailInput !== skipToken && profile.isSuccess });
  const selectedProductMedia = trpc.products.mediaPreviews.useQuery(detailInput, {
    enabled: detailInput !== skipToken && profile.isSuccess && selectedProduct.isSuccess,
    staleTime: 5 * 60_000,
  });
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [draftSizes, setDraftSizes] = useState("");
  const [draftStatus, setDraftStatus] = useState<"draft" | "needs_review" | "ready" | "archived">("draft");

  useEffect(() => {
    const product = selectedProduct.data?.product;
    if (!product) return;
    setDraftName(product.name);
    setDraftDescription(product.description ?? "");
    setDraftPrice(selectedProduct.data?.missingFields.includes("sellingPrice") ? "" : product.sellingPrice);
    setDraftSizes(safeSizes(product.sizeLabels).join("، "));
    const editableStatus = product.status === "active" ? "ready" : product.status;
    setDraftStatus(editableStatus === "draft" || editableStatus === "needs_review" || editableStatus === "ready" || editableStatus === "archived" ? editableStatus : "draft");
  }, [selectedProduct.data]);

  const invalidateProducts = async () => {
    await Promise.all([utils.products.list.invalidate(), utils.products.byId.invalidate(), utils.products.mediaPreviews.invalidate(), syncStatus.refetch()]);
  };
  const updateDetails = trpc.products.updateDetails.useMutation({ onSuccess: invalidateProducts });
  const uploadImage = trpc.products.uploadManualImage.useMutation({ onSuccess: invalidateProducts });
  const runCatalogScan = trpc.catalogSync.runNow.useMutation({ onSuccess: invalidateProducts });
  const beginCatalogSelection = trpc.integrations.beginCatalogSelection.useMutation({ onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl) });
  const selectCatalogRoot = trpc.integrations.selectCatalogRoot.useMutation({ onSuccess: () => catalogStatus.refetch() });

  const saveDetails = () => {
    if (!selectedProductId || !draftName.trim()) return;
    updateDetails.mutate({
      productId: selectedProductId,
      name: draftName.trim(),
      description: draftDescription.trim() || null,
      sellingPrice: draftPrice.trim() || undefined,
      sizeLabels: draftSizes.split(/[،,]/).map(size => size.trim()).filter(Boolean),
      status: draftStatus,
    });
  };

  const addImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedProductId) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64Data = result.split(",")[1];
      if (base64Data) uploadImage.mutate({ productId: selectedProductId, fileName: file.name, mimeType: file.type, base64Data });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div dir="rtl" className="mx-auto w-full max-w-7xl space-y-6 pb-10">
      <header className="overflow-hidden rounded-[2rem] bg-[#153d35] px-6 py-7 text-white shadow-[0_22px_50px_rgba(18,59,51,0.2)] sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex w-fit items-center gap-2 rounded-full border border-[#f0d492]/25 bg-white/[0.08] px-3 py-1 text-xs text-[#f0d492]"><CloudCog className="h-3.5 w-3.5" /> المنتجات — تشغيل تلقائي من Catalog</div>
            <h1 className="text-2xl font-bold">المسودات تصل هنا، والموظف يكمل ما ينقص فقط.</h1>
            <p className="mt-2 text-sm leading-6 text-[#d6e3de]">لا يحتاج الموظف اختيار مجلدات أو تحليلها يدويًا. يفحص النظام Catalog في الخلفية، ثم يحفظ المسودات والصور التشغيلية داخل المنصة.</p>
          </div>
          <Button onClick={() => runCatalogScan.mutate()} disabled={!canCreate || runCatalogScan.isPending} className="bg-[#f0d492] text-[#443719] hover:bg-[#f8e5b4]">
            <RefreshCw className={`ml-2 h-4 w-4 ${runCatalogScan.isPending ? "animate-spin" : ""}`} />
            {runCatalogScan.isPending ? "جارٍ فحص Catalog..." : "فحص Catalog الآن"}
          </Button>
        </div>
        <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 text-xs text-[#d6e3de] sm:grid-cols-3">
          <p><b className="text-[#f0d492]">الدورية:</b> كل 10 دقائق بعد نشر الموقع وتفعيلها.</p>
          <p><b className="text-[#f0d492]">المصدر:</b> قراءة فقط من OneDrive؛ لا تعديل للملفات.</p>
          <p><b className="text-[#f0d492]">آخر نتيجة:</b> {syncStatus.data?.lastSummary ? "فحص مسجل" : "لم يُشغّل بعد"}</p>
        </div>
      </header>

      {products.error && <div className="flex gap-3 rounded-2xl bg-[#fff4ed] p-4 text-sm text-[#9c4b25]"><AlertCircle className="h-5 w-5 shrink-0" />{products.error.message}</div>}
      {runCatalogScan.error && <div className="flex gap-3 rounded-2xl bg-[#fff4ed] p-4 text-sm text-[#9c4b25]"><AlertCircle className="h-5 w-5 shrink-0" />{runCatalogScan.error.message}</div>}
      {catalogStatus.data?.status !== "catalog_selected" && canCreate && <section className="rounded-2xl border border-[#ead7ad] bg-[#fffaf0] p-5 text-[#71552a]"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">إعداد Catalog لمرة واحدة</p><p className="mt-1 text-sm leading-6">لن يطلب النظام هذه الخطوة في العمل اليومي. اختر مجلد الجذر المسمى Catalog مرة واحدة، وبعدها يعمل الفحص التلقائي في الخلفية.</p></div>{!catalogStatus.data?.connected && <Button onClick={() => beginCatalogSelection.mutate()} disabled={beginCatalogSelection.isPending} className="bg-[#8a6327] hover:bg-[#70501f]">{beginCatalogSelection.isPending ? "جارٍ فتح الموافقة..." : "ربط Catalog"}</Button>}</div>{catalogStatus.data?.connected && <div className="mt-4 flex flex-wrap gap-2">{catalogFolders.isLoading && <p className="text-sm">جارٍ عرض مجلدات OneDrive...</p>}{catalogFolders.data?.filter(folder => folder.name === "Catalog").map(folder => <Button key={folder.id} variant="outline" onClick={() => selectCatalogRoot.mutate({ folderId: folder.id })} disabled={selectCatalogRoot.isPending} className="border-[#c89d52] text-[#71552a]">{selectCatalogRoot.isPending ? "جارٍ الحفظ..." : "اعتماد مجلد Catalog"}</Button>)}</div>}{(beginCatalogSelection.error || selectCatalogRoot.error || catalogFolders.error) && <p className="mt-3 text-sm text-[#9c4b25]">{beginCatalogSelection.error?.message ?? selectCatalogRoot.error?.message ?? catalogFolders.error?.message}</p>}</section>}

      <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-6 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="font-bold text-[#243a34]">كتالوج المنتجات</h2><p className="mt-1 text-xs text-[#74817a]">افتح المسودة لتعرف ما ينقص وتكمله من شاشة واحدة.</p></div>
            <Badge variant="outline">{products.isLoading ? "جارٍ التحميل..." : `${products.data?.length ?? 0} منتج`}</Badge>
          </div>
          {products.isLoading && <div className="mt-5 space-y-3"><div className="h-16 animate-pulse rounded-xl bg-[#f3f1eb]" /><div className="h-16 animate-pulse rounded-xl bg-[#f3f1eb]" /></div>}
          {!products.isLoading && !products.data?.length && <div className="mt-5 rounded-2xl border border-dashed border-[#d9d1c1] bg-[#fcfbf8] p-10 text-center"><CloudCog className="mx-auto h-7 w-7 text-[#9a7b3e]" /><h3 className="mt-3 font-bold text-[#374a41]">لا توجد مسودات بعد</h3><p className="mt-2 text-sm text-[#74817a]">أضف مجلد المنتج إلى Catalog ثم سيظهر هنا بعد الفحص الدوري.</p></div>}
          <div className="mt-5 space-y-3">
            {products.data?.map(product => (
              <button key={product.id} onClick={() => setSelectedProductId(product.id)} className={`w-full rounded-2xl border p-4 text-right transition ${selectedProductId === product.id ? "border-[#6a9988] bg-[#f4faf7]" : "border-[#ede8de] bg-white hover:border-[#bed8cc] hover:bg-[#fcfefc]"}`}>
                <div className="flex gap-3"><ProductListThumbnail imageUrl={product.primaryImageUrl} alt={product.primaryImageAlt ?? `صورة ${product.name}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="truncate font-bold text-[#35483f]">{product.name}</p><Badge className={product.missingFields.length ? "bg-[#fff2df] text-[#985d25] hover:bg-[#fff2df]" : "bg-[#edf5f1] text-[#1f5b4f] hover:bg-[#edf5f1]"}>{product.missingFields.length ? `${product.missingFields.length} نواقص` : statusLabel(product.status)}</Badge></div><p className="mt-1 text-xs text-[#7a837d]">{product.productCode}{product.category ? ` · ${product.category}` : ""} · {product.missingFields.includes("sellingPrice") ? "السعر ينقص" : `${product.sellingPrice} د.ع`}</p>{product.missingFields.length > 0 && <p className="mt-2 text-xs text-[#985d25]">ينقص: {product.missingFields.map(fieldLabel).join("، ")}</p>}</div></div>
              </button>
            ))}
          </div>
        </article>

        <aside className="rounded-2xl border border-[#d7e2dc] bg-[#f7fbf8] p-6 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          {!selectedProductId && <div className="grid min-h-80 place-items-center text-center"><div><PencilLine className="mx-auto h-8 w-8 text-[#6a9988]" /><h2 className="mt-3 font-bold text-[#304b40]">اختر منتجًا</h2><p className="mt-2 max-w-xs text-sm leading-6 text-[#6e7c74]">ستظهر هنا تفاصيل المسودة، قائمة نواقصها، وحقول الإكمال وإضافة الصور.</p></div></div>}
          {selectedProduct.isLoading && <p className="rounded-xl bg-white p-4 text-sm text-[#315549]">جارٍ فتح تفاصيل المنتج...</p>}
          {selectedProduct.data && <div className="space-y-5">
            <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3">{selectedProductMedia.data?.[0] && <img src={selectedProductMedia.data[0].dataUrl} alt={`صورة ${selectedProduct.data.product.name}`} className="h-16 w-12 rounded-lg border border-[#d8e7df] object-cover" />}<div><p className="text-xs text-[#63766d]">مسودة تشغيلية</p><h2 className="mt-1 text-xl font-bold text-[#243a34]">{selectedProduct.data.product.productCode}</h2></div></div><Button size="icon" variant="ghost" onClick={() => setSelectedProductId(null)} aria-label="إغلاق التفاصيل"><X className="h-4 w-4" /></Button></div>
            <div className={`rounded-xl border p-3 text-sm ${selectedProduct.data.missingFields.length ? "border-[#f0d6bc] bg-[#fff9f1] text-[#8a5328]" : "border-[#cfe1d7] bg-[#f2faf5] text-[#245946]"}`}>
              <div className="flex items-center gap-2 font-bold">{selectedProduct.data.missingFields.length ? <TriangleAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{selectedProduct.data.missingFields.length ? "عناصر تحتاج إكمالًا" : "لا توجد نواقص مسجلة"}</div>
              {selectedProduct.data.missingFields.length > 0 && <p className="mt-2 text-xs leading-6">{selectedProduct.data.missingFields.map(fieldLabel).join("، ")}</p>}
            </div>
            <div className="grid gap-4">
              <label className="text-sm text-[#526158]">اسم المنتج<Input value={draftName} onChange={event => setDraftName(event.target.value)} disabled={!canEdit} className="mt-1.5 bg-white" /></label>
              <label className="text-sm text-[#526158]">سعر البيع (د.ع)<Input inputMode="decimal" value={draftPrice} onChange={event => setDraftPrice(event.target.value)} disabled={!canEdit} placeholder="أدخل السعر" className="mt-1.5 bg-white" /></label>
              <label className="text-sm text-[#526158]">القياسات (افصل بفاصلة)<Input value={draftSizes} onChange={event => setDraftSizes(event.target.value)} disabled={!canEdit} placeholder="Medium، Large" className="mt-1.5 bg-white" /></label>
              <label className="text-sm text-[#526158]">الوصف<Textarea value={draftDescription} onChange={event => setDraftDescription(event.target.value)} disabled={!canEdit} placeholder="أضف وصف المنتج" className="mt-1.5 min-h-24 bg-white" /></label>
              <label className="text-sm text-[#526158]">حالة المسودة<select value={draftStatus} onChange={event => setDraftStatus(event.target.value as typeof draftStatus)} disabled={!canEdit} className="mt-1.5 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"><option value="draft">مسودة</option><option value="needs_review">تحتاج مراجعة</option><option value="ready">جاهزة للمراجعة</option><option value="archived">مؤرشفة</option></select></label>
            </div>
            {updateDetails.error && <p className="rounded-xl bg-[#fff4ed] p-3 text-sm text-[#9c4b25]">{updateDetails.error.message}</p>}
            <Button onClick={saveDetails} disabled={!canEdit || updateDetails.isPending || !draftName.trim()} className="w-full bg-[#1f5b4f] hover:bg-[#153d35]"><Save className="ml-2 h-4 w-4" />{updateDetails.isPending ? "جارٍ حفظ التعديلات..." : "حفظ تفاصيل المسودة"}</Button>
            <div className="rounded-xl border border-dashed border-[#b9d2c7] bg-white p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-bold text-[#315549]">إضافة صورة للمنتج</p><p className="mt-1 text-xs leading-5 text-[#64776e]">ارفع من الهاتف أو الكمبيوتر؛ تتحول الصورة إلى WebP داخل المنصة. لا تحتاج OneDrive للعمل.</p></div><label className="cursor-pointer"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={addImage} className="sr-only" disabled={!canEdit || uploadImage.isPending} /><span className="inline-flex h-10 items-center rounded-md border border-[#9dc2b2] px-3 text-sm font-medium text-[#2d5a4d]"><ImagePlus className="ml-2 h-4 w-4" />{uploadImage.isPending ? "جارٍ التحويل..." : "رفع صورة"}</span></label></div>{uploadImage.error && <p className="mt-3 text-xs text-[#9c4b25]">{uploadImage.error.message}</p>}</div>
            {selectedProductMedia.isLoading && <p className="rounded-xl bg-white p-3 text-sm text-[#315549]">جارٍ تحميل صور المنتج...</p>}
            {selectedProductMedia.data && <ProductMediaPreview media={selectedProductMedia.data} />}
          </div>}
        </aside>
      </section>
    </div>
  );
}
