import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { skipToken } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ImageUp, LoaderCircle, Save, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Props = {
  selectedProductId: number | null;
  activeProductIds: number[];
  canEdit: boolean;
};

type SettingsForm = {
  brand: string;
  currency: "IQD" | "USD";
  condition: "new" | "refurbished" | "used";
  defaultFbProductCategory: string;
  defaultGoogleProductCategory: string;
  defaultGender: "female" | "male" | "unisex";
  defaultAgeGroup: "newborn" | "infant" | "toddler" | "kids" | "teen" | "adult" | "all ages";
  productLinkBaseUrl: string;
  defaultProductType: string;
  defaultAvailability: "in stock" | "out of stock" | "available for order" | "discontinued";
};
type ProductForm = {
  fbProductCategory: string;
  googleProductCategory: string;
  material: string;
  pattern: string;
  gender: string;
  ageGroup: string;
  productType: string;
  productLink: string;
  exportEnabled: boolean;
};

const emptySettings: SettingsForm = {
  brand: "", currency: "IQD", condition: "new", defaultFbProductCategory: "Clothing & Accessories", defaultGoogleProductCategory: "", defaultGender: "female", defaultAgeGroup: "adult", productLinkBaseUrl: "", defaultProductType: "", defaultAvailability: "in stock",
};
const emptyProduct: ProductForm = { fbProductCategory: "", googleProductCategory: "", material: "", pattern: "", gender: "", ageGroup: "", productType: "", productLink: "", exportEnabled: true };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block text-xs font-bold text-[#4d6158]"><span>{label}</span>{hint ? <span className="mr-1 font-normal text-[#849087]">{hint}</span> : null}<div className="mt-1.5">{children}</div></label>;
}

function metaGender(value: string): "female" | "male" | "unisex" | null { return ["female", "male", "unisex"].includes(value) ? value as "female" | "male" | "unisex" : null; }
function metaAgeGroup(value: string): "newborn" | "infant" | "toddler" | "kids" | "teen" | "adult" | "all ages" | null { return ["newborn", "infant", "toddler", "kids", "teen", "adult", "all ages"].includes(value) ? value as "newborn" | "infant" | "toddler" | "kids" | "teen" | "adult" | "all ages" : null; }

