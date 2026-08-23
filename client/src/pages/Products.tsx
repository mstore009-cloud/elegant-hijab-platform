import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  CloudCog,
  FolderInput,
  Layers3,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

type VariantDraft = {
  colorName: string;
  sizeLabel: string;
  inventoryQuantity: number;
};

const emptyVariant = (): VariantDraft => ({ colorName: "", sizeLabel: "", inventoryQuantity: 0 });

export default function Products() {
  const profile = trpc.access.myProfile.useQuery();
  const products = trpc.products.list.useQuery(undefined, { enabled: profile.isSuccess });
  const imports = trpc.products.importJobs.list.useQuery(undefined, { enabled: profile.isSuccess });
  const utils = trpc.useUtils();

  const [isComposerOpen, setComposerOpen] = useState(false);
  const [productCode, setProductCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);

  const canViewFinancials = profile.data?.canViewSensitiveFinancialData ?? false;
  const canCreate = profile.data?.permissions.includes("products.create") ?? false;
  const canManageInventory = profile.data?.permissions.includes("products.inventory.update") ?? false;
  const oneDriveStatus = trpc.integrations.oneDriveStatus.useQuery(undefined, { enabled: profile.isSuccess && canCreate });
  const catalogStatus = trpc.integrations.catalogSelectionStatus.useQuery(undefined, { enabled: profile.isSuccess && canCreate });
  const catalogFolders = trpc.integrations.catalogRootFolders.useQuery(undefined, {
    enabled: profile.isSuccess && canCreate && catalogStatus.data?.connected === true && catalogStatus.data.status === "connected",
  });
  const validVariants = useMemo(
    () => variants.filter(variant => variant.colorName.trim().length > 0),
    [variants],
  );

  const importFallback = trpc.products.importJobs.createManualFallback.useMutation({
    onSuccess: () => utils.products.importJobs.list.invalidate(),
  });
  const beginOneDriveConnect = trpc.integrations.beginOneDriveConnect.useMutation({
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
  });
  const beginCatalogSelection = trpc.integrations.beginCatalogSelection.useMutation({
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
  });
  const selectCatalogRoot = trpc.integrations.selectCatalogRoot.useMutation({
    onSuccess: async () => {
      await catalogStatus.refetch();
      await catalogFolders.refetch();
    },
  });
  const createProduct = trpc.products.create.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.products.list.invalidate(), utils.products.importJobs.list.invalidate()]);
      setComposerOpen(false);
      setProductCode("");
      setName("");
      setCategory("");
      setSellingPrice("");
      setCostPrice("");
      setVariants([emptyVariant()]);
    },
  });

  const updateVariant = (index: number, patch: Partial<VariantDraft>) => {
    setVariants(current => current.map((variant, itemIndex) => (
      itemIndex === index ? { ...variant, ...patch } : variant
    )));
  };

  const addProduct = () => {
    if (!productCode.trim() || !name.trim() || !sellingPrice || validVariants.length === 0) return;
    createProduct.mutate({
      productCode: productCode.trim(),
      name: name.trim(),
      category: category.trim() || undefined,
      sellingPrice,
      costPrice: canViewFinancials && costPrice ? costPrice : undefined,
      status: "draft",
      variants: validVariants,
    });
  };

  return (
    <div dir="rtl" className="mx-auto w-full min-w-0 max-w-7xl space-y-6 pb-10">
      <header className="flex flex-col gap-5 rounded-[2rem] bg-[#153d35] px-6 py-7 text-white shadow-[0_22px_50px_rgba(18,59,51,0.2)] sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <div>
          <div className="mb-3 flex w-fit items-center gap-2 rounded-full border border-[#f0d492]/25 bg-white/[0.08] px-3 py-1 text-xs text-[#f0d492]">
            <Layers3 className="h-3.5 w-3.5" />
            المنتجات والمتغيرات — AC-002
          </div>
          <h1 className="text-2xl font-bold">منتج واحد، ألوان وقياسات مستقلة، ومخزون يمكن الوثوق به.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#d6e3de]">لا يُعامل اللون كنص داخل الوصف؛ كل لون أو تركيبة لون وقياس لها كمية وحالة مستقلة وقابلة للتدقيق.</p>
        </div>
        <Button onClick={() => setComposerOpen(value => !value)} disabled={!canCreate} className="bg-[#f0d492] text-[#443719] hover:bg-[#f8e5b4]">
          <Plus className="ml-2 h-4 w-4" />
          إضافة منتج يدويًا
        </Button>
      </header>

      {!canManageInventory && profile.isSuccess && (
        <div className="flex gap-3 rounded-2xl border border-[#f0d6bc] bg-[#fff7ef] p-4 text-sm text-[#90502e]">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          لا تملك صلاحية المنتجات أو المخزون حاليًا. لا تعرض هذه الشاشة أي تكلفة أو هامش على الإطلاق.
        </div>
      )}

      {isComposerOpen && canCreate && (
        <section className="rounded-2xl border border-[#e8e2d5] bg-white p-6 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-[#243a34]">مسودة منتج جديدة</h2>
              <p className="mt-1 text-sm text-[#6a746e]">تُحفظ أولًا كمسودة؛ لا تصبح جاهزة للنشر قبل اكتمال البيانات والوسائط واعتماد الألوان.</p>
            </div>
            <Badge className="bg-[#f8f2e5] text-[#8a6a2d] hover:bg-[#f8f2e5]">مسودة</Badge>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-[#526158]">كود المنتج<Input value={productCode} onChange={event => setProductCode(event.target.value)} placeholder="مثال: HJB-001" className="mt-1.5" /></label>
            <label className="text-sm text-[#526158]">اسم المنتج<Input value={name} onChange={event => setName(event.target.value)} placeholder="اسم واضح للمنتج" className="mt-1.5" /></label>
            <label className="text-sm text-[#526158]">التصنيف<Input value={category} onChange={event => setCategory(event.target.value)} placeholder="حجابات، عبايات..." className="mt-1.5" /></label>
            <label className="text-sm text-[#526158]">سعر البيع<Input value={sellingPrice} inputMode="decimal" onChange={event => setSellingPrice(event.target.value)} placeholder="0" className="mt-1.5" /></label>
            {canViewFinancials && <label className="text-sm text-[#526158]">سعر التكلفة — حساس<Input value={costPrice} inputMode="decimal" onChange={event => setCostPrice(event.target.value)} placeholder="لا يظهر للموظفين" className="mt-1.5" /></label>}
          </div>

          <div className="mt-6 rounded-2xl bg-[#f8f7f2] p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-[#35483f]">المتغيرات والمخزون</h3>
                <p className="mt-1 text-xs text-[#738077]">أضف لونًا، ثم القياس عند وجوده. الكمية تخص هذه التركيبة وحدها.</p>
              </div>
              <Button variant="outline" onClick={() => setVariants(current => [...current, emptyVariant()])}><Plus className="ml-2 h-4 w-4" />لون أو قياس</Button>
            </div>
            <div className="mt-4 space-y-3">
              {variants.map((variant, index) => (
                <div key={index} className="grid gap-3 rounded-xl border border-[#e7e2d7] bg-white p-3 md:grid-cols-[1fr_1fr_150px_auto]">
                  <Input value={variant.colorName} onChange={event => updateVariant(index, { colorName: event.target.value })} placeholder="اللون" />
                  <Input value={variant.sizeLabel} onChange={event => updateVariant(index, { sizeLabel: event.target.value })} placeholder="القياس إن وجد" />
                  <Input type="number" min="0" value={variant.inventoryQuantity} onChange={event => updateVariant(index, { inventoryQuantity: Number(event.target.value) || 0 })} placeholder="الكمية" />
                  <Button variant="ghost" size="icon" disabled={variants.length === 1} onClick={() => setVariants(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="حذف المتغير"><Trash2 className="h-4 w-4 text-[#a96c51]" /></Button>
                </div>
              ))}
            </div>
          </div>

          {createProduct.error && <p className="mt-4 rounded-xl bg-[#fff4ed] p-3 text-sm text-[#9c4b25]">{createProduct.error.message}</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={addProduct} disabled={createProduct.isPending || !productCode.trim() || !name.trim() || !sellingPrice || validVariants.length === 0} className="bg-[#1f5b4f] hover:bg-[#153d35]">{createProduct.isPending ? "جارٍ حفظ المسودة..." : "حفظ المسودة"}</Button>
            <Button variant="outline" onClick={() => setComposerOpen(false)}>إلغاء</Button>
          </div>
        </section>
      )}

      <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-6 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-[#243a34]">كتالوج المنتجات</h2>
              <p className="mt-1 text-xs text-[#74817a]">سعر البيع متاح تشغيليًا؛ التكلفة والهامش لا يظهران إلا عند وجود التصريح.</p>
            </div>
            <Badge variant="outline">{products.data?.length ?? 0} منتج</Badge>
          </div>

          {products.isLoading && <div className="mt-5 h-44 animate-pulse rounded-xl bg-[#f6f5f0]" />}
          {products.error && <div className="mt-5 flex gap-3 rounded-xl bg-[#fff4ed] p-4 text-sm text-[#9c4b25]"><AlertCircle className="h-5 w-5 shrink-0" />{products.error.message}</div>}
          {!products.isLoading && !products.error && products.data?.length === 0 && (
            <div className="mt-5 rounded-2xl border border-dashed border-[#d9d1c1] bg-[#fcfbf8] px-5 py-10 text-center">
              <Layers3 className="mx-auto h-7 w-7 text-[#9a7b3e]" />
              <h3 className="mt-3 font-bold text-[#374a41]">لا توجد منتجات بعد</h3>
              <p className="mt-2 text-sm text-[#74817a]">ابدأ بمسودة يدوية أو جهّز اختبار OneDrive قبل ربطه بمنتج حقيقي.</p>
            </div>
          )}
          {!products.isLoading && !products.error && Boolean(products.data?.length) && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[620px] text-right text-sm">
                <thead className="border-b border-[#ebe4d7] text-xs text-[#7b837c]"><tr><th className="pb-3 font-medium">المنتج</th><th className="pb-3 font-medium">الحالة</th><th className="pb-3 font-medium">سعر البيع</th>{canViewFinancials && <th className="pb-3 font-medium">سعر التكلفة</th>}</tr></thead>
                <tbody>
                  {products.data?.map(product => (
                    <tr key={product.id} className="border-b border-[#f0ece4] last:border-0">
                      <td className="py-4"><p className="font-bold text-[#35483f]">{product.name}</p><p className="mt-1 text-xs text-[#7a837d]">{product.productCode}{product.category ? ` · ${product.category}` : ""}</p></td>
                      <td className="py-4"><Badge className="bg-[#edf5f1] text-[#1f5b4f] hover:bg-[#edf5f1]">{product.status === "draft" ? "مسودة" : product.status}</Badge></td>
                      <td className="py-4 font-semibold text-[#35483f]">{product.sellingPrice}</td>
                      {canViewFinancials && <td className="py-4 font-semibold text-[#35483f]">{"costPrice" in product ? product.costPrice ?? "—" : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="rounded-2xl bg-[#f7f3ea] p-6">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8d3a3] text-[#72551d]"><CloudCog className="h-5 w-5" /></span><div><h2 className="font-bold text-[#3b382d]">مسار OneDrive الآمن</h2><p className="text-xs text-[#766f60]">لا يُبنى أي اعتماد عليه قبل اختبار حي.</p></div></div>
          <div className="mt-5 rounded-xl border border-[#e1d8c7] bg-white/70 p-4"><p className="text-sm font-bold text-[#5b4d31]">{oneDriveStatus.isLoading ? "جارٍ فحص الاتصال..." : oneDriveStatus.data?.configured ? "الاتصال مهيأ للاختبار" : "المصادقة غير مهيأة بعد"}</p><p className="mt-2 text-xs leading-6 text-[#766f60]">{oneDriveStatus.data?.message ?? "سيظل الموصل منفصلًا، وسنبدأ باختبار حساب حقيقي ومجلد منتج واحد فقط عند توفر التفويض."}</p></div>
          <div className="mt-4 space-y-2 text-sm text-[#625c4e]"><p>1. تفويض الحساب وقراءة مجلد فعلي.</p><p>2. فحص الملفات والكود والنواقص دون نشر.</p><p>3. اعتماد النتيجة أو تسجيل فشل واضح.</p></div>
          {!oneDriveStatus.data?.configured && <Button onClick={() => beginOneDriveConnect.mutate()} disabled={!canCreate || beginOneDriveConnect.isPending} className="mt-5 w-full bg-[#1f5b4f] hover:bg-[#153d35]"><CloudCog className="ml-2 h-4 w-4" />{beginOneDriveConnect.isPending ? "جارٍ تجهيز الموافقة..." : "ربط مجلد OneDrive الخاص بالمنصة"}</Button>}
          {beginOneDriveConnect.error && <p className="mt-3 rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{beginOneDriveConnect.error.message}</p>}
          <div className="mt-5 rounded-xl border border-[#d7e2dc] bg-[#f4faf6] p-4">
            <p className="text-sm font-bold text-[#2d5a4d]">اختيار جذر Catalog — تجربة قراءة محدودة</p>
            <p className="mt-2 text-xs leading-6 text-[#5a766b]">بعد دخول Microsoft، تعرض المنصة مجلدات الجذر لاختيار مجلد باسم <bdi>Catalog</bdi> فقط. لا تحفظ كلمة المرور ولا تستورد أي منتج في هذه المرحلة.</p>
            {catalogStatus.data?.status === "catalog_selected" ? (
              <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-bold text-[#2d5a4d]">تم حفظ {catalogStatus.data.selectedFolderName} كمرجع كتالوج. ما زال الاستيراد نفسه يحتاج مراجعة منفصلة.</p>
            ) : catalogStatus.data?.connected ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[#5a766b]">اختر مجلد <bdi>Catalog</bdi> الظاهر أدناه فقط:</p>
                  <Button variant="ghost" size="sm" onClick={() => catalogFolders.refetch()} disabled={catalogFolders.isFetching} className="h-7 text-xs text-[#2d5a4d]"><RefreshCw className="ml-1 h-3.5 w-3.5" />تحديث</Button>
                </div>
                {catalogFolders.isLoading && <p className="text-xs text-[#5a766b]">جارٍ عرض مجلدات الجذر...</p>}
                {catalogFolders.error && <p className="rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{catalogFolders.error.message}</p>}
                {catalogFolders.data?.filter(folder => folder.name === "Catalog").map(folder => (
                  <Button key={folder.id} variant="outline" onClick={() => selectCatalogRoot.mutate({ folderId: folder.id })} disabled={selectCatalogRoot.isPending} className="w-full border-[#9dc2b2] bg-white text-[#2d5a4d] hover:bg-[#edf7f1]">
                    <FolderInput className="ml-2 h-4 w-4" />{selectCatalogRoot.isPending ? "جارٍ حفظ المرجع..." : "اعتماد Catalog كمرجع"}
                  </Button>
                ))}
                {catalogFolders.data && !catalogFolders.data.some(folder => folder.name === "Catalog") && (
                  <div className="rounded-lg bg-[#fff8e8] p-3 text-xs text-[#8a6327]">
                    <p>لم يظهر مجلد جذر باسم Catalog. لم يُحفظ أي مرجع.</p>
                    {catalogFolders.data.length > 0 && <p className="mt-2 text-[#6e6244]">المجلدات الظاهرة حاليًا: {catalogFolders.data.map(folder => folder.name).join("، ")}</p>}
                  </div>
                )}
              </div>
            ) : (
              <Button onClick={() => beginCatalogSelection.mutate()} disabled={!canCreate || beginCatalogSelection.isPending} className="mt-3 w-full bg-[#2d5a4d] hover:bg-[#21453a]">
                <FolderInput className="ml-2 h-4 w-4" />{beginCatalogSelection.isPending ? "جارٍ تجهيز دخول Microsoft..." : "تسجيل الدخول لاختيار Catalog"}
              </Button>
            )}
            {catalogStatus.data?.lastError && <p className="mt-3 rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{catalogStatus.data.lastError}</p>}
            {beginCatalogSelection.error && <p className="mt-3 rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{beginCatalogSelection.error.message}</p>}
            {selectCatalogRoot.error && <p className="mt-3 rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{selectCatalogRoot.error.message}</p>}
          </div>
          <Button variant="outline" onClick={() => importFallback.mutate({ sourceReference: "manual-fallback" })} disabled={!canCreate || importFallback.isPending} className="mt-3 w-full border-[#cdbf9f] bg-white text-[#6e5628] hover:bg-[#fffdf8]"><FolderInput className="ml-2 h-4 w-4" />{importFallback.isPending ? "جارٍ تسجيل البديل..." : "تسجيل إدخال يدوي بديل"}</Button>
          {imports.data?.length ? <div className="mt-4 space-y-2"><p className="text-xs font-bold text-[#746a55]">مهام الإدخال الأخيرة</p>{imports.data.slice(0, 3).map(job => <div key={job.id} className="rounded-lg bg-white/70 px-3 py-2 text-xs text-[#625c4e]"><span className="font-bold">{job.source === "manual" ? "يدوي" : "OneDrive"}</span> · {job.status}</div>)}</div> : null}
        </article>
      </section>
    </div>
  );
}
