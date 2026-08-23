import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductMediaPreview } from "@/components/ProductMediaPreview";
import { ProductListThumbnail } from "@/components/ProductListThumbnail";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
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
import { useEffect, useMemo, useState } from "react";

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
  const [selectedCatalogGroupId, setSelectedCatalogGroupId] = useState<string | null>(null);
  const [selectedCatalogProductId, setSelectedCatalogProductId] = useState<string | null>(null);
  const [directProductPreviewId, setDirectProductPreviewId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [integrationsReady, setIntegrationsReady] = useState(false);

  const canViewFinancials = profile.data?.canViewSensitiveFinancialData ?? false;
  const canCreate = profile.data?.permissions.includes("products.create") ?? false;
  const canManageInventory = profile.data?.permissions.includes("products.inventory.update") ?? false;
  useEffect(() => {
    if (products.isSuccess || products.isError) setIntegrationsReady(true);
  }, [products.isError, products.isSuccess]);
  const oneDriveStatus = trpc.integrations.oneDriveStatus.useQuery(undefined, { enabled: profile.isSuccess && canCreate && integrationsReady });
  const catalogStatus = trpc.integrations.catalogSelectionStatus.useQuery(undefined, {
    enabled: profile.isSuccess && canCreate && integrationsReady,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const catalogFolders = trpc.integrations.catalogRootFolders.useQuery(undefined, {
    enabled: profile.isSuccess && canCreate && catalogStatus.data?.connected === true && catalogStatus.data.status === "connected",
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const catalogGroups = trpc.integrations.catalogGroups.useQuery(undefined, {
    enabled: profile.isSuccess && canCreate && catalogStatus.data?.status === "catalog_selected",
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const catalogProductInput = useMemo(
    () => selectedCatalogGroupId ? { groupId: selectedCatalogGroupId } : skipToken,
    [selectedCatalogGroupId],
  );
  const catalogProducts = trpc.integrations.catalogProductFolders.useQuery(catalogProductInput, {
    enabled: profile.isSuccess && canCreate && catalogProductInput !== skipToken,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const catalogPreviewInput = useMemo(
    () => selectedCatalogGroupId && selectedCatalogProductId
      ? { groupId: selectedCatalogGroupId, productFolderId: selectedCatalogProductId }
      : skipToken,
    [selectedCatalogGroupId, selectedCatalogProductId],
  );
  const catalogPreview = trpc.integrations.previewCatalogProduct.useQuery(catalogPreviewInput, {
    enabled: profile.isSuccess && canCreate && catalogPreviewInput !== skipToken,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const directPreviewInput = useMemo(
    () => directProductPreviewId ? { productFolderId: directProductPreviewId } : skipToken,
    [directProductPreviewId],
  );
  const directCatalogPreview = trpc.integrations.previewDirectCatalogProduct.useQuery(directPreviewInput, {
    enabled: profile.isSuccess && canCreate && directPreviewInput !== skipToken,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const productDetailInput = useMemo(() => selectedProductId ? { productId: selectedProductId } : skipToken, [selectedProductId]);
  const selectedProduct = trpc.products.byId.useQuery(productDetailInput, {
    enabled: profile.isSuccess && canManageInventory && productDetailInput !== skipToken,
  });
  const selectedProductMedia = trpc.products.mediaPreviews.useQuery(productDetailInput, {
    enabled: profile.isSuccess && canManageInventory && productDetailInput !== skipToken && selectedProduct.isSuccess && (selectedProduct.data?.media.length ?? 0) > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const generateOperationalMedia = trpc.products.generateOperationalMedia.useMutation({
    onSuccess: async () => {
      await Promise.all([selectedProduct.refetch(), selectedProductMedia.refetch()]);
    },
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
  const createCatalogDraft = trpc.integrations.createCatalogDraft.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.products.list.invalidate(), utils.products.importJobs.list.invalidate()]);
    },
  });
  const analyzeCatalogColors = trpc.integrations.analyzeCatalogProductColors.useMutation();
  const previewCatalogImages = trpc.integrations.previewCatalogProductImages.useMutation();
  const createApprovedCatalogColors = trpc.integrations.createApprovedCatalogColorVariants.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.products.list.invalidate(), utils.products.importJobs.list.invalidate()]);
    },
  });
  const attachCatalogImageReferences = trpc.integrations.attachApprovedCatalogImageReferences.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.products.list.invalidate(), utils.products.importJobs.list.invalidate()]);
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
            <Badge variant="outline">{products.isLoading ? "جارٍ تحميل الكتالوج..." : `${products.data?.length ?? 0} منتج`}</Badge>
          </div>

          {products.isLoading && <div className="mt-5 rounded-xl bg-[#f6f5f0] p-5"><div className="h-5 w-40 animate-pulse rounded bg-[#e9e7df]" /><div className="mt-3 h-16 animate-pulse rounded bg-[#eeece5]" /><p className="mt-4 text-xs text-[#74817a]">جارٍ تحميل قائمة المنتجات؛ لا تحتاج إلى انتظار OneDrive لعرض المسودات.</p></div>}
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
                    <tr key={product.id} onClick={() => setSelectedProductId(product.id)} className="cursor-pointer border-b border-[#f0ece4] transition-colors hover:bg-[#f7fbf8] last:border-0">
                      <td className="py-4"><div className="flex items-center gap-3"><ProductListThumbnail imageUrl={product.primaryImageUrl} alt={product.primaryImageAlt ?? `صورة ${product.name}`} /><div><p className="font-bold text-[#35483f]">{product.name}</p><p className="mt-1 text-xs text-[#7a837d]">{product.productCode}{product.category ? ` · ${product.category}` : ""}</p></div></div></td>
                      <td className="py-4"><Badge className="bg-[#edf5f1] text-[#1f5b4f] hover:bg-[#edf5f1]">{product.status === "draft" ? "مسودة" : product.status}</Badge></td>
                      <td className="py-4 font-semibold text-[#35483f]">{product.sellingPrice}</td>
                      {canViewFinancials && <td className="py-4 font-semibold text-[#35483f]">{"costPrice" in product ? product.costPrice ?? "—" : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selectedProduct.isLoading && <div className="mt-5 rounded-xl bg-[#f7fbf8] p-4 text-sm text-[#315549]">جارٍ فتح تفاصيل المنتج...</div>}
          {selectedProduct.error && <div className="mt-5 rounded-xl bg-[#fff4ed] p-4 text-sm text-[#9c4b25]">{selectedProduct.error.message}</div>}
          {selectedProduct.data && <section className="mt-5 space-y-4 rounded-2xl border border-[#cfe1d7] bg-[#f7fbf8] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {selectedProductMedia.data?.[0] && <img src={selectedProductMedia.data[0].dataUrl} alt={`صورة ${selectedProductMedia.data[0].colorName}`} className="h-16 w-12 rounded-lg border border-[#d8e7df] object-cover" />}
                <div><p className="text-xs text-[#63766d]">تفاصيل داخلية — لا تعني النشر</p><h3 className="mt-1 text-lg font-bold text-[#243a34]">{selectedProduct.data.product.name}</h3><p className="mt-1 text-sm text-[#63766d]">{selectedProduct.data.product.productCode} · {selectedProduct.data.product.category ?? "غير مصنف"} · {selectedProduct.data.product.status === "draft" ? "مسودة للمراجعة" : selectedProduct.data.product.status}</p></div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setSelectedProductId(null)}>إغلاق التفاصيل</Button>
            </div>
            <p className="text-sm leading-6 text-[#405c50]">{selectedProduct.data.product.description || "لا يوجد وصف."}</p>
            {selectedProductMedia.isLoading && <p className="rounded-xl bg-white p-3 text-sm text-[#315549]">جارٍ جلب مصغرات الصور الخفيفة من OneDrive؛ الأصل العالي لا يُعدّل.</p>}
            {selectedProductMedia.error && <p className="rounded-xl bg-[#fff4ed] p-3 text-sm text-[#9c4b25]">{selectedProductMedia.error.message}</p>}
            {selectedProductMedia.data && <ProductMediaPreview media={selectedProductMedia.data} />}
            {selectedProduct.data.media.some(media => media.source === "onedrive" && !media.storageKey) && (
              <Button size="sm" variant="outline" onClick={() => generateOperationalMedia.mutate({ productId: selectedProduct.data.product.id })} disabled={generateOperationalMedia.isPending} className="border-[#9dc2b2] text-[#2d5a4d] hover:bg-[#edf7f1]">
                {generateOperationalMedia.isPending ? "جارٍ إنشاء النسخ الخفيفة..." : "إنشاء نسخ تشغيلية خفيفة"}
              </Button>
            )}
            {generateOperationalMedia.error && <p className="rounded-xl bg-[#fff4ed] p-3 text-sm text-[#9c4b25]">{generateOperationalMedia.error.message}</p>}
          </section>}
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
              <div className="mt-3 space-y-3 rounded-lg bg-white p-3">
                <p className="text-xs font-bold text-[#2d5a4d]">تم حفظ {catalogStatus.data.selectedFolderName} كمرجع. اختر الآن منتجًا واحدًا للمعاينة فقط.</p>
                {catalogGroups.isLoading && <p className="text-xs text-[#5a766b]">جارٍ عرض مجموعات Catalog من OneDrive. قد تستغرق القراءة حتى 20 ثانية؛ لا تعيد تحميل الصفحة.</p>}
                {catalogGroups.error && <p className="rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{catalogGroups.error.message}</p>}
                {catalogGroups.data && (
                  <div className="flex flex-wrap gap-2">
                    {catalogGroups.data.map(group => <Button key={group.id} size="sm" variant={selectedCatalogGroupId === group.id ? "default" : "outline"} onClick={() => { setSelectedCatalogGroupId(group.id); setSelectedCatalogProductId(null); setDirectProductPreviewId(null); }} className={selectedCatalogGroupId === group.id ? "bg-[#2d5a4d] hover:bg-[#21453a]" : "border-[#9dc2b2] text-[#2d5a4d]"}>{group.name}</Button>)}
                  </div>
                )}
                {selectedCatalogGroupId && <div className="space-y-2 border-t border-[#e5eee8] pt-3">
                  <p className="text-xs text-[#5a766b]">مجلدات المنتجات في المجموعة:</p>
                  {catalogProducts.isLoading && <p className="text-xs text-[#5a766b]">جارٍ عرض مجلدات المنتجات من OneDrive. انتظر حتى 20 ثانية؛ لا تعيد تحميل الصفحة.</p>}
                  {catalogProducts.error && <p className="rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{catalogProducts.error.message}</p>}
                  {catalogProducts.data?.products.map(product => <Button key={product.id} size="sm" variant={selectedCatalogProductId === product.id ? "default" : "outline"} onClick={() => setSelectedCatalogProductId(product.id)} className={selectedCatalogProductId === product.id ? "bg-[#72551d] hover:bg-[#5c4417]" : "border-[#d9c490] text-[#72551d]"}>{product.name}</Button>)}
                  {catalogProducts.data && catalogProducts.data.products.length === 0 && <Button size="sm" variant="outline" onClick={() => setDirectProductPreviewId(catalogProducts.data!.group.id)} className="border-[#d9b17a] text-[#8b552b] hover:bg-[#fff7ed]">معاينة {catalogProducts.data.group.name} كمجلد منتج مباشر — اختبار فقط</Button>}
                </div>}
                {catalogPreview.isLoading && <p className="text-xs text-[#5a766b]">جارٍ قراءة product.txt والصور الوصفية دون حفظ. تنتهي المحاولة بخطأ واضح خلال 20 ثانية إذا لم يستجب OneDrive.</p>}
                {catalogPreview.error && <p className="rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{catalogPreview.error.message}</p>}
                {catalogPreview.data && <div className="space-y-2 rounded-lg border border-[#d7e2dc] bg-[#f9fcfa] p-3 text-xs text-[#405c50]">
                  <p><b>المجموعة:</b> {catalogPreview.data.group.name} · <b>الكود:</b> {catalogPreview.data.product.productCode}</p>
                  <p><b>ملف البيانات:</b> {catalogPreview.data.metadata?.fileName ?? "غير موجود"} · <b>الصور:</b> {catalogPreview.data.images.length}</p>
                  {catalogPreview.data.metadata?.content && <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-white p-2 text-right leading-5 text-[#405c50]">{catalogPreview.data.metadata.content}</pre>}
                  <p className="font-bold text-[#72551d]">هذه معاينة قراءة فقط؛ لم يُنشأ أي منتج ولم تُنقل أي صورة.</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button size="sm" variant="outline" onClick={() => selectedCatalogGroupId && selectedCatalogProductId && previewCatalogImages.mutate({ groupId: selectedCatalogGroupId, productFolderId: selectedCatalogProductId })} disabled={previewCatalogImages.isPending} className="w-full border-[#9dc2b2] text-[#2d5a4d] hover:bg-[#edf7f1] sm:w-auto">{previewCatalogImages.isPending ? "جارٍ تجهيز المعاينة الخفيفة..." : "عرض معاينة الصور الخفيفة"}</Button>
                    <Button size="sm" variant="outline" onClick={() => selectedCatalogGroupId && selectedCatalogProductId && analyzeCatalogColors.mutate({ groupId: selectedCatalogGroupId, productFolderId: selectedCatalogProductId })} disabled={analyzeCatalogColors.isPending} className="w-full border-[#9dc2b2] text-[#2d5a4d] hover:bg-[#edf7f1] sm:w-auto">{analyzeCatalogColors.isPending ? "جارٍ تحليل الألوان للمراجعة..." : "اقتراح ألوان الصور للمراجعة"}</Button>
                    <Button size="sm" onClick={() => selectedCatalogGroupId && selectedCatalogProductId && createCatalogDraft.mutate({ groupId: selectedCatalogGroupId, productFolderId: selectedCatalogProductId })} disabled={createCatalogDraft.isPending} className="w-full bg-[#1f5b4f] hover:bg-[#153d35] sm:w-auto">{createCatalogDraft.isPending ? "جارٍ إنشاء المسودة..." : "إنشاء مسودة داخلية للمراجعة"}</Button>
                  </div>
                  {previewCatalogImages.isPending && <p className="rounded-md bg-[#f1f8f4] p-2 text-[#315549]">يجري جلب مصغرات خفيفة فقط؛ يبقى الأصل عالي الجودة في OneDrive دون تعديل.</p>}
                  {previewCatalogImages.error && <p className="rounded-md bg-[#fff4ed] p-2 text-[#9c4b25]">{previewCatalogImages.error.message}</p>}
                  {previewCatalogImages.data && <div className="space-y-3 rounded-md border border-[#d8e7df] bg-[#f7fbf8] p-3 text-[#315549]"><p className="font-bold">معاينة تشغيلية خفيفة — {previewCatalogImages.data.previewedCount} من {previewCatalogImages.data.imageCount} صورة</p><p className="text-xs">هذه مصغرات OneDrive للمعاينة فقط. الأصل عالي الجودة لم يُعدّل ولم تُنشأ وسائط في المنصة.</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{previewCatalogImages.data.images.map(image => <figure key={image.sourceFileId} className="overflow-hidden rounded-lg border border-[#d8e7df] bg-white"><img src={image.dataUrl} alt={`مصغرة ${image.sourceFileName}`} className="aspect-[3/4] w-full object-cover" loading="lazy" /><figcaption className="truncate p-2 text-xs" title={image.sourceFileName}>{image.sourceFileName}</figcaption></figure>)}</div></div>}
                  {analyzeCatalogColors.isPending && <p className="rounded-md bg-[#f1f8f4] p-2 text-[#315549]">يجري جلب مصغرات الصور وتحليلها. لا تنشئ العملية ألوانًا أو مخزونًا أو وسائط، ولا تحتاج إلى إعادة تحميل الصفحة.</p>}
                  {analyzeCatalogColors.error && <p className="rounded-md bg-[#fff4ed] p-2 text-[#9c4b25]">{analyzeCatalogColors.error.message}</p>}
                  {analyzeCatalogColors.data && <div className="space-y-2 rounded-md border border-[#d8e7df] bg-[#f1f8f4] p-3 text-[#315549]"><p className="font-bold">اقتراحات الألوان — تحتاج اعتمادك</p>{analyzeCatalogColors.data.colorGroups.map((group, index) => <p key={`${group.colorNameArabic}-${index}`}><b>{group.colorNameArabic}</b> · ثقة {Math.round(group.confidence * 100)}٪ · الصور: {group.imageFileNames.join("، ")}<br />{group.reviewNote}</p>)}{analyzeCatalogColors.data.uncertainImageFileNames.length > 0 && <p className="text-[#8a6327]">صور تحتاج حسمًا: {analyzeCatalogColors.data.uncertainImageFileNames.join("، ")}</p>}<p className="font-bold text-[#72551d]">{analyzeCatalogColors.data.overallReviewNote} لا تُحفظ هذه الاقتراحات ولا تنشئ مخزونًا قبل مراجعتك.</p><Button size="sm" onClick={() => selectedCatalogGroupId && selectedCatalogProductId && createApprovedCatalogColors.mutate({ groupId: selectedCatalogGroupId, productFolderId: selectedCatalogProductId, colorNames: analyzeCatalogColors.data.colorGroups.map(group => group.colorNameArabic) })} disabled={createApprovedCatalogColors.isPending} className="w-full bg-[#72551d] hover:bg-[#5c4417]">{createApprovedCatalogColors.isPending ? "جارٍ إنشاء متغيرات اللون..." : "إنشاء متغيرات الألوان المعتمدة"}</Button><Button size="sm" variant="outline" onClick={() => selectedCatalogGroupId && selectedCatalogProductId && attachCatalogImageReferences.mutate({ groupId: selectedCatalogGroupId, productFolderId: selectedCatalogProductId, links: analyzeCatalogColors.data.colorGroups.flatMap(group => group.imageFileNames[0] ? [{ colorName: group.colorNameArabic, imageFileName: group.imageFileNames[0] }] : []) })} disabled={attachCatalogImageReferences.isPending} className="w-full border-[#2d5a4d] text-[#2d5a4d] hover:bg-[#edf7f1]">{attachCatalogImageReferences.isPending ? "جارٍ ربط المراجع..." : "ربط مراجع الصور بالألوان"}</Button>{createApprovedCatalogColors.error && <p className="rounded-md bg-[#fff4ed] p-2 text-[#9c4b25]">{createApprovedCatalogColors.error.message}</p>}{createApprovedCatalogColors.data && <p className="rounded-md bg-[#edf7f1] p-2 font-bold text-[#1f5b4f]">تمت إضافة الألوان: {createApprovedCatalogColors.data.createdColorNames.join("، ") || "لا شيء جديد"}. المخزون الابتدائي صفر، ولم تُنشأ وسائط.</p>}{attachCatalogImageReferences.error && <p className="rounded-md bg-[#fff4ed] p-2 text-[#9c4b25]">{attachCatalogImageReferences.error.message}</p>}{attachCatalogImageReferences.data && <p className="rounded-md bg-[#edf7f1] p-2 font-bold text-[#1f5b4f]">تم ربط {attachCatalogImageReferences.data.attached.length} مرجع صورة. لم تُنسخ الملفات الأصلية ولم تُنشأ نسخ تشغيلية.</p>}</div>}
                  {createCatalogDraft.error && <p className="rounded-md bg-[#fff4ed] p-2 text-[#9c4b25]">{createCatalogDraft.error.message}</p>}
                  {createCatalogDraft.data && <p className="rounded-md bg-[#edf7f1] p-2 font-bold text-[#1f5b4f]">{createCatalogDraft.data.created ? `تم إنشاء مسودة ${createCatalogDraft.data.productCode}.` : `المسودة ${createCatalogDraft.data.productCode} موجودة مسبقًا؛ لم يُنشأ تكرار.`} لم تُنشأ ألوان أو مخزون أو وسائط.</p>}
                </div>}
                {directCatalogPreview.isLoading && <p className="text-xs text-[#5a766b]">جارٍ قراءة المجلد المباشر كمعاينة تشخيصية...</p>}
                {directCatalogPreview.error && <p className="rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{directCatalogPreview.error.message}</p>}
                {directCatalogPreview.data && <div className="space-y-2 rounded-lg border border-[#ead1ad] bg-[#fffaf2] p-3 text-xs text-[#6e532b]">
                  <p className="font-bold">{directCatalogPreview.data.structureWarning}</p>
                  <p><b>الكود من اسم المجلد:</b> {directCatalogPreview.data.product.productCode}</p>
                  <p><b>ملف البيانات:</b> {directCatalogPreview.data.metadata?.fileName ?? "غير موجود"} · <b>الصور:</b> {directCatalogPreview.data.images.length}</p>
                  {directCatalogPreview.data.metadata?.content && <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-white p-2 text-right leading-5 text-[#6e532b]">{directCatalogPreview.data.metadata.content}</pre>}
                  <p className="font-bold">لم يُنشأ منتج ولم تُنقل صورة؛ هذه القراءة لا تعتمد هذا المسار الشاذ.</p>
                </div>}
              </div>
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