export function MetaCatalogEnrichmentPanel({ selectedProductId, activeProductIds, canEdit }: Props) {
  const utils = trpc.useUtils();
  const settings = trpc.metaCatalog.settings.useQuery();
  const productInput = useMemo(() => selectedProductId ? { productId: selectedProductId } : skipToken, [selectedProductId]);
  const product = trpc.metaCatalog.productEnrichment.useQuery(productInput, { enabled: productInput !== skipToken });
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(emptySettings);
  const [productForm, setProductForm] = useState<ProductForm>(emptyProduct);
  const saveSettings = trpc.metaCatalog.saveSettings.useMutation({ onSuccess: () => void utils.metaCatalog.settings.invalidate() });
  const saveProduct = trpc.metaCatalog.saveProductEnrichment.useMutation({ onSuccess: () => { void utils.metaCatalog.productEnrichment.invalidate(); void utils.metaCatalog.preview.invalidate(); } });
  const prepareProduct = trpc.metaCatalog.prepareProductMedia.useMutation({ onSuccess: () => void utils.metaCatalog.preview.invalidate() });
  const prepareActive = trpc.metaCatalog.prepareProductsMedia.useMutation({ onSuccess: () => void utils.metaCatalog.preview.invalidate() });

  useEffect(() => {
    if (!settings.data) return;
    setSettingsForm({
      brand: settings.data.brand ?? "", currency: settings.data.currency === "USD" ? "USD" : "IQD", condition: settings.data.condition ?? "new", defaultFbProductCategory: settings.data.defaultFbProductCategory ?? "", defaultGoogleProductCategory: settings.data.defaultGoogleProductCategory ?? "", defaultGender: settings.data.defaultGender ?? "female", defaultAgeGroup: settings.data.defaultAgeGroup ?? "adult", productLinkBaseUrl: settings.data.productLinkBaseUrl ?? "", defaultProductType: settings.data.defaultProductType ?? "", defaultAvailability: settings.data.defaultAvailability ?? "in stock",
    });
  }, [settings.data]);
  useEffect(() => {
    if (!product.data) { setProductForm(emptyProduct); return; }
    setProductForm({
      fbProductCategory: product.data.fbProductCategory ?? "", googleProductCategory: product.data.googleProductCategory ?? "", material: product.data.material ?? "", pattern: product.data.pattern ?? "", gender: product.data.gender ?? "", ageGroup: product.data.ageGroup ?? "", productType: product.data.productType ?? "", productLink: product.data.productLink ?? "", exportEnabled: product.data.exportEnabled,
    });
  }, [product.data]);

  const saveStoreSettings = () => saveSettings.mutate({ ...settingsForm, brand: settingsForm.brand || null, defaultFbProductCategory: settingsForm.defaultFbProductCategory || null, defaultGoogleProductCategory: settingsForm.defaultGoogleProductCategory || null, productLinkBaseUrl: settingsForm.productLinkBaseUrl || null, defaultProductType: settingsForm.defaultProductType || null });
  const saveProductFields = () => selectedProductId && saveProduct.mutate({ productId: selectedProductId, fbProductCategory: productForm.fbProductCategory || null, googleProductCategory: productForm.googleProductCategory || null, material: productForm.material || null, pattern: productForm.pattern || null, gender: metaGender(productForm.gender), ageGroup: metaAgeGroup(productForm.ageGroup), productType: productForm.productType || null, productLink: productForm.productLink || null, exportEnabled: productForm.exportEnabled });
  const fieldClass = "h-10 rounded-xl border-[#d8e5de] bg-white text-sm";

  return <div className="mt-4 space-y-4">
    <section className="rounded-2xl border border-[#d9e7df] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 font-bold text-[#183d35]"><SlidersHorizontal className="h-4 w-4 text-[#a47d40]" />إعدادات إثراء Meta Catalog</p><p className="mt-1 max-w-3xl text-xs leading-5 text-[#68756e]">تُطبّق هذه القيم على المنتجات النشطة في هذا المتجر فقط. يمكن لأي منتج أن يستثني الفئة أو الخامة أو الرابط من قسمه الخاص.</p></div>{settings.data?.updatedAt ? <span className="rounded-full bg-[#f1f8f4] px-2.5 py-1 text-xs text-[#35634f]">إعداد متجر محفوظ</span> : null}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="العلامة التجارية"><Input value={settingsForm.brand} onChange={event => setSettingsForm(current => ({ ...current, brand: event.target.value }))} placeholder="مثال: عالم الحجابات الأنيقة" disabled={!canEdit} className={fieldClass} /></Field>
        <Field label="العملة"><select value={settingsForm.currency} onChange={event => setSettingsForm(current => ({ ...current, currency: event.target.value as SettingsForm["currency"] }))} disabled={!canEdit} className={`${fieldClass} w-full px-3`}><option value="IQD">الدينار العراقي (IQD)</option><option value="USD">الدولار الأميركي (USD)</option></select></Field>
        <Field label="حالة المنتج"><select value={settingsForm.condition} onChange={event => setSettingsForm(current => ({ ...current, condition: event.target.value as SettingsForm["condition"] }))} disabled={!canEdit} className={`${fieldClass} w-full px-3`}><option value="new">جديد</option><option value="refurbished">مجدّد</option><option value="used">مستعمل</option></select></Field>
        <Field label="Facebook Product Category"><Input value={settingsForm.defaultFbProductCategory} onChange={event => setSettingsForm(current => ({ ...current, defaultFbProductCategory: event.target.value }))} placeholder="Clothing & Accessories" disabled={!canEdit} className={fieldClass} /></Field>
        <Field label="الفئة العمرية"><select value={settingsForm.defaultAgeGroup} onChange={event => setSettingsForm(current => ({ ...current, defaultAgeGroup: event.target.value as SettingsForm["defaultAgeGroup"] }))} disabled={!canEdit} className={`${fieldClass} w-full px-3`}><option value="adult">بالغون</option><option value="teen">يافعون</option><option value="kids">أطفال</option><option value="all ages">كل الأعمار</option></select></Field>
        <Field label="الجنس"><select value={settingsForm.defaultGender} onChange={event => setSettingsForm(current => ({ ...current, defaultGender: event.target.value as SettingsForm["defaultGender"] }))} disabled={!canEdit} className={`${fieldClass} w-full px-3`}><option value="female">نساء</option><option value="male">رجال</option><option value="unisex">للجميع</option></select></Field>
        <Field label="رابط واجهة المتجر العامة" hint="يُبنى منه /store/code"><Input value={settingsForm.productLinkBaseUrl} onChange={event => setSettingsForm(current => ({ ...current, productLinkBaseUrl: event.target.value }))} placeholder="https://eleganthijab-efpivkpx.manus.space" disabled={!canEdit} className={fieldClass} /></Field>
        <Field label="نوع المنتج الافتراضي"><Input value={settingsForm.defaultProductType} onChange={event => setSettingsForm(current => ({ ...current, defaultProductType: event.target.value }))} placeholder="Clothing & Accessories > Hijabs" disabled={!canEdit} className={fieldClass} /></Field>
        <Field label="التوفر الافتراضي"><select value={settingsForm.defaultAvailability} onChange={event => setSettingsForm(current => ({ ...current, defaultAvailability: event.target.value as SettingsForm["defaultAvailability"] }))} disabled={!canEdit} className={`${fieldClass} w-full px-3`}><option value="in stock">متوفر</option><option value="available for order">متاح للطلب</option><option value="out of stock">غير متوفر</option><option value="discontinued">متوقف</option></select></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2"><Button onClick={saveStoreSettings} disabled={!canEdit || saveSettings.isPending} className="bg-[#183d35] text-white hover:bg-[#245b4d]"><Save className="ml-1.5 h-4 w-4" />{saveSettings.isPending ? "جارٍ الحفظ…" : "حفظ إعدادات المتجر"}</Button>{saveSettings.error ? <span className="text-xs text-[#9c4b25]">{saveSettings.error.message}</span> : saveSettings.data ? <span className="flex items-center gap-1 text-xs text-[#17633b]"><CheckCircle2 className="h-4 w-4" />حُفظت الإعدادات</span> : null}</div>
    </section>

    <section className="rounded-2xl border border-[#eadfc8] bg-[#fffdf8] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-[#4c3c24]">وسائط عالية الجودة للكتالوج</p><p className="mt-1 text-xs leading-5 text-[#776d5e]">يُنشئ نسخة Catalog مستقلة من أصل OneDrive: الأصل JPEG أو PNG يُحفظ كما هو إن كان صالحاً، وإلا تُحضّر JPEG عالية الجودة متوافقة. لا تُنشر أي بيانات إلى Meta في هذه الخطوة.</p></div><Button variant="outline" onClick={() => activeProductIds.length && prepareActive.mutate({ productIds: activeProductIds })} disabled={!canEdit || !activeProductIds.length || prepareActive.isPending} className="border-[#bfa46c] text-[#75582b]"><ImageUp className="ml-1.5 h-4 w-4" />{prepareActive.isPending ? "جارٍ تجهيز الوسائط…" : `تجهيز وسائط ${activeProductIds.length} منتج نشط`}</Button></div>{prepareActive.data ? <p className="mt-3 text-xs text-[#245b4d]">تم تجهيز {prepareActive.data.prepared.length} وسيط؛ {prepareActive.data.skipped.length} وسيط يحتاج مراجعة.</p> : prepareActive.error ? <p className="mt-3 text-xs text-[#9c4b25]">{prepareActive.error.message}</p> : null}</section>

    <section className="rounded-2xl border border-[#e5ded2] bg-white p-4"><div><p className="font-bold text-[#183d35]">استثناءات المنتج المحدد</p><p className="mt-1 text-xs leading-5 text-[#68756e]">{selectedProductId ? "هذه القيم تغلب الإعدادات العامة عند تصدير المنتج المحدد فقط." : "اختر منتجاً من قائمة المنتجات لفتح حقول الفئة والخامة والرابط الخاصة به."}</p></div>{selectedProductId && <><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Facebook Product Category"><Input value={productForm.fbProductCategory} onChange={event => setProductForm(current => ({ ...current, fbProductCategory: event.target.value }))} placeholder="اتركه فارغاً لاستخدام الافتراضي" disabled={!canEdit || product.isLoading} className={fieldClass} /></Field><Field label="الخامة Material"><Input value={productForm.material} onChange={event => setProductForm(current => ({ ...current, material: event.target.value }))} placeholder="مثال: قطن تركي" disabled={!canEdit || product.isLoading} className={fieldClass} /></Field><Field label="النقشة Pattern"><Input value={productForm.pattern} onChange={event => setProductForm(current => ({ ...current, pattern: event.target.value }))} placeholder="مثال: سادة" disabled={!canEdit || product.isLoading} className={fieldClass} /></Field><Field label="نوع المنتج"><Input value={productForm.productType} onChange={event => setProductForm(current => ({ ...current, productType: event.target.value }))} placeholder="يستخدم تصنيف المنتج إن تُرك فارغاً" disabled={!canEdit || product.isLoading} className={fieldClass} /></Field><Field label="رابط منتج خاص"><Input value={productForm.productLink} onChange={event => setProductForm(current => ({ ...current, productLink: event.target.value }))} placeholder="اتركه فارغاً لرابط /store/code" disabled={!canEdit || product.isLoading} className={fieldClass} /></Field><Field label="الجنس"><select value={productForm.gender} onChange={event => setProductForm(current => ({ ...current, gender: event.target.value }))} disabled={!canEdit || product.isLoading} className={`${fieldClass} w-full px-3`}><option value="">استخدام الافتراضي</option><option value="female">نساء</option><option value="male">رجال</option><option value="unisex">للجميع</option></select></Field></div><div className="mt-4 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs font-bold text-[#4d6158]"><Switch checked={productForm.exportEnabled} onCheckedChange={value => setProductForm(current => ({ ...current, exportEnabled: value }))} disabled={!canEdit} />تضمين هذا المنتج في Meta Catalog</label><Button variant="outline" onClick={() => saveProductFields()} disabled={!canEdit || saveProduct.isPending || product.isLoading} className="border-[#b9d3c6] text-[#245b4d]"><Save className="ml-1.5 h-4 w-4" />{saveProduct.isPending ? "جارٍ الحفظ…" : "حفظ استثناءات المنتج"}</Button><Button variant="outline" onClick={() => prepareProduct.mutate({ productId: selectedProductId })} disabled={!canEdit || prepareProduct.isPending} className="border-[#d5c29e] text-[#7a5a25]"><ImageUp className="ml-1.5 h-4 w-4" />{prepareProduct.isPending ? "جارٍ التجهيز…" : "تجهيز وسائط هذا المنتج"}</Button>{saveProduct.error || prepareProduct.error ? <span className="flex items-center gap-1 text-xs text-[#9c4b25]"><AlertCircle className="h-4 w-4" />{saveProduct.error?.message ?? prepareProduct.error?.message}</span> : null}{prepareProduct.data ? <span className="text-xs text-[#17633b]">{prepareProduct.data.prepared.length} وسيط جاهز، {prepareProduct.data.skipped.length} يحتاج مراجعة.</span> : null}</div></>}</section>
  </div>;
}
